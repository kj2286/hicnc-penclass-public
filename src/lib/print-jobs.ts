/**
 * 출력 목록 — 보낸 ncode 출력 잡을 기억하고 완료까지 따라간다 (순수 모듈).
 *
 * 왜 있나: 출력을 누르면 잡 번호만 한 번 보이고 창을 닫으면 끝이었다. 됐는지
 * 안 됐는지 알 길이 없었다(사용자 요구 2026-09-04: "출력하고 있는 목록을 볼 수
 * 있게, 완료되면 완료라고"). 여기서는 상태 전이와 저장만 다루고, 프린터에 묻는
 * 일(`deskPrintJobStatus`)과 그리기는 바깥에서 한다 — node 테스트가 그대로 부른다.
 *
 * 저장은 localStorage(같은 PC 앱 안에서만 의미가 있는 목록). 새로고침해도 남고,
 * 종료 상태가 된 잡은 하루 지나면 지운다.
 */
import type { DeskJobStatus } from './desk';

export type PrintJobState =
  | 'sending' // 데스크가 PDF 를 받아 프린터로 보내는 중 (잡 번호 없음)
  | 'pending' // 3·4 — 프린터 대기열
  | 'printing' // 5·6 — 찍는 중(6 은 멈춤)
  | 'done' // 프린터가 완료(9)를 확인함
  | 'unknown' // 기록 소실·구버전 앱·전송 중 종료 등으로 확인 필요
  | 'canceled' // 7
  | 'failed'; // 8, 또는 보내기 실패

export type PrintJob = {
  /** 목록 안의 키 — `${submittedAt}-${pdfId}` */
  id: string;
  pdfId: number;
  title: string;
  uri: string;
  printerName: string;
  dpi: 600 | 1200;
  copies: number;
  submittedAt: number;
  updatedAt: number;
  state: PrintJobState;
  /** 프린터가 준 잡 번호 — sending 단계엔 없다 */
  jobId: number | null;
  /** 프린터의 원문 상태 문구 */
  stateText: string;
  /** 해상도 검증 결과 (출력 접수 응답에서) */
  verified: boolean | null;
  /** ADR ngs/0001 §3 세 갈래 — 'unknown' 은 미확인(출력물 폐기 금지). 접수 전엔 null */
  verdict: 'match' | 'mismatch' | 'unknown' | null;
  recordedDpi: number | null;
  impressionsCompleted: number | null;
  /** 실패·취소 사유, 또는 검증 노트 */
  note: string;
};

export const PRINT_JOBS_KEY = 'hicnc.penclass.printJobs';
const KEEP_DONE_MS = 24 * 60 * 60 * 1000;

export const PRINT_STATE_LABEL: Record<PrintJobState, string> = {
  sending: '보내는 중',
  pending: '대기',
  printing: '출력 중',
  done: '완료',
  unknown: '확인 필요',
  canceled: '취소됨',
  failed: '실패',
};

/** 폴링을 계속해야 하는 상태인가 */
export function isActive(state: PrintJobState): boolean {
  return state === 'sending' || state === 'pending' || state === 'printing';
}

/** IPP job-state → 우리 상태. 모르는 값은 진행 중으로 본다(계속 묻는다). */
export function stateFromIpp(jobState: number | null, gone: boolean): PrintJobState {
  if (gone) return 'unknown';
  switch (jobState) {
    case 3:
    case 4:
      return 'pending';
    case 5:
    case 6:
      return 'printing';
    case 7:
      return 'canceled';
    case 8:
      return 'failed';
    case 9:
      return 'done';
    default:
      return 'pending';
  }
}

export function newJob(args: {
  pdfId: number;
  title: string;
  uri: string;
  printerName: string;
  dpi: 600 | 1200;
  copies: number;
  now?: number;
}): PrintJob {
  const now = args.now ?? Date.now();
  return {
    id: `${now}-${args.pdfId}`,
    pdfId: args.pdfId,
    title: args.title,
    uri: args.uri,
    printerName: args.printerName,
    dpi: args.dpi,
    copies: args.copies,
    submittedAt: now,
    updatedAt: now,
    state: 'sending',
    jobId: null,
    stateText: '',
    verified: null,
    verdict: null,
    recordedDpi: null,
    impressionsCompleted: null,
    note: '',
  };
}

