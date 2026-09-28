/**
 * 멀티펜 실시간 모니터링 스토어 — 선생님 라이브 화면 전용.
 *
 * pen-event-bus 를 직접 구독해 "펜(mac) 단위"로 상태를 누적한다.
 * (기존 stroke.store 는 단일 펜 화면용 전역 누적이라 mac 구분이 없음)
 *
 * 구독 이벤트: 'authorized', 'settingInfo', 'dot', 'lowBattery', 'penDisconnected'
 */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { buildPageKey, penBus, type DotPayload } from '@/lib/pen-event-bus';
import {
  debouncedSave,
  loadSnapshot,
  saveSnapshot,
} from '@/pen/live/notebook-history';
import type { Stroke, StrokeDot } from '@/pen/live/model/stroke';

export type LivePenPage = {
  key: string;
  section: number;
  owner: number;
  noteId: number;
  pageNumber: number;
  /** 마지막 필기 시각 (epoch ms) — 노트 정렬·영속화 정리 기준 */
  updatedAt: number;
};

export type LivePen = {
  /** 소문자 정규화된 MAC */
  mac: string;
  connected: boolean;
  connectedAt: number;
  /** 마지막 필기(dot) 수신 시각 (epoch ms) */
  lastSeenAt: number | null;
  /** 0~100. SDK 가 알려줄 때만 채워짐 */
  batteryLevel: number | null;
  /** 현재(마지막으로 필기가 발생한) 페이지 */
  currentPageKey: string | null;
  pages: LivePenPage[];
  strokesByPage: Record<string, Stroke[]>;
  totalDots: number;
  /** 선생님이 펜에 수기로 붙인 번호 네임지 (교실 모드 식별용) */
  penNumber?: string;
  /** 현재 이 펜을 쓰는 학생 (시간대별 교체 가능 — sinceMs 이후 필기가 이 학생 몫) */
  assignment?: {
    studentId: string;
    studentName: string;
    sinceMs: number;
  } | null;
};

type MultipenStore = {
  pens: Record<string, LivePen>;
  /** 카드에서 펜을 목록에서 제거(연결 해제와 별개) */
  removePen: (mac: string) => void;
  clearAll: () => void;
  /** 펜 번호 + 사용 학생 배정 (학생만 바꾸면 그 시각부터 새 학생 몫) */
  setAssignment: (
    mac: string,
    penNumber: string,
    student: { studentId: string; studentName: string } | null,
  ) => void;
  /** 펜 번호만 갱신 — 배정(assignment)은 건드리지 않는다 (영구 번호 하이드레이션용) */
  setPenNumber: (mac: string, penNumber: string) => void;
  /**
   * PC 직결 라이브의 **완성된 획**을 원본 id 그대로 넣는다.
   *
   * 도트로 풀어 다시 조립하면 스토어가 `live_...` id 를 새로 만든다 — 그러면
   * 같은 필기를 나중에 크래들로 받았을 때 id 가 달라 **중복 저장**된다
   * (2026-08-17). 데스크가 만든 결정적 id(`off_...`)를 보존해야 서버 병합의
   * id 유니온이 중복을 막는다.
   */
  ingestStroke: (mac: string, stroke: Stroke) => void;
};

export function normalizeMac(mac: string): string {
  return mac.trim().toLowerCase();
}

// web_pen_sdk DotTypes: PEN_DOWN=0, PEN_MOVE=1, PEN_UP=2, PEN_HOVER=3, PEN_INFO=4, PEN_ERROR=5
const DOT_DOWN = 0;
const DOT_MOVE = 1;
const DOT_UP = 2;
const DOT_HOVER = 3;
const DOT_INFO = 4;
const DOT_ERROR = 5;

let strokeSeq = 0;

function emptyPen(mac: string): LivePen {
  return {
    mac,
    connected: true,
    connectedAt: Date.now(),
    lastSeenAt: null,
    batteryLevel: null,
    currentPageKey: null,
    pages: [],
    strokesByPage: {},
    totalDots: 0,
  };
}

