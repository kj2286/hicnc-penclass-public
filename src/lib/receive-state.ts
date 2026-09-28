/**
 * **크래들 수신 · 자동 채점 진행 상태** — 라우트를 오가도 살아 있는 모듈 상태.
 *
 * 왜 필요한가(사용자 지적 2026-08-19): "필기기록이 완료가 안 된 걸 보고 있는
 * 것 아닌가" 라는 불안. 수신(runReceive)은 페이지를 떠나도 백그라운드로
 * 계속 저장하므로, 그 사이 필기 기록을 열면 **부분 데이터로 AI 채점·분석이
 * 돌 수 있다.** 그래서 진행 상태를 전역으로 알리고, ReviewPage 등은 수신이
 * 끝날 때까지 자동 AI 작업을 미룬다 — 분석은 항상 완전한 필기 기록 위에서만.
 */

type Listener = () => void;

let receiving = false;
/** 자동 채점이 돌고 있는 제출(submission) id 집합 */
const autoGrading = new Set<string>();
let version = 0;
const listeners = new Set<Listener>();

function emit() {
  version++;
  for (const l of [...listeners]) l();
}

/** 크래들 수신 시작/종료 — runReceive 의 try/finally 에서만 부른다 */
export function setReceiving(v: boolean): void {
  if (receiving === v) return;
  receiving = v;
  emit();
}

export function isReceiving(): boolean {
  return receiving;
}

export function beginAutoGrade(submissionId: string): void {
  if (autoGrading.has(submissionId)) return;
  autoGrading.add(submissionId);
  emit();
}

export function endAutoGrade(submissionId: string): void {
  const removed = autoGrading.delete(submissionId);
  const cleared = docStatus.delete(submissionId);
  if (removed || cleared) emit();
}

// ── 문서별 AI 진행 상태 (필기 기록 리스트의 배지·프로그레스용) ──

export type DocAiStatus = {
  stage: '문항 인식' | '채점' | '문항 분석' | '리포트 생성';
  done: number;
  total: number;
};

const docStatus = new Map<string, DocAiStatus>();

/** 파이프라인이 문서 단위 진행 상황을 알린다 — null 이면 제거 */
export function setDocAiStatus(
  submissionId: string,
  status: DocAiStatus | null,
): void {
  if (status === null) {
    if (!docStatus.delete(submissionId)) return;
  } else {
    docStatus.set(submissionId, status);
  }
  emit();
}

export function getDocAiStatus(submissionId: string): DocAiStatus | null {
  return docStatus.get(submissionId) ?? null;
}

// ── 학생별 AI 활동 (학생 관리 리스트의 어포던스용, 2026-08-19 사용자 요구:
//    "어디가 뭘 하고 있는지 리스트에서 조그맣게 보여줘") ──

export type StudentAiActivity = {
  stage: '문항 인식' | '채점' | '문항 분석' | '리포트 생성';
  done: number;
  total: number;
  /** 처리 중인 문서 제목 — 툴팁용 */
  title: string;
};

const studentActivity = new Map<string, StudentAiActivity>();
/** 이 세션에서 파이프라인 처리가 끝난 학생 — 완료 배지 근거 */
const studentDone = new Map<string, { docs: number; failedDocs: number }>();

export function setStudentAiActivity(
  studentId: string,
  a: StudentAiActivity | null,
): void {
  if (a === null) {
    if (!studentActivity.delete(studentId)) return;
  } else {
    studentActivity.set(studentId, a);
  }
  emit();
}

export function getStudentAiActivity(
  studentId: string,
): StudentAiActivity | null {
  return studentActivity.get(studentId) ?? null;
}

export function markStudentAiDocDone(studentId: string, failed: boolean): void {
  const cur = studentDone.get(studentId) ?? { docs: 0, failedDocs: 0 };
  cur.docs += 1;
  if (failed) cur.failedDocs += 1;
  studentDone.set(studentId, cur);
  emit();
}

export function getStudentAiDone(
  studentId: string,
): { docs: number; failedDocs: number } | null {
  return studentDone.get(studentId) ?? null;
}

// ── 지금 AI 과정 분석이 돌고 있는 문항 (문항 칩의 "분석 중" 표시용) ──
// 완료는 표시하지 않는다 — **하고 있는 것만** (사용자 요구 2026-08-19).

const analyzingProblem = new Map<string, string>(); // submissionId → clusterId

export function setAnalyzingProblem(
  submissionId: string,
  clusterId: string | null,
): void {
  if (clusterId === null) {
    if (!analyzingProblem.delete(submissionId)) return;
  } else {
    analyzingProblem.set(submissionId, clusterId);
  }
  emit();
}

export function getAnalyzingProblem(submissionId: string): string | null {
  return analyzingProblem.get(submissionId) ?? null;
}

/** 다른 모듈(learn-report 등)이 자기 상태 변화를 구독자에게 알릴 때 */
export function notifyAiStateChanged(): void {
  emit();
}

/** id 지정: 그 제출이 자동 채점 중인가. 미지정: 무엇이든 채점 중인가. */
export function isAutoGrading(submissionId?: string): boolean {
  return submissionId ? autoGrading.has(submissionId) : autoGrading.size > 0;
}

/** useSyncExternalStore 용 — 상태가 바뀔 때마다 버전이 오른다 */
export function subscribeReceiveState(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function receiveStateVersion(): number {
  return version;
}
