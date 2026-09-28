import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { buildPageKey, penBus, type DotPayload } from '@/lib/pen-event-bus';
import {
  debouncedSave,
  loadSnapshot,
  oldestIndex,
  saveSnapshot,
} from '@/pen/live/notebook-history';
import type { Stroke, StrokeDot } from '@/pen/live/model/stroke';

type StrokeState = {
  byPage: Record<string, Stroke[]>;
  currentPageKey: string | null;
  selectedPageKey: string | null;
  livePages: PageInfo[];
  liveStrokeId: string | null;
  isPenDown: boolean;
  lastPressure: number | null;
  totalDots: number;
  totalStrokes: number;
};

export type PageInfo = {
  key: string;
  section: number;
  owner: number;
  noteId: number;
  pageNumber: number;
  firstSeenAt: number;
  /** 마지막 필기 시각 (epoch ms) — 노트 정렬·영속화 정리 기준 */
  updatedAt: number;
};

type StrokeActions = {
  selectPage: (key: string) => void;
  clearPage: (key?: string | null) => void;
  undoOnPage: (key?: string | null) => void;
  reset: () => void;
};

type Store = StrokeState & StrokeActions;

// web_pen_sdk DotTypes: PEN_DOWN=0, PEN_MOVE=1, PEN_UP=2, PEN_HOVER=3, PEN_INFO=4, PEN_ERROR=5
const DOT_TYPE_DOWN = 0;
const DOT_TYPE_MOVE = 1;
const DOT_TYPE_UP = 2;
const DOT_TYPE_HOVER = 3;
const DOT_TYPE_INFO = 4;
const DOT_TYPE_ERROR = 5;

let strokeCounter = 0;

export const useStrokeStore = create<Store>()(
  subscribeWithSelector(
    immer<Store>((set) => ({
      byPage: {},
      currentPageKey: null,
      selectedPageKey: null,
      livePages: [],
      liveStrokeId: null,
      isPenDown: false,
      lastPressure: null,
      totalDots: 0,
      totalStrokes: 0,

      selectPage: (key) =>
        set((s) => {
          s.selectedPageKey = key;
        }),

      clearPage: (key) =>
        set((s) => {
          const target = key ?? s.selectedPageKey ?? s.currentPageKey;
          if (!target) return;
          const removed = s.byPage[target];
          if (removed) {
            s.totalStrokes -= removed.length;
            s.totalDots -= removed.reduce((sum, x) => sum + x.dots.length, 0);
          }
          s.byPage[target] = [];
          if (s.liveStrokeId) s.liveStrokeId = null;
        }),

      undoOnPage: (key) =>
        set((s) => {
          const target = key ?? s.selectedPageKey ?? s.currentPageKey;
          if (!target) return;
          const list = s.byPage[target];
          if (!list || list.length === 0) return;
          const removed = list.pop();
          if (removed) {
            s.totalStrokes -= 1;
            s.totalDots -= removed.dots.length;
          }
        }),

      reset: () =>
        set((s) => {
          s.byPage = {};
          s.currentPageKey = null;
          s.selectedPageKey = null;
          s.livePages = [];
          s.liveStrokeId = null;
          s.isPenDown = false;
          s.lastPressure = null;
          s.totalDots = 0;
          s.totalStrokes = 0;
        }),
    })),
  ),
);

