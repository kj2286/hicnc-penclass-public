/**
 * /t/desk — 크래들 (PC). **하이씨앤씨 펜클래스 PC 프로그램 안에서만 동작**한다.
 *
 * PC 앱(Tauri)은 이 웹을 그대로 창에 띄우고, 브라우저가 못 하는 크래들
 * USB 접근을 Rust 커맨드로 노출한다 (src/lib/desk.ts 브리지).
 * 흐름: 크래들 자동 발견(3초) → 슬롯 10칸 → 학생 배정(서버 학생 목록) →
 * [한 번에 받기] = 슬롯 순차 수신 → 기존 (학생,날짜) "교실 필기" 병합 저장
 * (mergeStrokesIntoStudentDay — 웹 리뷰·AI 분석이 그대로 쓴다) →
 * 원본은 PC 문서 폴더에 자동 덤프. BLE 펜 이름 변경 포함.
 *
 * 펜 레지스트리(sp_pens): 펜은 학원 자산 — 크래들에서 미등록 펜을 발견하면
 * 등록을 안내하고, 등록된 펜은 학생 배정·이관(이력 보존)·다인 공유를 지원한다.
 * 주인이 바뀌어도 이전 학생의 필기 기록은 (학생,날짜) 단위로 서버에 남는다.
 * 등록·이관·공유 관리는 브라우저에서도 보이고, 크래들 조작만 PC 앱 전용이다.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@seed-design/react';
import {
  Download,
  History,
  Pencil,
  Trash2,
  Usb,
  X,
} from 'lucide-react';
import { ActionButton } from 'seed-design/ui/action-button';
import {
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogRoot,
  AlertDialogTitle,
} from 'seed-design/ui/alert-dialog';
import { Callout } from 'seed-design/ui/callout';
import { TextField, TextFieldInput } from 'seed-design/ui/text-field';
import { Field, FieldStack } from '@/components/ui/field';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  assignPenHolder,
  countStudentSubmissions,
  listAcademyPens,
  listMyStudents,
  PEN_KIND_LABEL,
  registerAcademyPen,
  removePen,
  setPenSharedStudents,
  updatePen,
  updatePenCollectedUntil,
  type PenKind,
  type PenRow,
  type StudentRow,
} from '@/lib/api';
import { mergeStrokesIntoStudentDay, type MergeResult } from '@/lib/classroom-save';
import { setReceiving as setReceivingGlobal } from '@/lib/receive-state';
import {
  runAutoGradeQueue,
  type AutoGradeJob,
  type AutoGradeProgress,
} from '@/lib/auto-grade';
import {
  deskBleRename,
  deskCradleErase,
  deskCradlePull,
  deskCradleProbe,
  deskCradleSnapshot,
  isDesk,
  type DeskCradle,
  type DeskProbe,
} from '@/lib/desk';
import { ambiguousPens, findPenByMac, looseMac } from '@/lib/pen-assign';
import { kstShortDate } from '@/lib/kst';
import {
  clearSeenRecord,
  hasSeenRecord,
  recordSeen,
  splitNewStrokes,
} from '@/lib/pen-seen';
import { useSessionStore } from '@/store/session.store';
import { TokenSelect } from '../components/TokenSelect';
import { useToast } from '../components/toast';

type PenStudent = { studentId: string; studentName: string };
/** 등록된 펜 섹션 표시 여부 — 2026-08-18 사용자 지시로 숨김 */
const SHOW_REGISTERED_PENS = false;

const MAP_KEY = 'pc_desk_pen_students_v1';
/** 펜별 수집 워터마크(ms) 로컬 폴백 — 서버(sp_pens.collected_until_ms)가 정본 */
const WM_KEY = 'pc_desk_pen_watermark_v1';
/** BLE 로 바꾼 펜 이름 로컬 캐시 — 펜이 이름을 바로 돌려주지 않아도 화면에 반영 */
const NAME_KEY = 'pc_desk_pen_names_v1';

function loadNames(): Record<string, string> {
  try {
    return JSON.parse(window.localStorage.getItem(NAME_KEY) ?? '{}');
  } catch {
    return {};
  }
}
function saveName(macLoose: string, name: string) {
  try {
    const m = loadNames();
    m[macLoose] = name;
    window.localStorage.setItem(NAME_KEY, JSON.stringify(m));
  } catch {
    /* noop */
  }
}

function loadWatermarks(): Record<string, number> {
  try {
    return JSON.parse(window.localStorage.getItem(WM_KEY) ?? '{}');
  } catch {
    return {};
  }
}
function saveWatermark(macLoose: string, ms: number) {
  try {
    const m = loadWatermarks();
    if ((m[macLoose] ?? 0) >= ms) return;
    m[macLoose] = ms;
    window.localStorage.setItem(WM_KEY, JSON.stringify(m));
  } catch {
    /* noop */
  }
}
/** 수거 워터마크 삭제 — 서버 기록 삭제 후 재수거(처음부터 다시 저장)용 */
function clearWatermark(macLoose: string) {
  try {
    const m = loadWatermarks();
    delete m[macLoose];
    window.localStorage.setItem(WM_KEY, JSON.stringify(m));
  } catch {
    /* noop */
  }
}

function loadMap(): Record<string, PenStudent> {
  try {
    return JSON.parse(window.localStorage.getItem(MAP_KEY) ?? '{}');
  } catch {
    return {};
  }
}
function saveMap(m: Record<string, PenStudent>) {
  try {
    window.localStorage.setItem(MAP_KEY, JSON.stringify(m));
  } catch {
    /* noop */
  }
}
/**
 * suffix(6자리)·전체 MAC 어느 쪽으로 저장돼 있어도 찾는다.
 * **모호하면 못 찾은 것으로 본다** — 뒷자리가 걸치는 첫 번째를 돌려주면
 * 서로 다른 펜이 같은 학생으로 붙는다(2026-08-17 실사고). 잘못 붙으면 남의
 * 필기가 그 학생 기록에 저장되므로, 애매할 땐 사람이 고르게 둔다.
 */
function mapGet(m: Record<string, PenStudent>, mac: string): PenStudent | null {
  const k = looseMac(mac);
  if (!k) return null;
  if (m[k]) return m[k];
  if (k.length < 6) return null;
  const hits = Object.entries(m).filter(
    ([key]) => key.length >= 6 && (key.endsWith(k) || k.endsWith(key)),
  );
  return hits.length === 1 ? hits[0][1] : null;
}