/** 출력 접수 응답(잡 번호·검증)을 반영 */
export function markSubmitted(
  job: PrintJob,
  r: { jobId: number; jobState: number | null; jobStateText: string; verified: boolean; verdict?: 'match' | 'mismatch' | 'unknown'; recordedDpi: number | null; note: string },
  now = Date.now(),
): PrintJob {
  return {
    ...job,
    jobId: r.jobId,
    state: stateFromIpp(r.jobState, false),
    stateText: r.jobStateText,
    verified: r.verified,
    verdict: r.verdict ?? (r.verified ? 'match' : r.recordedDpi == null ? 'unknown' : 'mismatch'),
    recordedDpi: r.recordedDpi,
    note: r.note,
    updatedAt: now,
  };
}

export function markSendFailed(job: PrintJob, reason: string, now = Date.now()): PrintJob {
  return { ...job, state: 'failed', note: reason, updatedAt: now };
}

/** 응답을 못 받았어도 프린터가 이미 접수했을 수 있다. 자동 재출력하지 않는다. */
export function markSendUnknown(job: PrintJob, reason: string, now = Date.now()): PrintJob {
  return { ...job, state: 'unknown', note: `출력 접수 여부를 확인하지 못했습니다. 다시 보내기 전에 프린터와 출력물을 확인해 주세요. ${reason}`, updatedAt: now };
}

/** 잡 상태 조회 결과를 반영 — 종료 상태는 되돌리지 않는다 */
export function applyStatus(job: PrintJob, st: DeskJobStatus, now = Date.now()): PrintJob {
  if (!isActive(job.state)) return job;
  const state = stateFromIpp(st.jobState, st.gone);
  return {
    ...job,
    state,
    stateText: st.jobStateText,
    impressionsCompleted: st.impressionsCompleted ?? job.impressionsCompleted,
    note: st.gone ? '프린터에 작업 기록이 없습니다. 출력물을 확인해 주세요.' :
      state === 'failed' && st.reasons.length
        ? `프린터 사유: ${st.reasons.join(', ')}`
        : job.note,
    updatedAt: now,
  };
}

/** 하루 지난 종료 잡은 버린다 (진행 중은 남긴다) */
export function prune(jobs: PrintJob[], now = Date.now()): PrintJob[] {
  return jobs.filter((j) => isActive(j.state) || now - j.updatedAt < KEEP_DONE_MS);
}

export function upsertJob(jobs: PrintJob[], job: PrintJob): PrintJob[] {
  const i = jobs.findIndex((j) => j.id === job.id);
  if (i < 0) return [job, ...jobs];
  const next = jobs.slice();
  next[i] = job;
  return next;
}

export function loadJobs(storage: Pick<Storage, 'getItem'> | null, ownerId: string): PrintJob[] {
  try {
    if (!ownerId) return [];
    const raw = storage?.getItem(`${PRINT_JOBS_KEY}:${ownerId}`);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return prune(arr.filter((j): j is PrintJob => !!j && typeof j === 'object'
      && typeof j.id === 'string' && typeof j.title === 'string'
      && typeof j.uri === 'string' && /^ipps?:\/\//i.test(j.uri)
      && typeof j.printerName === 'string' && typeof j.note === 'string'
      && Object.hasOwn(PRINT_STATE_LABEL, j.state)
      && Number.isFinite(j.submittedAt) && Number.isFinite(j.updatedAt)
      && Number.isSafeInteger(j.pdfId) && j.pdfId > 0
      && (j.jobId === null || (Number.isSafeInteger(j.jobId) && j.jobId > 0)))
      .map(j => j.state === 'sending' ? {
        ...j, state: 'unknown' as const,
        note: '전송 중 프로그램이 닫혔습니다. 다시 출력하기 전에 프린터와 출력물을 확인해 주세요.',
      } : j));
  } catch {
    return [];
  }
}

export function saveJobs(storage: Pick<Storage, 'setItem'> | null, jobs: PrintJob[], ownerId: string): void {
  try {
    if (ownerId) storage?.setItem(`${PRINT_JOBS_KEY}:${ownerId}`, JSON.stringify(prune(jobs)));
  } catch {
    /* 저장소 차단 환경 — 목록은 메모리에만 */
  }
}