export const useMultipenStore = create<MultipenStore>()(
  immer<MultipenStore>((set) => ({
    pens: {},

    removePen: (mac) =>
      set((s) => {
        delete s.pens[normalizeMac(mac)];
      }),

    clearAll: () =>
      set((s) => {
        s.pens = {};
      }),

    ingestStroke: (mac, stroke) =>
      set((s) => {
        const pen = ensurePen(s, mac);
        pen.connected = true;
        pen.lastSeenAt = Date.now();
        const pageKey = buildPageKey(
          stroke.section,
          stroke.owner,
          stroke.noteId,
          stroke.pageNumber,
        );
        if (!pen.strokesByPage[pageKey]) pen.strokesByPage[pageKey] = [];
        const list = pen.strokesByPage[pageKey];
        // 재연결 시 같은 획이 다시 올 수 있다 — id 로 한 번만 받는다
        if (list.some((x) => x.id === stroke.id)) return;
        // receivedAt = PC 수신 시각(지금) — 배정 시각 비교·날짜 라우팅의 기준
        list.push({ ...stroke, receivedAt: Date.now() });
        pen.totalDots += stroke.dots.length;
        const existing = pen.pages.find((pg) => pg.key === pageKey);
        if (existing) {
          existing.updatedAt = Date.now();
        } else {
          pen.pages.push({
            key: pageKey,
            section: stroke.section,
            owner: stroke.owner,
            noteId: stroke.noteId,
            pageNumber: stroke.pageNumber,
            updatedAt: Date.now(),
          });
        }
        pen.currentPageKey = pageKey;
      }),

    setAssignment: (mac, penNumber, student) =>
      set((s) => {
        const key = normalizeMac(mac);
        let pen = s.pens[key];
        if (!pen) {
          // 아직 연결 안 된 등록 펜의 사전 배정 — 자리만 만들어 두면
          // 같은 MAC 으로 연결되는 순간 필기가 이 배정으로 이어진다.
          pen = emptyPen(key);
          pen.connected = false;
          s.pens[key] = pen;
        }
        pen.penNumber = penNumber.trim();
        if (student === null) {
          pen.assignment = null;
        } else if (pen.assignment?.studentId !== student.studentId) {
          // 학생이 바뀔 때만 sinceMs 갱신 — 이 시각 이후 필기가 새 학생 몫
          pen.assignment = { ...student, sinceMs: Date.now() };
        } else {
          pen.assignment = { ...pen.assignment, ...student };
        }
      }),
    setPenNumber: (mac, penNumber) =>
      set((s) => {
        const pen = s.pens[normalizeMac(mac)];
        if (pen) pen.penNumber = penNumber.trim();
      }),
  })),
);

function ensurePen(
  s: { pens: Record<string, LivePen> },
  mac: string,
): LivePen {
  const key = normalizeMac(mac);
  if (!s.pens[key]) {
    s.pens[key] = emptyPen(key);
  }
  return s.pens[key];
}

function newStroke(dot: DotPayload): Stroke {
  strokeSeq += 1;
  return {
    id: `live_${dot.mac}_${dot.timeStamp || Date.now()}_${strokeSeq}`,
    section: dot.section,
    owner: dot.owner,
    noteId: dot.noteId,
    pageNumber: dot.pageNumber,
    dots: [],
    startedAt: dot.timeStamp || Date.now(),
    endedAt: null,
    // 펜 기기 시계(timeStamp)는 PC 와 어긋날 수 있다 — 배정 시각 비교용 수신 시각
    receivedAt: Date.now(),
  };
}

function toStrokeDot(dot: DotPayload): StrokeDot {
  return {
    x: dot.x,
    y: dot.y,
    pressure: dot.pressure,
    maxPressure: dot.maxPressure || 852,
    timeStamp: dot.timeStamp || 0,
  };
}

function handleDot(dot: DotPayload) {
  if (dot.dotType === DOT_HOVER || dot.dotType === DOT_ERROR) return;

  useMultipenStore.setState((s) => {
    const pen = ensurePen(s, dot.mac);
    pen.connected = true;
    pen.lastSeenAt = Date.now();

    const pageKey = buildPageKey(
      dot.section,
      dot.owner,
      dot.noteId,
      dot.pageNumber,
    );
    if (!pen.strokesByPage[pageKey]) pen.strokesByPage[pageKey] = [];
    const existing = pen.pages.find((p) => p.key === pageKey);
    if (existing) {
      existing.updatedAt = Date.now();
    } else {
      pen.pages.push({
        key: pageKey,
        section: dot.section,
        owner: dot.owner,
        noteId: dot.noteId,
        pageNumber: dot.pageNumber,
        updatedAt: Date.now(),
      });
    }
    pen.currentPageKey = pageKey;

    // PEN_INFO 는 페이지 전환 신호만 — 스트로크에는 영향 없음.
    if (dot.dotType === DOT_INFO) return;

    const list = pen.strokesByPage[pageKey];

    if (dot.dotType === DOT_DOWN) {
      // 새 스트로크 시작 (SDK 의 x=-1 마커 dot 은 넣지 않는다)
      list.push(newStroke(dot));
      return;
    }

    if (dot.dotType === DOT_MOVE) {
      let target = list[list.length - 1];
      if (!target || target.endedAt != null) {
        // pen-down 누락 시 자동 시작 (stroke.store 와 동일한 폴백)
        target = newStroke(dot);
        list.push(target);
      }
      target.dots.push(toStrokeDot(dot));
      pen.totalDots += 1;
      return;
    }

    if (dot.dotType === DOT_UP) {
      const target = list[list.length - 1];
      if (target && target.endedAt == null) {
        target.dots.push(toStrokeDot(dot));
        pen.totalDots += 1;
        target.endedAt = dot.timeStamp || Date.now();
      }
    }
  });
}