function ensurePage(
  s: StrokeState,
  dot: DotPayload,
): { pageKey: string; pageList: Stroke[] } {
  const key = buildPageKey(dot.section, dot.owner, dot.noteId, dot.pageNumber);
  if (!s.byPage[key]) {
    s.byPage[key] = [];
  }
  const existing = s.livePages.find((p) => p.key === key);
  if (existing) {
    existing.updatedAt = Date.now();
  } else {
    s.livePages.push({
      key,
      section: dot.section,
      owner: dot.owner,
      noteId: dot.noteId,
      pageNumber: dot.pageNumber,
      firstSeenAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
  if (s.currentPageKey !== key) {
    s.currentPageKey = key;
    // Auto-follow the pen's active page so PageSelector switches tabs on page change.
    // Manual tab selection is intentional but is overridden the next time the pen
    // lands on a different page — matches "draw on a new page → tab follows" UX.
    s.selectedPageKey = key;
  }
  return { pageKey: key, pageList: s.byPage[key] };
}

function newStroke(dot: DotPayload): Stroke {
  strokeCounter += 1;
  const id = `stroke_${dot.timeStamp || Date.now()}_${strokeCounter}`;
  return {
    id,
    section: dot.section,
    owner: dot.owner,
    noteId: dot.noteId,
    pageNumber: dot.pageNumber,
    dots: [],
    startedAt: dot.timeStamp || Date.now(),
    endedAt: null,
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

/**
 * Match Flutter StrokeAssembler semantics:
 * - PEN_DOWN: state transition only, no coord dot pushed (SDK sends x=-1,y=-1)
 * - PEN_MOVE: append real coord to last stroke (auto-start if none)
 * - PEN_UP: close current stroke (Web SDK clones prev dot into PEN_UP, so coord is valid)
 * - PEN_INFO: page-change signal only, no stroke impact
 * - PEN_HOVER / PEN_ERROR: ignored
 */
function handleDot(dot: DotPayload) {
  if (dot.dotType === DOT_TYPE_HOVER || dot.dotType === DOT_TYPE_ERROR) {
    return;
  }

  useStrokeStore.setState((s) => {
    ensurePage(s, dot);

    // PEN_INFO: only paper info changed; no stroke impact.
    if (dot.dotType === DOT_TYPE_INFO) {
      return;
    }

    const key = buildPageKey(dot.section, dot.owner, dot.noteId, dot.pageNumber);
    const pageList = s.byPage[key];

    if (dot.dotType === DOT_TYPE_DOWN) {
      // Start a new empty stroke; do NOT push the x=-1 marker dot.
      const stroke = newStroke(dot);
      pageList.push(stroke);
      s.liveStrokeId = stroke.id;
      s.isPenDown = true;
      s.totalStrokes += 1;
      return;
    }

    if (dot.dotType === DOT_TYPE_MOVE) {
      let target: Stroke | undefined = pageList[pageList.length - 1];
      if (!target || target.endedAt != null) {
        // Auto-start stroke if pen-down was missed (Flutter fallback behavior).
        target = newStroke(dot);
        pageList.push(target);
        s.totalStrokes += 1;
        s.liveStrokeId = target.id;
      }
      target.dots.push(toStrokeDot(dot));
      s.isPenDown = true;
      s.lastPressure = dot.pressure;
      s.totalDots += 1;
      return;
    }

    if (dot.dotType === DOT_TYPE_UP) {
      const target = pageList[pageList.length - 1];
      if (target && target.endedAt == null) {
        // Web SDK PEN_UP is cloned from previous dot — has valid coord; keep it as final point.
        target.dots.push(toStrokeDot(dot));
        s.totalDots += 1;
        target.endedAt = dot.timeStamp || Date.now();
      }
      s.liveStrokeId = null;
      s.isPenDown = false;
      return;
    }
  });
}

let wired = false;

export function wireStrokeBus() {
  if (wired) return;
  wired = true;

  penBus.on('dot', handleDot);

  // 연결이 끊겨도 필기 기록은 지우지 않는다 — "이전에 쓰던 노트"를
  // 계속 볼 수 있어야 하기 때문. 진행 중이던 스트로크 상태만 정리한다.
  penBus.on('penDisconnected', () => {
    useStrokeStore.setState((s) => {
      s.isPenDown = false;
      s.liveStrokeId = null;
    });
  });
}

// ---------- 노트 기록 영속화 (localStorage) ----------

type StudentSnapshot = {
  v: 1;
  pages: PageInfo[];
  byPage: Record<string, Stroke[]>;
  currentPageKey: string | null;
};

function storageKeyFor(userId: string): string {
  return `pc_live_v1.student.${userId}`;
}

let persistUserId: string | null = null;
let unsubscribePersist: (() => void) | null = null;

function buildSnapshot(): StudentSnapshot {
  const s = useStrokeStore.getState();
  return {
    v: 1,
    pages: [...s.livePages],
    byPage: { ...s.byPage },
    currentPageKey: s.currentPageKey,
  };
}

function persistNow(key: string) {
  const snap = buildSnapshot();
  saveSnapshot(key, snap, () => {
    if (snap.pages.length <= 1) return false;
    const idx = oldestIndex(snap.pages);
    if (idx < 0) return false;
    const [removed] = snap.pages.splice(idx, 1);
    delete snap.byPage[removed.key];
    if (snap.currentPageKey === removed.key) snap.currentPageKey = null;
    return true;
  });
}

/**
 * 사용자별 노트 기록 영속화를 연결한다 (학생 /s/pen 진입 시 호출).
 * - 스토어가 비어 있으면 이전 세션 기록을 복원한다.
 * - 이후 필기가 쌓일 때마다 디바운스 저장한다.
 * - 다른 사용자로 전환되면 이전 사용자의 메모리 기록은 초기화한다.
 */
export function wireStrokePersistence(userId: string) {
  if (persistUserId === userId) return;
  if (persistUserId && persistUserId !== userId) {
    unsubscribePersist?.();
    useStrokeStore.getState().reset();
  }
  persistUserId = userId;
  const key = storageKeyFor(userId);

  const snap = loadSnapshot<StudentSnapshot>(key);
  if (
    snap?.v === 1 &&
    snap.pages.length > 0 &&
    useStrokeStore.getState().livePages.length === 0
  ) {
    useStrokeStore.setState((s) => {
      s.byPage = snap.byPage;
      s.livePages = snap.pages;
      s.currentPageKey = snap.currentPageKey;
      s.selectedPageKey = snap.currentPageKey;
      s.totalStrokes = Object.values(snap.byPage).reduce(
        (sum, list) => sum + list.length,
        0,
      );
      s.totalDots = Object.values(snap.byPage).reduce(
        (sum, list) => sum + list.reduce((n, st) => n + st.dots.length, 0),
        0,
      );
    });
  }

  unsubscribePersist = useStrokeStore.subscribe(
    (s) => s.totalDots,
    () => debouncedSave(key, () => persistNow(key)),
  );
}