export function DeskCradlePage() {
  const toast = useToast();
  const navigate = useNavigate();
  const desk = isDesk();

  const [cradles, setCradles] = useState<DeskCradle[]>([]);
  const [probes, setProbes] = useState<Record<string, DeskProbe>>({});
  const probingRef = useRef(false);
  const [mapping, setMapping] = useState<Record<string, PenStudent>>(loadMap);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [receiving, setReceiving] = useState(false);
  const [progress, setProgress] = useState('');
  /** 슬롯별 수신·업로드 상태 — 카드 안 로딩바/완료 표시용 */
  /** 슬롯 상태 키 = `${크래들번호}-${슬롯}` — 크래들이 여러 대면 슬롯 번호가
   *  겹치므로 번호만으로는 서로의 진행 표시가 뒤섞인다 */
  const [slotStatus, setSlotStatus] = useState<Record<string, 'busy' | 'done'>>(
    {},
  );
  // 진행 로그는 화면에서 걷어냈지만(요청) 상태는 유지 — 다음 UI 에서 재사용
  const logRef = useRef<string[]>([]);
  /** 인라인 이름 편집 중인 펜(macSuffix). null 이면 편집 안 함 */
  const [renameMac, setRenameMac] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [eraseTarget, setEraseTarget] = useState<{
    port: string;
    slot: number;
    files: number | null;
  } | null>(null);
  const [eraseBusy, setEraseBusy] = useState(false);

  // ── 수신 결과 검증 요약 + AI 자동 채점 (사용자 요구 2026-08-19) ──
  /** 수신이 끝나면 펜별 결과(읽은 획·저장 문서·경고)를 팝업으로 검증해 보여준다 */
  type ReceiveEntry = {
    label: string;
    slotName: string;
    strokes: number;
    /** 이번에 서버로 새로 저장된 획 수 */
    fresh: number;
    merged: MergeResult[];
    warnings: string[];
  };
  const [receiveReport, setReceiveReport] = useState<ReceiveEntry[] | null>(
    null,
  );
  const [autoGradeProg, setAutoGradeProg] = useState<AutoGradeProgress | null>(
    null,
  );
  /** 진행 중 여부의 정본 — state 는 렌더 지연이 있어 연속 수신 시 못 믿는다.
   *  화면 표시는 autoGradeProg(진행 배너)가 담당한다. */
  const autoGradeBusyRef = useRef(false);
  /** 채점이 도는 중 새 수신이 끝나면 여기 쌓인다 — 버리지 않고 이어서 처리 */
  const autoGradeQueueRef = useRef<AutoGradeJob[]>([]);
  const autoGradeCancelRef = useRef(false);

  // ── 펜 레지스트리 (sp_pens — 학원 자산) ──
  const [regPens, setRegPens] = useState<PenRow[]>([]);
  const [regTarget, setRegTarget] = useState<{
    mac: string;
    model: string;
    slot: number;
    /** 크래들 순번(1부터) — 여러 대일 때 어느 크래들인지 알려준다 */
    cradle: number;
  } | null>(null);
  const [regName, setRegName] = useState('');
  const [regKind, setRegKind] = useState<PenKind>('ballpen');
  const [regStudentId, setRegStudentId] = useState('');
  /** 펜에 저장할 블루투스 이름 — 등록 시 함께 적용한다 */
  const [regBleName, setRegBleName] = useState('');
  const [regError, setRegError] = useState<string | null>(null);
  const [regBusy, setRegBusy] = useState(false);
  const [transferTarget, setTransferTarget] = useState<{
    pen: PenRow;
    student: { id: string; name: string } | null;
  } | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);
  const [unregTarget, setUnregTarget] = useState<PenRow | null>(null);
  const [unregBusy, setUnregBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState<string | null>(null);

  const profile = useSessionStore((s) => s.profile);

  const loadPens = useCallback(() => {
    listAcademyPens()
      .then(setRegPens)
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadPens();
  }, [loadPens]);

  // 모호하면 못 찾은 것으로 본다 — 잘못 붙이면 남의 필기가 그 학생 기록에 남는다
  const regPenOf = useCallback(
    // 같은 MAC 이 여러 계정에 등록돼 있으면 **내 등록**을 고른다.
    (mac: string): PenRow | undefined =>
      findPenByMac(regPens, mac, profile?.id),
    [regPens, profile?.id],
  );

  /**
   * 정리해야 할 중복 등록 — **내 등록이 있어도 경고한다.**
   *
   * 실사고(2026-08-19): 같은 펜(…79B6)이 한 계정엔 '김케이', 다른 계정엔
   * '고유현' 으로 등록돼 있었다. 내 등록이 있으면 그걸 골라 업로드는 되지만,
   * **펜에 붙은 라벨과 화면의 이름·학생이 서로 다른 사람**이 된다. 조용히
   * 넘어가면 "펜 이름과 학생이 안 맞는다" 로만 보인다 — 반드시 경고로 띄운다.
   */
  const dupWarnings = useMemo(() => {
    const byKey = new Map<string, PenRow[]>();
    for (const p of regPens) {
      const k = looseMac(p.mac);
      const list = byKey.get(k);
      if (list) list.push(p);
      else byKey.set(k, [p]);
    }
    const out: string[] = [];
    for (const [k, rows] of byKey) {
      if (rows.length < 2) continue;
      const names = [...new Set(rows.map((r) => r.name || '(이름 없음)'))];
      out.push(`펜 …${k.slice(-6).toUpperCase()} → '${names.join("' · '")}' ${rows.length}건`);
    }
    return out;
  }, [regPens]);
  const studentNameOf = useCallback(
    (id: string | null): string =>
      (id && students.find((s) => s.id === id)?.name) || '',
    [students],
  );
  const nextPenNumber = useMemo(
    () => regPens.reduce((a, p) => Math.max(a, p.penNumber ?? 0), 0) + 1,
    [regPens],
  );

  /** BLE 로 바꾼 이름(로컬) — 이름 변경 직후 화면에 즉시 반영된다 */
  const [bleNames, setBleNames] = useState<Record<string, string>>(loadNames);

  /**
   * 슬롯에 보여줄 펜 이름. 모델명(NWP-F45-PD)은 이름이 아니다 —
   * 등록 이름 → 펜이 들고 있는 이름(subName) → 방금 바꾼 로컬 이름 순.
   */
  const penNameOf = useCallback(
    (mac: string, probe: DeskProbe | undefined, reg: PenRow | undefined) => {
      if (reg?.name) return reg.name;
      const sub = probe?.subName?.trim();
      // 기본값(제품명)이면 이름으로 치지 않는다
      if (sub && sub !== probe?.modelName && !/^POSTDEMY/i.test(sub)) return sub;
      const local = bleNames[looseMac(mac)];
      if (local) return local;
      return '';
    },
    [bleNames],
  );

  /** 진행 로그 — 화면에는 안 띄우지만(사용자 요청으로 패널 제거) 하드웨어
   *  문제 추적에는 필요해 버퍼로 남긴다. ref 라 기록해도 다시 그리지 않는다.
   *  콘솔에서 `__deskLog` 로 꺼내 본다. */
  const pushLog = useCallback((line: string) => {
    const t = new Date().toTimeString().slice(0, 8);
    logRef.current = [...logRef.current.slice(-199), `[${t}] ${line}`];
    (window as unknown as Record<string, unknown>).__deskLog = logRef.current;
  }, []);

  // 학생 목록 (배정 셀렉트 + 레지스트리 이름 표시) — 브라우저에서도 필요하다
  useEffect(() => {
    listMyStudents()
      .then((list) => setStudents(list.filter((s) => !s.deletedAt)))
      .catch(() => toast('학생 목록을 불러오지 못했습니다.', 'critical'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 크래들 폴링 (3초) — 수신 중에는 쉰다
  useEffect(() => {
    if (!desk) return;
    let alive = true;
    const tick = async () => {
      if (receiving) return;
      try {
        const snap = await deskCradleSnapshot();
        if (alive) {
          setCradles(snap);
          // **낡은 조회(probe) 폐기** — probe 는 포트 이름으로 캐시되는데,
          // 같은 포트에 다른 펜이 꽂히면(교체) 이전 펜의 MAC·이름이 그대로
          // 보여 **펜 라벨과 화면 학생이 어긋난다.** 스냅샷의 시리얼 뒷자리와
          // 다르면 버리고 다시 조회한다. 사라진 포트의 캐시도 함께 버린다.
          setProbes((m) => {
            const live = new Map<string, string | null>();
            for (const c of snap)
              for (const s of c.slots) if (s.port) live.set(s.port, s.macSuffix);
            let changed = false;
            const next: typeof m = {};
            for (const [port, probe] of Object.entries(m)) {
              const suffix = live.get(port);
              if (suffix === undefined) {
                changed = true; // 포트 없어짐
                continue;
              }
              const a = looseMac(probe.macFull);
              const b = looseMac(suffix ?? '');
              if (a && b && !a.endsWith(b) && !b.endsWith(a)) {
                changed = true; // 같은 포트에 다른 펜 — 재조회 유도
                continue;
              }
              next[port] = probe;
            }
            return changed ? next : m;
          });
        }
      } catch (e) {
        if (alive) pushLog(`크래들 탐색 실패: ${e instanceof Error ? e.message : e}`);
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 3000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [desk, receiving, pushLog]);

  // 새 포트 상세 조회 (순차, 수신 중 제외)
  useEffect(() => {
    if (!desk || receiving || probingRef.current) return;
    const next = cradles
      .flatMap((c) => c.slots)
      .find((s) => s.port && !probes[s.port]);
    if (!next?.port) return;
    probingRef.current = true;
    const port = next.port;
    void deskCradleProbe(port)
      .then((info) => setProbes((m) => ({ ...m, [port]: info })))
      .catch((e) =>
        pushLog(`슬롯 ${next.physicalSlot} 조회 실패: ${e instanceof Error ? e.message : e}`),
      )
      .finally(() => {
        probingRef.current = false;
      });
  }, [desk, cradles, probes, receiving, pushLog]);

  const penTotal = useMemo(
    () => cradles.reduce((a, c) => a + c.penCount, 0),
    [cradles],
  );

  /** 로컬 매핑 갱신 — 서버 배정의 캐시이자 미등록 펜의 폴백 */
  const assignLocal = (mac: string, studentId: string) => {
    const next = { ...mapping };
    const k = looseMac(mac);
    if (!studentId) {
      delete next[k];
    } else {
      const st = students.find((s) => s.id === studentId);
      if (!st) return;
      next[k] = { studentId, studentName: st.name };
    }
    setMapping(next);
    saveMap(next);
  };

  /** 서버 배정 실행 — 이력은 assignPenHolder 가 남긴다 */
  const doAssign = async (
    pen: PenRow,
    student: { id: string; name: string } | null,
  ) => {
    await assignPenHolder(pen, student);
    assignLocal(pen.mac, student?.id ?? '');
    loadPens();
    pushLog(
      student
        ? `펜 "${pen.name || `펜 ${pen.penNumber ?? ''}`}" → ${student.name} 배정`
        : `펜 "${pen.name || `펜 ${pen.penNumber ?? ''}`}" 회수 (미배정)`,
    );
  };

  /** 슬롯/레지스트리에서 학생 변경 — 다른 학생이 쓰던 펜이면 이관 확인을 먼저 받는다 */
  const onHolderChange = (pen: PenRow | undefined, mac: string, studentId: string) => {
    if (!pen) {
      // 미등록 펜 — 로컬 매핑만 (등록을 유도한다)
      assignLocal(mac, studentId);
      return;
    }
    const student = studentId
      ? { id: studentId, name: studentNameOf(studentId) }
      : null;
    if (
      pen.assignedStudentId &&
      studentId &&
      pen.assignedStudentId !== studentId
    ) {
      setTransferTarget({ pen, student });
      return;
    }
    void doAssign(pen, student).catch((e) =>
      toast(e instanceof Error ? e.message : String(e), 'critical'),
    );
  };

  /** 펜 종류(볼펜·샤프) 변경 — 016 이전 등록분은 비어 있어 여기서 채운다 */
  const onKindChange = (pen: PenRow, kind: PenKind) => {
    // 낙관적 반영 — 셀렉트가 즉시 바뀌어야 여러 자루를 연속으로 지정하기 편하다
    setRegPens((prev) =>
      prev.map((x) => (x.id === pen.id ? { ...x, kind } : x)),
    );
    void updatePen(pen.id, { kind })
      .then(() => {
        pushLog(`펜 종류 지정: ${pen.name || pen.mac} → ${PEN_KIND_LABEL[kind]}`);
      })
      .catch((e) => {
        // 실패하면 되돌린다 — 화면만 바뀌고 서버는 그대로면 집계가 어긋난다
        setRegPens((prev) =>
          prev.map((x) => (x.id === pen.id ? { ...x, kind: pen.kind } : x)),
        );
        toast(e instanceof Error ? e.message : String(e), 'critical');
      });
  };

  type ReceiveJob = {
    /** 크래들 순번(1부터) — 여러 대일 때 로그·진행 표시를 구분한다 */
    cradle: number;
    slot: number;
    /** 슬롯 상태 키 */
    key: string;
    port: string;
    mac: string;
  };
  const jobOfSlot = (
    s: { physicalSlot: number; port: string | null; macSuffix: string | null },
    cradleIndex: number,
  ): ReceiveJob => ({
    cradle: cradleIndex + 1,
    slot: s.physicalSlot,
    key: `${cradleIndex}-${s.physicalSlot}`,
    port: s.port as string,
    mac: (s.port && probes[s.port]?.macFull) || s.macSuffix || '',
  });
  /** 로그·진행 문구 — 크래들이 2대 이상이면 "크래들2 · 슬롯3" 으로 */
  const jobName = (j: ReceiveJob) =>
    cradles.length > 1 ? `크래들${j.cradle} · 슬롯 ${j.slot}` : `슬롯 ${j.slot}`;

  /** 공용 수신 루프 — [한 번에 받기]와 슬롯별 [받기]가 함께 쓴다 */
  const runReceive = async (jobs: ReceiveJob[]) => {
    if (receiving || jobs.length === 0) return;
    setReceiving(true);
    setReceivingGlobal(true); // 전역 알림 — 필기 기록·리포트가 수신 중 AI 작업을 미룬다
    pushLog(
      jobs.length === 1
        ? `── ${jobName(jobs[0])} 수신 시작 (읽기 전용) ──`
        : `── 일괄 수신 시작 — 펜 ${jobs.length}자루 (읽기 전용) ──`,
    );
    let okCount = 0;
    const report: ReceiveEntry[] = [];
    const autoJobs: AutoGradeJob[] = [];
    try {
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        // 서버 레지스트리의 주 사용 학생이 우선, 미등록 펜은 로컬 매핑 폴백
        const reg = regPenOf(job.mac);
        const student: PenStudent | null = reg?.assignedStudentId
          ? {
              studentId: reg.assignedStudentId,
              studentName: studentNameOf(reg.assignedStudentId) || '학생',
            }
          : mapGet(mapping, job.mac);
        const label = student?.studentName ?? `미지정_${job.mac.slice(-6) || job.slot}`;
        setProgress(`${i + 1}/${jobs.length} — ${jobName(job)} (${label}) 수신 중…`);
        setSlotStatus((m) => ({ ...m, [job.key]: 'busy' }));
        const entry: ReceiveEntry = {
          label,
          slotName: jobName(job),
          strokes: 0,
          fresh: 0,
          merged: [],
          warnings: [],
        };
        report.push(entry);
        try {
          let r = await deskCradlePull(job.port, job.slot, label);
          // 펜에 파일이 있는데 수신이 비거나 **레코드를 건너뛰었으면** 일시
          // 실패일 수 있다(포트 순단·펜 저장 직후 등) — 한 번 쉬고 재시도해
          // 두 번의 결과를 획 id 로 합친다. "가끔 데이터가 안 들어온다"·
          // "일부 페이지가 빠졌다" 실사고(2026-08-19)의 방어선.
          const firstSkipped = r.skippedRecords;
          let retriedForSkip = false;
          if (
            (r.strokes.length === 0 || r.skippedRecords > 0) &&
            (probes[job.port]?.offlineFiles ?? 0) > 0
          ) {
            retriedForSkip = r.skippedRecords > 0;
            pushLog(
              r.strokes.length === 0
                ? `  └ 수신이 비어 있어 3초 후 재시도합니다…`
                : `  └ 레코드 ${r.skippedRecords}개를 못 읽어 3초 후 재시도합니다…`,
            );
            await new Promise((res) => setTimeout(res, 3000));
            const r2 = await deskCradlePull(job.port, job.slot, label).catch(
              () => null,
            );
            if (r2) {
              const byId = new Map(r.strokes.map((s) => [s.id, s] as const));
              for (const s of r2.strokes) byId.set(s.id, s);
              r = {
                ...r2,
                strokes: [...byId.values()],
                skippedRecords: Math.min(r.skippedRecords, r2.skippedRecords),
              };
            }
          }
          entry.strokes = r.strokes.length;
          if (r.skippedRecords > 0) {
            // 재시도해도 같은 개수 = **펜에 남아 있는 손상 조각**(저장 중 끊긴
            // 마지막 획 자투리 등). 다시 받아도 경고가 계속 나오므로 "다시
            // 받아라" 는 잘못된 안내다 — 사실대로 알리고 해소법(초기화)을 준다.
            const persistent =
              retriedForSkip && r.skippedRecords === firstSkipped;
            entry.warnings.push(
              persistent
                ? `펜 저장소에 손상된 필기 조각 ${r.skippedRecords}개가 있어 건너뛰었습니다(저장 중 끊긴 흔적 — 재시도해도 동일). 읽은 ${r.strokes.length.toLocaleString()}획은 정상 저장됐고, 이 경고는 펜 [데이터 초기화] 후 사라집니다.`
                : `펜에서 레코드 ${r.skippedRecords}개를 읽지 못했습니다 — [펜 데이터 받기]를 다시 눌러주세요`,
            );
          }
          if (probes[job.port]?.listTruncated) {
            entry.warnings.push('파일 목록이 잘렸습니다 — 다시 받기를 권장합니다');
          }
          if (
            r.strokes.length === 0 &&
            (probes[job.port]?.offlineFiles ?? 0) > 0
          ) {
            entry.warnings.push(
              '펜에 파일이 있는데 0획 수신 — 일시 오류일 수 있으니 다시 받아주세요',
            );
          }
          if (job.mac && ambiguousPens(regPens, job.mac).length > 1) {
            entry.warnings.push(
              '이 펜이 여러 이름으로 등록돼 있습니다 — 이름·학생이 실제와 다를 수 있습니다',
            );
          }
          const dots = r.strokes.reduce((a, s) => a + s.dots.length, 0);
          pushLog(
            `${jobName(job)} · ${label}: 노트 ${r.notePairs}쌍 · 획 ${r.strokes.length} · dot ${dots}` +
              (r.skippedRecords > 0 ? ` · ⚠건너뜀 ${r.skippedRecords}` : ''),
          );
          if (r.strokes.length === 0) {
            pushLog(`  └ 새 필기 없음`);
          } else if (student) {
            const wmLoose = looseMac(job.mac);
            /**
             * 새 필기 판별 — **획 id 우선, 시각은 폴백.**
             *
             * 펜 시계가 하루 늦어 오늘 필기가 어제 날짜 문서로 들어간 실사고
             * (2026-08-17, 김경수 415획). 전에 본 적 없는 획 = 새 필기이므로
             * 수신 시각을 찍어 **오늘 문서**로 보낸다. 시계가 어떻든 맞다.
             */
            let merged;
            // **기록 삭제 후 재수거 감지** — 서버에 이 학생 제출이 하나도 없으면
            // (선생님이 필기 기록을 지우고 다시 받는 중) 이 펜의 수거 기록·
            // 워터마크를 리셋해 **첫 수거처럼 전부 다시 저장**한다. 안 하면
            // 모든 획이 "이전 수거분"으로 걸러져 다시 받아도 아무것도 안
            // 들어온다 (2026-08-19 사용자 시나리오: "전부 삭제하고 다시 받기").
            let wipedRestart = false;
            if (hasSeenRecord(wmLoose)) {
              try {
                if ((await countStudentSubmissions(student.studentId)) === 0) {
                  wipedRestart = true;
                  clearSeenRecord(wmLoose);
                  clearWatermark(wmLoose);
                  pushLog(
                    `  └ 서버 기록 0건 — 수거 기록을 리셋하고 처음부터 다시 저장합니다`,
                  );
                }
              } catch {
                /* 조회 실패 — 기존 동작 유지 */
              }
            }
            if (hasSeenRecord(wmLoose)) {
              const fresh = splitNewStrokes(wmLoose, r.strokes);
              entry.fresh = fresh.length;
              if (fresh.length === 0) {
                pushLog(`  └ 새 필기 없음 (모두 이전 수거분)`);
                setSlotStatus((m) => ({ ...m, [job.key]: 'done' }));
                // continue 가 아래 공통 정리 타이머를 건너뛰므로 여기서 직접 —
                // 안 하면 "완료" 배지가 화면에 영영 남는다
                const skipKey = job.key;
                window.setTimeout(
                  () =>
                    setSlotStatus((m) => {
                      if (m[skipKey] !== 'done') return m;
                      const n = { ...m };
                      delete n[skipKey];
                      return n;
                    }),
                  4000,
                );
                continue;
              }
              const now = Date.now();
              merged = await mergeStrokesIntoStudentDay(
                student.studentId,
                fresh.map((st) => ({ ...st, receivedAt: now })),
                { collectedUntilMs: 0, receivedAtMs: now },
              );
              pushLog(`  └ 새 획 ${fresh.length}개 (이전 수거분 ${r.strokes.length - fresh.length}개 제외)`);
            } else {
              // 첫 수거 — 옛 필기 전체가 '오늘'로 쏠리지 않게 시각 기반이 기본.
              // 단, **가장 최근 획조차 12시간 이상 과거면 펜 시계 불신** — 오늘
              // 쓴 필기가 펜 시계(7/9에 멈춤)대로 과거 날짜 문서가 되던 실사고
              // (2026-08-18, 002학생). 수거한 필기는 수거일로 보이는 게 정답이다.
              const now = Date.now();
              const newest = r.strokes.reduce(
                (a, st) => Math.max(a, st.receivedAt ?? st.startedAt),
                0,
              );
              const rtcBroken = now - newest > 12 * 3600 * 1000;
              if (rtcBroken) {
                pushLog(
                  `  └ ⚠ 펜 시계가 ${Math.round((now - newest) / 86400000)}일 늦습니다 — 전부 오늘 기록으로 저장`,
                );
              }
              // 재수거 리셋이면 서버 워터마크(collectedUntilMs)도 무시한다 —
              // 안 그러면 지난 수거 시각 이전 획이 또 걸러져 빈 수신이 된다
              const watermark = wipedRestart
                ? 0
                : Math.max(
                    reg?.collectedUntilMs ?? 0,
                    loadWatermarks()[wmLoose] ?? 0,
                  );
              entry.fresh = r.strokes.length;
              merged = await mergeStrokesIntoStudentDay(
                student.studentId,
                rtcBroken
                  ? r.strokes.map((st) => ({ ...st, receivedAt: now }))
                  : r.strokes,
                {
                  collectedUntilMs: rtcBroken ? 0 : watermark,
                  receivedAtMs: now,
                },
              );
            }
            recordSeen(wmLoose, r.strokes);
            entry.merged = merged;
            for (const m of merged) {
              pushLog(
                `  └ ${m.date} · ${m.title} 저장 (${m.pageCount}페이지 작성)`,
              );
              // 저장이 끝난 문서는 **AI 자동 채점 대기열**로 (사용자 요구
              // 2026-08-19: 받기만 하면 채점까지 자동으로)
              autoJobs.push({
                studentId: student.studentId,
                submissionId: m.submissionId,
                studentName: student.studentName,
                title: m.title,
              });
            }
            const maxTs = r.strokes.reduce(
              (a, s) => Math.max(a, s.receivedAt ?? s.startedAt),
              0,
            );
            if (maxTs > 0) {
              saveWatermark(wmLoose, maxTs);
              if (reg) {
                void updatePenCollectedUntil(reg.id, maxTs).catch(() => {});
              }
            }
            okCount += 1;
          } else {
            pushLog(
              `  └ 학생 미배정 — PC(${r.rawDir})에만 저장됨. 슬롯에 학생을 지정하세요.`,
            );
            if (r.strokes.length > 0) {
              entry.warnings.push(
                '학생 미배정 — 서버에 저장되지 않고 PC 폴더에만 남았습니다. 슬롯에 학생을 지정한 뒤 다시 받아주세요.',
              );
            }
          }
          // 카드에 완료 표시를 잠깐 남기고 지운다
          setSlotStatus((m) => ({ ...m, [job.key]: 'done' }));
          const doneKey = job.key;
          window.setTimeout(
            () =>
              setSlotStatus((m) => {
                if (m[doneKey] !== 'done') return m;
                const n = { ...m };
                delete n[doneKey];
                return n;
              }),
            4000,
          );
        } catch (e) {
          setSlotStatus((m) => {
            const n = { ...m };
            delete n[job.key];
            return n;
          });
          entry.warnings.push(
            `수신 실패: ${e instanceof Error ? e.message : String(e)} — 다시 받아주세요`,
          );
          pushLog(`✖ ${jobName(job)} 실패: ${e instanceof Error ? e.message : e}`);
        }
      }
      pushLog(`✔ 수신 완료 — 서버 저장 ${okCount}자루`);
      // "완료" 를 말로만 하지 않는다 — 펜별 수신·저장 결과와 경고를 팝업으로
      // 검증해 보여준다 (사용자 불안 2026-08-19: "완료가 안 된 걸 보고 있는 건
      // 아닌가"). 경고가 있으면 어떤 펜을 다시 받아야 하는지가 여기 나온다.
      setReceiveReport(report);
    } finally {
      setReceiving(false);
      setReceivingGlobal(false);
      setProgress('');
    }
    // 저장이 검증된 문서부터 AI 자동 채점 — 받기만 하면 채점까지 자동
    if (autoJobs.length > 0) void startAutoGrade(autoJobs);
  };

  /** 수신 완료 문서들의 백그라운드 AI 채점 — 진행 배너 + [취소] 제공.
   *  이미 도는 중이면 큐에 쌓고, 도는 루프가 이어서 처리한다(작업 유실 금지). */
  const startAutoGrade = async (jobs: AutoGradeJob[]) => {
    if (jobs.length === 0) return;
    autoGradeQueueRef.current.push(...jobs);
    if (autoGradeBusyRef.current) return;
    autoGradeBusyRef.current = true;
    autoGradeCancelRef.current = false;
    try {
      while (
        autoGradeQueueRef.current.length > 0 &&
        !autoGradeCancelRef.current
      ) {
        const batch = autoGradeQueueRef.current.splice(0);
        const results = await runAutoGradeQueue(batch, {
          isCancelled: () => autoGradeCancelRef.current,
          onProgress: (p) => setAutoGradeProg(p),
        });
        const graded = results.reduce((a, r) => a + r.gradedCalls, 0);
        const failedDocs = results.filter((r) => !r.ok || r.failed > 0).length;
        if (autoGradeCancelRef.current) {
          toast('자동 채점을 취소했습니다 — 지금까지의 채점 결과는 저장돼 있습니다.');
        } else if (failedDocs > 0) {
          toast(
            `AI 자동 채점이 끝났지만 문서 ${failedDocs}건에 실패한 문항이 있습니다 — 해당 필기 기록을 열면 자동으로 재시도됩니다.`,
            'critical',
          );
        } else {
          toast(
            `AI 자동 채점 완료 — 문서 ${results.length}건, 새로 채점 ${graded}문항. 필기 기록에서 바로 확인할 수 있어요.`,
            'positive',
          );
        }
      }
    } finally {
      autoGradeBusyRef.current = false;
      autoGradeQueueRef.current = [];
      setAutoGradeProg(null);
    }
  };

  const receiveAll = async () => {
    const jobs = cradles.flatMap((c, ci) =>
      c.slots.filter((s) => s.port).map((s) => jobOfSlot(s, ci)),
    );
    if (jobs.length === 0) {
      toast('수신할 펜이 없습니다 — 크래들에 펜을 꽂아주세요.', 'critical');
      return;
    }
    await runReceive(jobs);
  };

  const runRename = async () => {
    if (!renameMac || renameBusy) return;
    const name = renameInput.trim();
    if (!name || new TextEncoder().encode(name).length > 16) {
      toast('BT 이름은 1~16바이트(UTF-8)여야 합니다.', 'critical');
      return;
    }
    setRenameBusy(true);
    pushLog(`BLE 로 펜(${renameMac})을 찾는 중…`);
    try {
      const msg = await deskBleRename(renameMac, name);
      // 화면에 바로 반영 — 펜을 다시 꽂지 않아도 새 이름이 보이게
      const key = looseMac(renameMac);
      saveName(key, name);
      setBleNames((m) => ({ ...m, [key]: name }));
      const reg = regPenOf(renameMac);
      if (reg) {
        await updatePen(reg.id, { name }).catch(() => {});
        loadPens();
      }
      pushLog(msg);
      toast(msg, 'positive');
      setRenameMac(null);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      pushLog(`이름 변경 실패: ${m}`);
      toast(m, 'critical');
    } finally {
      setRenameBusy(false);
    }
  };

  // ── 펜 등록·이관·공유 핸들러 ──
  const openRegister = (
    mac: string,
    model: string,
    slot: number,
    cradle: number,
    current = '',
  ) => {
    setRegTarget({ mac, model, slot, cradle });
    setRegName(`펜 ${nextPenNumber}`);
    setRegBleName(current);
    setRegKind('ballpen');
    setRegStudentId('');
    setRegError(null);
  };

  const runRegister = async () => {
    if (!regTarget || regBusy) return;
    const name = regName.trim();
    const ble = regBleName.trim();
    // 펜 이름·블루투스 이름은 필수 — 등록된 펜과 새 펜을 이름으로 구분한다
    if (!name) {
      setRegError('펜 이름을 입력해주세요.');
      return;
    }
    if (!ble) {
      setRegError('블루투스 이름을 입력해주세요.');
      return;
    }
    if (new TextEncoder().encode(ble).length > 16) {
      setRegError('블루투스 이름은 16바이트(한글 5자 정도)까지 가능합니다.');
      return;
    }
    setRegBusy(true);
    setRegError(null);
    try {
      const holder = regStudentId
        ? { id: regStudentId, name: studentNameOf(regStudentId) }
        : null;
      await registerAcademyPen({
        mac: regTarget.mac,
        name,
        model: regTarget.model,
        kind: regKind,
        penNumber: nextPenNumber,
        holder,
      });
      if (holder) assignLocal(regTarget.mac, holder.id);
      // 블루투스 이름도 함께 적용 — 슬롯에서 바로 구분되게
      const suffix = regTarget.mac.slice(-6);
      try {
        await deskBleRename(suffix, ble);
        const key = looseMac(regTarget.mac);
        saveName(key, ble);
        setBleNames((m) => ({ ...m, [key]: ble }));
      } catch (e) {
        pushLog(
          `펜은 등록됐지만 블루투스 이름 변경 실패: ${e instanceof Error ? e.message : e}`,
        );
      }
      loadPens();
      pushLog(`✔ 펜 등록: ${name} (${PEN_KIND_LABEL[regKind]})${holder ? ` · ${holder.name}` : ''}`);
      toast(`펜 "${name}" 을(를) 등록했습니다.`, 'positive');
      setRegTarget(null);
    } catch (e) {
      setRegError(e instanceof Error ? e.message : String(e));
    } finally {
      setRegBusy(false);
    }
  };

  const runTransfer = async () => {
    if (!transferTarget || transferBusy) return;
    setTransferBusy(true);
    try {
      await doAssign(transferTarget.pen, transferTarget.student);
      toast(
        transferTarget.student
          ? `펜 주인을 ${transferTarget.student.name} 학생으로 이관했습니다. 이전 학생의 필기 기록은 그대로 보관됩니다.`
          : '펜을 회수했습니다.',
        'positive',
      );
      setTransferTarget(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'critical');
    } finally {
      setTransferBusy(false);
    }
  };

  const runUnregister = async () => {
    if (!unregTarget || unregBusy) return;
    setUnregBusy(true);
    try {
      await removePen(unregTarget.id);
      assignLocal(unregTarget.mac, '');
      loadPens();
      pushLog(`펜 등록 해제: ${unregTarget.name || `펜 ${unregTarget.penNumber ?? ''}`}`);
      toast('펜 등록을 해제했습니다. (학생 필기 기록은 남습니다)', 'positive');
      setUnregTarget(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'critical');
    } finally {
      setUnregBusy(false);
    }
  };

  const toggleShared = async (pen: PenRow, studentId: string, add: boolean) => {
    const ids = add
      ? [...pen.sharedStudentIds, studentId]
      : pen.sharedStudentIds.filter((i) => i !== studentId);
    try {
      await setPenSharedStudents(pen.id, ids);
      loadPens();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      toast(
        /shared_student_ids/.test(m)
          ? '공유 학생 기능은 016 마이그레이션 적용 후 사용할 수 있습니다.'
          : m,
        'critical',
      );
    }
  };

  /**
   * 펜 저장소 비우기 — **불변 규칙: 서버 기록(sp_submissions)은 절대 건드리지
   * 않는다.** 크래들 삭제는 USB 로 펜 안의 오프라인 파일만 지우는 조작이고,
   * 학생 관리 > 필기 기록은 서버 자산이라 두 곳은 연동되지 않는다.
   * (여기에 제출 삭제 호출을 추가하지 말 것 — 사용자 명시 요구, 2026-08-13)
   */
  const runErase = async () => {
    if (!eraseTarget || eraseBusy) return;
    setEraseBusy(true);
    pushLog(`── 슬롯 ${eraseTarget.slot} 펜 저장소 비우기 시작 (서버 기록 유지) ──`);
    try {
      const r = await deskCradleErase(eraseTarget.port);
      // 슬롯 카드의 파일 수 표시 갱신 — probe 캐시를 비우면 폴링이 다시 조회한다
      setProbes((p) => {
        const n = { ...p };
        delete n[eraseTarget.port];
        return n;
      });
      if (r.remainingFiles > 0) {
        pushLog(
          `⚠ 파일 ${r.deletedFiles}개 삭제, ${r.remainingFiles}개 남음 — 다시 시도해주세요.`,
        );
        toast(`일부만 삭제되었습니다 (${r.remainingFiles}개 남음). 다시 시도해주세요.`, 'critical');
      } else {
        pushLog(
          `✔ 슬롯 ${eraseTarget.slot} 펜 저장소 비움 — 파일 ${r.deletedFiles}개 (서버 필기 기록은 그대로)`,
        );
        toast(
          `펜 저장소를 비웠습니다 (파일 ${r.deletedFiles}개). 서버의 필기 기록은 그대로입니다.`,
          'positive',
        );
        setEraseTarget(null);
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      // 구버전 앱(v0.2.6 이하)에는 cradle_erase 커맨드가 없다 — ACL 오류를 안내로 바꾼다
      const m = /cradle_erase|not allowed|allowlist/i.test(raw)
        ? 'PC 앱을 최신 버전(v0.2.7 이상)으로 업데이트한 뒤 사용할 수 있습니다. 앱을 재시작하면 자동 업데이트가 진행됩니다.'
        : raw;
      pushLog(`✖ 펜 데이터 삭제 실패: ${m}`);
      toast(m, 'critical');
    } finally {
      setEraseBusy(false);
    }
  };

  // ── 펜 관리 블록 (브라우저에서도 노출 — 크래들 조작만 PC 전용) ──
  const penManagementBlock = (
    <>
      {/* 펜 주인 이관 확인 패널 */}
      {transferTarget && (
        <div
          data-testid="pen-transfer"
          className="space-y-2 rounded-xl border border-line-weak bg-layer-default p-4"
        >
          <p className="text-sm font-semibold text-ink">
            펜 주인 이관 —{' '}
            {transferTarget.pen.name || `펜 ${transferTarget.pen.penNumber ?? ''}`}
          </p>
          <p className="max-w-3xl text-xs leading-relaxed text-ink-muted">
            {studentNameOf(transferTarget.pen.assignedStudentId) || '기존 학생'} →{' '}
            <b>{transferTarget.student?.name ?? '미배정'}</b>(으)로 주인을
            변경합니다. 기존 학생의 필기 기록은 서버에 <b>그대로 보관</b>되며,
            이관 후 수신하는 필기부터 새 학생의 기록으로 저장됩니다. 아직 받지
            않은 필기가 있다면 [이 펜만 받기]로 먼저 수신한 뒤 이관하세요.
          </p>
          <div className="flex items-center gap-2">
            <ActionButton
              variant="brandSolid"
              size="small"
              loading={transferBusy}
              onClick={() => void runTransfer()}
            >
              이관
            </ActionButton>
            <ActionButton
              variant="neutralWeak"
              size="small"
              disabled={transferBusy}
              onClick={() => setTransferTarget(null)}
            >
              취소
            </ActionButton>
          </div>
        </div>
      )}

      {/* 펜 등록 해제 확인 패널 */}
      {unregTarget && (
        <div className="space-y-2 rounded-xl border border-line-weak bg-critical-weak/30 p-4">
          <p className="text-sm font-semibold text-critical">
            펜 등록 해제 — {unregTarget.name || `펜 ${unregTarget.penNumber ?? ''}`}
          </p>
          <p className="text-xs text-ink-muted">
            학원 보유 목록에서만 제거됩니다. 학생들의 필기 기록은 삭제되지
            않습니다.
          </p>
          <div className="flex items-center gap-2">
            <ActionButton
              variant="criticalSolid"
              size="small"
              loading={unregBusy}
              onClick={() => void runUnregister()}
            >
              해제
            </ActionButton>
            <ActionButton
              variant="neutralWeak"
              size="small"
              disabled={unregBusy}
              onClick={() => setUnregTarget(null)}
            >
              취소
            </ActionButton>
          </div>
        </div>
      )}

      {/* 등록된 펜 섹션 — 사용자 지시(2026-08-18)로 숨김.
          펜 관리가 정리되면 다시 열 수 있게 코드는 남겨 둔다. */}
      {/* 이중 등록이 있으면 숨김 설정이어도 표에서 바로 정리할 수 있게 연다 */}
      {(SHOW_REGISTERED_PENS || dupWarnings.length > 0) && (
      <>
      {/* 등록된 펜 — 학원 자산 레지스트리 */}
      <section className="overflow-hidden rounded-xl border border-line-weak bg-layer-default">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-weak bg-layer-fill px-5 py-3">
          <h3 className="text-sm font-bold text-ink">
            등록된 펜 ({regPens.length})
          </h3>
          <span className="text-[11px] text-ink-subtle">
            펜은 학원 자산 — 주인을 바꿔도(이관) 이전 학생의 필기 기록은 서버에
            남습니다.
          </span>
        </div>
        {regPens.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-ink-subtle">
            아직 등록된 펜이 없습니다. 크래들에 펜을 꽂으면 [펜 등록]으로
            등록할 수 있어요.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-ink-subtle">
                  <th className="px-4 py-2.5 font-medium">펜</th>
                  <th className="px-3 py-2.5 font-medium">종류 · 모델</th>
                  <th className="px-3 py-2.5 font-medium">주 사용 학생</th>
                  <th className="px-3 py-2.5 font-medium">함께 쓰는 학생</th>
                  <th className="px-3 py-2.5 font-medium">배정 이력</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {regPens.map((p) => (
                  <Fragment key={p.id}>
                    <tr className="border-t border-line-weak">
                      <td className="px-4 py-2.5">
                        <div className="font-semibold text-ink">
                          {p.name || `펜 ${p.penNumber ?? ''}`}
                        </div>

                      </td>
                      <td className="px-3 py-2.5">
                        {/* 016 이전에 등록된 펜은 종류가 비어 있다 — 여기서 바로
                            지정할 수 있게 한다(대시보드 볼펜·샤프 집계에 필요). */}
                        <TokenSelect
                          aria-label={`${p.name || p.mac} 펜 종류`}
                          className="w-28 text-xs"
                          value={p.kind}
                          onValueChange={(v) => onKindChange(p, v as PenKind)}
                        >
                          <option value="">미지정</option>
                          <option value="ballpen">
                            {PEN_KIND_LABEL.ballpen}
                          </option>
                          <option value="sharp">{PEN_KIND_LABEL.sharp}</option>
                        </TokenSelect>
                        {p.model && (
                          <span className="ml-2 text-ink-muted">{p.model}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <TokenSelect
                          aria-label={`${p.name || p.mac} 주 사용 학생`}
                          className="w-36 text-xs"
                          value={p.assignedStudentId ?? ''}
                          onValueChange={(v) => onHolderChange(p, p.mac, v)}
                        >
                          <option value="">미배정</option>
                          {students.map((st) => (
                            <option key={st.id} value={st.id}>
                              {st.name}
                            </option>
                          ))}
                        </TokenSelect>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-1">
                          {p.sharedStudentIds.map((id) => (
                            <span
                              key={id}
                              className="inline-flex items-center gap-0.5 rounded-full bg-neutral-weak px-2 py-0.5 text-[11px] text-ink"
                            >
                              {studentNameOf(id) || '?'}
                              <button
                                type="button"
                                aria-label="공유 해제"
                                onClick={() => void toggleShared(p, id, false)}
                                className="text-ink-subtle hover:text-critical"
                              >
                                <X size={10} />
                              </button>
                            </span>
                          ))}
                          <TokenSelect
                            aria-label={`${p.name || p.mac} 공유 학생 추가`}
                            className="w-24 text-[11px]"
                            value=""
                            onValueChange={(v) =>
                              v && void toggleShared(p, v, true)
                            }
                          >
                            <option value="">+ 추가</option>
                            {students
                              .filter(
                                (st) =>
                                  st.id !== p.assignedStudentId &&
                                  !p.sharedStudentIds.includes(st.id),
                              )
                              .map((st) => (
                                <option key={st.id} value={st.id}>
                                  {st.name}
                                </option>
                              ))}
                          </TokenSelect>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <button
                          type="button"
                          onClick={() =>
                            setHistoryOpen(historyOpen === p.id ? null : p.id)
                          }
                          className="inline-flex items-center gap-1 text-[11px] text-ink-muted hover:underline"
                        >
                          <History size={11} /> {p.holderHistory.length}건
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => setUnregTarget(p)}
                          className="text-[11px] text-critical hover:underline"
                        >
                          등록 해제
                        </button>
                      </td>
                    </tr>
                    {historyOpen === p.id && (
                      <tr className="border-t border-line-weak bg-layer-fill">
                        <td
                          colSpan={6}
                          className="px-4 py-2.5 text-[11px] text-ink-muted"
                        >
                          {p.holderHistory.length === 0 ? (
                            '배정 이력이 없습니다.'
                          ) : (
                            <ol className="space-y-0.5">
                              {[...p.holderHistory].reverse().map((h, i) => (
                                <li key={i}>
                                  {kstShortDate(h.at)} — {h.studentName}
                                  {h.studentId ? ' 배정' : ''}
                                </li>
                              ))}
                            </ol>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      </>
      )}
    </>
  );

  if (!desk) {
    return (
      <div className="max-w-2xl space-y-3">
        <Callout
          tone="informative"
          title="크래들은 PC 프로그램(하이씨앤씨 펜클래스)에서 사용합니다"
          description="크래들은 USB-C 로 PC 에 직접 연결되는 장치라 브라우저에서는 쓸 수 없습니다. 하이씨앤씨 펜클래스 PC 프로그램을 설치해 실행하면 이 화면이 활성화됩니다 — 앱 안에서는 지금 보시는 웹의 모든 기능(학생 관리·필기 기록·AI 분석 등)이 그대로 동작합니다. 아래 등록된 펜(배정·이관·공유)은 브라우저에서도 관리할 수 있습니다."
        />
        <ActionButton variant="neutralWeak" size="small" onClick={() => navigate('/t')}>
          대시보드로
        </ActionButton>
        {penManagementBlock}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink">
            크래들 (PC)
            {cradles.length > 0 && (
              <span className="ml-2 align-middle text-sm font-medium text-ink-muted">
                {cradles.length}대 연결 · 펜 {penTotal}자루
              </span>
            )}
          </h2>
          <p className="mt-0.5 max-w-3xl text-sm text-ink-muted">
            크래들 1대 = 펜 10자루이고, 여러 대를 꽂으면 자동으로 함께 잡힙니다.
            슬롯에 학생을 지정하고 [한 번에 받기]를 누르면
            모든 펜의 필기가 학생별 · 날짜별 필기 기록으로 저장됩니다 (펜의 데이터는
            지우지 않습니다). 원본은 PC 문서 폴더에도 남습니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ActionButton
            variant="brandSolid"
            size="small"
            loading={receiving}
            disabled={penTotal === 0}
            onClick={() => void receiveAll()}
          >
            <span className="inline-flex items-center gap-1.5">
              <Download size={15} /> 한 번에 받기 ({penTotal}자루)
            </span>
          </ActionButton>
        </div>
      </div>

      {dupWarnings.length > 0 && (
        <Callout
          tone="critical"
          title="같은 펜이 서로 다른 이름·학생으로 여러 번 등록돼 있습니다"
          description={`${dupWarnings.join(' / ')} — 펜에 붙은 라벨과 화면의 이름·학생이 다르게 보일 수 있습니다. 아래 [등록된 펜]에서 잘못된 등록을 해제해 주세요.`}
        />
      )}

      {autoGradeProg && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-brand bg-brand-weak/30 px-4 py-2.5 text-sm font-medium text-ink">
          <span>
            AI 자동 채점·분석 진행 중 — 학생별로 동시에 처리합니다. 학생
            관리·필기 기록 리스트에 학생별 진행률이 표시돼요. (지금:{' '}
            {autoGradeProg.studentName} · {autoGradeProg.stage}{' '}
            {autoGradeProg.done}/{autoGradeProg.total})
          </span>
          <button
            type="button"
            onClick={() => {
              autoGradeCancelRef.current = true;
            }}
            className="shrink-0 text-[12px] font-bold text-critical hover:underline"
          >
            취소
          </button>
        </div>
      )}


      {progress && (
        <div className="rounded-lg border border-brand bg-brand-weak/30 px-4 py-2.5 text-sm font-medium text-ink">
          {progress}
        </div>
      )}

      {cradles.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-line-weak bg-layer-default px-5 py-14 text-center">
          <Usb size={28} className="text-ink-subtle" />
          <p className="text-sm font-medium text-ink">크래들이 감지되지 않았습니다</p>
          <p className="max-w-md text-xs leading-relaxed text-ink-subtle">
            크래들 전원 어댑터와 USB-C(데이터) 케이블 연결을 확인하고 펜을
            꽂아주세요. 3초마다 자동으로 다시 찾고, 여러 대를 꽂으면 크래들 1·2…
            로 나눠 표시합니다.
          </p>
        </div>
      ) : (
        cradles.map((c, ci) => (
          <section
            key={ci}
            className="overflow-hidden rounded-xl border border-line-weak bg-layer-default"
          >
            <div className="border-b border-line-weak bg-layer-fill px-5 py-3">
              <h3 className="text-sm font-bold text-ink">
                {cradles.length > 1 ? `크래들 ${ci + 1}` : '크래들'} · 펜{' '}
                {c.penCount}자루 꽂힘
              </h3>
            </div>
            <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5">
              {c.slots.map((s) => {
                const probe = s.port ? probes[s.port] : undefined;
                const mac = probe?.macFull || s.macSuffix || '';
                const reg = mac ? regPenOf(mac) : undefined;
                const student = mac ? mapGet(mapping, mac) : null;
                const holderId = reg ? (reg.assignedStudentId ?? '') : (student?.studentId ?? '');
                const status = slotStatus[`${ci}-${s.physicalSlot}`];
                const penName = mac ? penNameOf(mac, probe, reg) : '';
                return (
                  <div
                    key={s.physicalSlot}
                    data-testid="desk-slot"
                    className="flex flex-col gap-2 rounded-lg border border-line-weak bg-layer-default p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-line-solid text-xs font-bold text-ink">
                        {s.physicalSlot}
                      </span>
                      {s.port ? (
                        <Badge size="medium" variant="weak" tone="positive">
                          꽂힘
                        </Badge>
                      ) : (
                        <span className="text-[11px] text-ink-subtle">빈 칸</span>
                      )}
                    </div>
                    {s.port ? (
                      <>
                        {renameMac && renameMac === s.macSuffix ? (
                          // 이름 자리에서 바로 편집 — 별도 패널로 내려가지 않는다
                          <div className="flex items-center gap-1">
                            <input
                              autoFocus
                              value={renameInput}
                              disabled={renameBusy}
                              onChange={(e) => setRenameInput(e.currentTarget.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') void runRename();
                                if (e.key === 'Escape') setRenameMac(null);
                              }}
                              placeholder="펜 이름"
                              className="w-full min-w-0 rounded border border-brand px-1.5 py-0.5 text-xs font-bold text-ink outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => void runRename()}
                              disabled={renameBusy}
                              className="shrink-0 text-[11px] font-bold text-brand disabled:opacity-40"
                            >
                              {renameBusy ? '변경 중' : '저장'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setRenameMac(null)}
                              disabled={renameBusy}
                              className="shrink-0 text-[11px] text-ink-subtle"
                            >
                              취소
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <span
                              className={
                                'truncate text-xs font-bold ' +
                                (penName ? 'text-ink' : 'text-ink-subtle')
                              }
                            >
                              {penName || '이름 지정 없음'}
                            </span>
                            {reg && (
                              <button
                                type="button"
                                title="펜 이름 변경 (블루투스)"
                                aria-label={`슬롯 ${s.physicalSlot} 펜 이름 변경`}
                                disabled={!s.macSuffix || renameBusy}
                                onClick={() => {
                                  setRenameMac(s.macSuffix ?? null);
                                  setRenameInput(penName);
                                }}
                                className="shrink-0 text-ink-subtle hover:text-brand disabled:opacity-40"
                              >
                                <Pencil size={12} />
                              </button>
                            )}
                          </div>
                        )}
                        <div className="text-[11px] leading-relaxed text-ink-muted">
                          {probe
                            ? `필기 파일 ${probe.offlineFiles}개${probe.listTruncated ? ' ⚠잘림' : ''}`
                            : '조회 중…'}
                          {mac && (
                            // 펜 라벨과 화면 학생이 맞는지 눈으로 검증할 근거
                            <span className="ml-1 text-[10px] text-ink-subtle">
                              · 펜 …{looseMac(mac).slice(-4).toUpperCase()}
                            </span>
                          )}
                        </div>
                        {mac && ambiguousPens(regPens, mac).length > 1 && (
                          <div className="text-[10px] font-semibold text-critical">
                            ⚠ 이중 등록된 펜 — 이름·학생이 실제와 다를 수 있어요
                          </div>
                        )}
                        {probe && probe.diskTotalKb > 0 && (
                          <div
                            className="flex items-center gap-1.5"
                            title={`여유 ${probe.diskFreeKb}KB / 전체 ${probe.diskTotalKb}KB`}
                          >
                            <div className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-weak">
                              <div
                                className="h-full rounded-full bg-brand"
                                style={{
                                  // 필기 파일 0개면 0% — 파일시스템 오버헤드
                                  // 때문에 빈 펜도 1% 로 보이던 문제(2026-08-18)
                                  width: `${probe.offlineFiles === 0 ? 0 : Math.min(100, Math.max(2, Math.round(((probe.diskTotalKb - probe.diskFreeKb) / probe.diskTotalKb) * 100)))}%`,
                                }}
                              />
                            </div>
                            <span className="shrink-0 text-[10px] text-ink-subtle">
                              {probe.offlineFiles === 0
                                ? 0
                                : Math.round(
                                    ((probe.diskTotalKb - probe.diskFreeKb) /
                                      probe.diskTotalKb) *
                                      100,
                                  )}
                              %
                            </span>
                          </div>
                        )}
                        {!reg ? (
                          // 미등록 펜 — 등록 전에는 학생 배정·수신을 열지 않는다
                          // (등록된 펜과 새 펜을 이름으로 구분하기 위함)
                          <ActionButton
                            variant="brandSolid"
                            size="xsmall"
                            disabled={!mac || regBusy}
                            onClick={() =>
                              openRegister(
                                mac,
                                probe?.modelName || s.model || '',
                                s.physicalSlot,
                                ci + 1,
                                penName,
                              )
                            }
                          >
                            펜 등록
                          </ActionButton>
                        ) : (
                          <>
                            <TokenSelect
                              aria-label={`슬롯 ${s.physicalSlot} 학생`}
                              className="w-full text-xs"
                              value={holderId}
                              disabled={receiving}
                              onValueChange={(v) => mac && onHolderChange(reg, mac, v)}
                            >
                              <option value="">학생 선택…</option>
                              {students.map((st) => (
                                <option key={st.id} value={st.id}>
                                  {st.name}
                                </option>
                              ))}
                            </TokenSelect>
                            {status === 'busy' && (
                              <div
                                className="h-1 w-full overflow-hidden rounded-full bg-brand-weak"
                                role="progressbar"
                                aria-label={`슬롯 ${s.physicalSlot} 업로드 중`}
                              >
                                <div className="h-full w-full animate-pulse rounded-full bg-brand" />
                              </div>
                            )}
                            {status === 'done' && (
                              <div className="text-[11px] font-semibold text-success">
                                ✔ 완료되었습니다
                              </div>
                            )}
                            <button
                              type="button"
                              // 학생이 지정돼야 받을 수 있다 — 누구 기록인지 정해야 저장된다
                              disabled={receiving || !holderId}
                              title={
                                holderId ? undefined : '학생을 먼저 지정해주세요'
                              }
                              onClick={() => void runReceive([jobOfSlot(s, ci)])}
                              className="inline-flex items-center gap-1 self-start text-[11px] font-medium text-brand hover:underline disabled:opacity-40"
                            >
                              <Download size={11} /> 펜 데이터 받기
                            </button>
                        <button
                          type="button"
                          data-testid="desk-erase"
                          disabled={receiving || eraseBusy}
                          onClick={() =>
                            s.port &&
                            setEraseTarget({
                              port: s.port,
                              slot: s.physicalSlot,
                              files: probe ? probe.offlineFiles : null,
                            })
                          }
                          className="inline-flex items-center gap-1 self-start text-[11px] font-medium text-critical hover:underline disabled:opacity-40"
                        >
                          <Trash2 size={11} /> 데이터 초기화
                            </button>
                          </>
                        )}
                      </>
                    ) : (
                      <div className="h-[92px]" />
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}

      {/* 펜 등록 패널 */}
      {/* 펜 등록 — 팝업 (펜 이름·블루투스 이름 필수, 학생은 선택) */}
      <Dialog
        open={!!regTarget}
        onOpenChange={(o) => !regBusy && !o && setRegTarget(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>펜 등록</DialogTitle>
            <DialogDescription>
              {cradles.length > 1
                ? `크래들 ${(regTarget?.cradle ?? 1)} · 슬롯 ${regTarget?.slot}`
                : `슬롯 ${regTarget?.slot}`}
              에 꽂힌 펜을 학원 펜으로 등록합니다.
            </DialogDescription>
          </DialogHeader>
          <FieldStack data-testid="pen-register">
            <Field
              label="펜 이름"
              required
              htmlFor="reg-name"
              hint="선생님이 관리용으로 부르는 이름이에요."
            >
              <TextField>
                <TextFieldInput
                  id="reg-name"
                  autoFocus
                  value={regName}
                  onChange={(e) => setRegName(e.currentTarget.value)}
                  placeholder="예: 1번 펜"
                  disabled={regBusy}
                />
              </TextField>
            </Field>

            <Field
              label="블루투스 이름"
              required
              htmlFor="reg-ble"
              hint="펜에 저장돼 크래들·블루투스 목록에 보이는 이름 (최대 16바이트)"
            >
              <TextField>
                <TextFieldInput
                  id="reg-ble"
                  value={regBleName}
                  onChange={(e) => setRegBleName(e.currentTarget.value)}
                  placeholder="예: 김경수펜"
                  disabled={regBusy}
                />
              </TextField>
            </Field>

            <Field label="종류">
              <div className="grid grid-cols-2 gap-2">
                {(['ballpen', 'sharp'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    disabled={regBusy}
                    onClick={() => setRegKind(k)}
                    className={
                      'h-10 rounded-[10px] border text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ' +
                      (regKind === k
                        ? 'border-brand bg-brand-weak/40 font-semibold text-brand'
                        : 'border-line-weak font-medium text-ink-muted hover:border-line-solid hover:text-ink')
                    }
                  >
                    {PEN_KIND_LABEL[k]}
                  </button>
                ))}
              </div>
            </Field>

            <Field
              label="학생"
              hint="지금 정하지 않아도 됩니다. 다만 학생을 지정해야 이 펜의 필기를 받을 수 있어요."
              error={regError}
            >
              <TokenSelect
                aria-label="학생 배정"
                className="w-full text-sm"
                value={regStudentId}
                onValueChange={setRegStudentId}
              >
                <option value="">나중에 지정</option>
                {students.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name}
                  </option>
                ))}
              </TokenSelect>
            </Field>
          </FieldStack>
          <DialogFooter>
            <ActionButton
              variant="neutralWeak"
              size="small"
              disabled={regBusy}
              onClick={() => setRegTarget(null)}
            >
              취소
            </ActionButton>
            <ActionButton
              variant="brandSolid"
              size="small"
              loading={regBusy}
              onClick={() => void runRegister()}
            >
              등록
            </ActionButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 펜 데이터 삭제 확인 패널 */}
      {/* 데이터 초기화 확인 — 인라인 패널은 페이지 아래에 나타나 찾기 어려웠다
          (사용자 지적 2026-08-19). 정중앙 팝업(전 팝업 규칙)으로. */}
      <AlertDialogRoot
        open={eraseTarget !== null}
        onOpenChange={(o) => !o && !eraseBusy && setEraseTarget(null)}
      >
        <AlertDialogContent data-testid="desk-erase-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              슬롯 {eraseTarget?.slot} — 펜 안의 필기 데이터를 지울까요?
            </AlertDialogTitle>
            <AlertDialogDescription>
              펜 저장소만 비웁니다
              {eraseTarget?.files != null ? ` (파일 ${eraseTarget.files}개)` : ''}.
              학생 관리 &gt; 필기 기록의 서버 기록은 삭제되지 않습니다 — 두 곳은
              연동되지 않습니다. ⚠️ 아직 [받기]로 수신하지 않은 필기는 서버에
              없으므로 영구히 사라집니다. 필요한 필기는 먼저 받은 뒤 지워주세요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              variant="neutralWeak"
              disabled={eraseBusy}
              onClick={() => setEraseTarget(null)}
            >
              취소
            </AlertDialogAction>
            <AlertDialogAction
              variant="criticalSolid"
              loading={eraseBusy}
              onClick={() => void runErase()}
            >
              펜 데이터 삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>

      {/* 수신 결과 검증 요약 — "완료" 를 펜별 숫자로 보여준다 (2026-08-19).
          경고가 있으면 어떤 펜을 다시 받아야 하는지 여기서 바로 알 수 있다. */}
      <Dialog
        open={receiveReport !== null}
        onOpenChange={(o) => !o && setReceiveReport(null)}
      >
        <DialogContent data-testid="desk-receive-report" className="max-w-lg">
          <DialogHeader>
            <DialogTitle>수신 결과</DialogTitle>
            <DialogDescription>
              펜별로 읽은 필기와 서버에 저장된 문서입니다. ⚠ 경고가 있는 펜은
              [펜 데이터 받기]를 다시 눌러주세요 — 펜의 데이터는 지워지지 않으니
              다시 받아도 중복되지 않습니다.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] space-y-3 overflow-y-auto">
            {(receiveReport ?? []).map((e, i) => (
              <div
                key={i}
                className="rounded-lg border border-line-weak bg-layer-fill px-3 py-2.5"
              >
                <div className="flex items-center justify-between text-[13px] font-bold text-ink">
                  <span>{e.label}</span>
                  <span className="text-[11px] font-medium text-ink-muted">
                    {e.slotName} · 읽은 획 {e.strokes.toLocaleString()}
                    {e.fresh > 0 && ` · 새로 저장 ${e.fresh.toLocaleString()}`}
                  </span>
                </div>
                {e.merged.length > 0 ? (
                  <ul className="mt-1 space-y-0.5 text-[12px] text-ink-muted">
                    {e.merged.map((m, j) => (
                      <li key={j}>
                        {m.title} — 총 {m.strokeCount.toLocaleString()}획 ·{' '}
                        {m.pageCount}페이지 저장 확인
                      </li>
                    ))}
                  </ul>
                ) : e.warnings.length === 0 ? (
                  <div className="mt-1 text-[12px] text-ink-subtle">
                    새 필기 없음 (이미 모두 저장돼 있음)
                  </div>
                ) : null}
                {e.warnings.map((w, j) => (
                  <div
                    key={j}
                    className="mt-1 text-[12px] font-semibold text-critical"
                  >
                    ⚠ {w}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <DialogFooter>
            <ActionButton
              variant="brandSolid"
              size="small"
              onClick={() => setReceiveReport(null)}
            >
              확인
            </ActionButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {penManagementBlock}

    </div>
  );
}