let wired = false;

/**
 * pen-event-bus 구독을 연결한다. LivePage mount 시 1회 호출 (중복 호출 안전).
 * 전역 stroke.store 와 함께 동작해도 무방하다(mitt 는 다중 핸들러 지원).
 */
export function wireMultipenBus() {
  if (wired) return;
  wired = true;

  penBus.on('dot', handleDot);

  penBus.on('authorized', ({ mac }) => {
    useMultipenStore.setState((s) => {
      const pen = ensurePen(s, mac);
      pen.connected = true;
    });
  });

  penBus.on('settingInfo', ({ mac, settings }) => {
    useMultipenStore.setState((s) => {
      const pen = ensurePen(s, mac);
      pen.connected = true;
      const battery = (settings as { Battery?: number } | null)?.Battery;
      if (typeof battery === 'number') pen.batteryLevel = battery;
    });
  });

  penBus.on('lowBattery', ({ mac, batteryLevel }) => {
    useMultipenStore.setState((s) => {
      const pen = ensurePen(s, mac);
      pen.batteryLevel = batteryLevel;
    });
  });

  penBus.on('penDisconnected', ({ mac }) => {
    useMultipenStore.setState((s) => {
      const key = normalizeMac(mac);
      // 일부 SDK 경로는 mac 없이 끊김을 알릴 수 있어 방어적으로 처리.
      if (key && s.pens[key]) {
        s.pens[key].connected = false;
        return;
      }
      if (!key) {
        for (const p of Object.values(s.pens)) p.connected = false;
      }
    });
  });
}

// ---------- 노트 기록 영속화 (localStorage) ----------

type MultipenSnapshot = {
  v: 1;
  pens: Record<string, LivePen>;
};

let persistTeacherId: string | null = null;
let unsubscribePersist: (() => void) | null = null;

function persistNow(key: string) {
  const state = useMultipenStore.getState();
  // 얕은 복사 스냅샷 — 용량 초과 시 전체 펜에서 가장 오래된 페이지부터 지운다.
  const snap: MultipenSnapshot = { v: 1, pens: {} };
  for (const [mac, pen] of Object.entries(state.pens)) {
    snap.pens[mac] = {
      ...pen,
      pages: [...pen.pages],
      strokesByPage: { ...pen.strokesByPage },
    };
  }
  saveSnapshot(key, snap, () => {
    let oldestMac: string | null = null;
    let oldestIdx = -1;
    let best = Infinity;
    for (const [mac, pen] of Object.entries(snap.pens)) {
      for (let i = 0; i < pen.pages.length; i++) {
        const t = pen.pages[i].updatedAt ?? 0;
        if (t < best) {
          best = t;
          oldestMac = mac;
          oldestIdx = i;
        }
      }
    }
    if (!oldestMac || oldestIdx < 0) return false;
    const pen = snap.pens[oldestMac];
    const [removed] = pen.pages.splice(oldestIdx, 1);
    delete pen.strokesByPage[removed.key];
    if (pen.currentPageKey === removed.key) pen.currentPageKey = null;
    if (pen.pages.length === 0) delete snap.pens[oldestMac];
    return true;
  });
}

/**
 * 선생님별 라이브 노트 기록 영속화 (교실 모드). LivePage 진입 시 호출.
 * 새로고침해도 이전에 지켜보던 펜/노트 기록이 남는다 (연결은 끊김 표시).
 */
export function wireMultipenPersistence(teacherId: string) {
  if (persistTeacherId === teacherId) return;
  if (persistTeacherId && persistTeacherId !== teacherId) {
    unsubscribePersist?.();
    useMultipenStore.getState().clearAll();
  }
  persistTeacherId = teacherId;
  const key = `pc_live_v1.teacher_local.${teacherId}`;

  const snap = loadSnapshot<MultipenSnapshot>(key);
  if (snap?.v === 1 && Object.keys(useMultipenStore.getState().pens).length === 0) {
    useMultipenStore.setState((s) => {
      for (const [mac, pen] of Object.entries(snap.pens)) {
        s.pens[mac] = { ...pen, connected: false };
      }
    });
  }

  unsubscribePersist = useMultipenStore.subscribe(() =>
    debouncedSave(key, () => persistNow(key)),
  );
}
