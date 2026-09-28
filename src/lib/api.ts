import type { AssessmentMetadata } from './assessment';
import type { KoreanInsight } from './korean-analysis';
import type { ExamInsight } from './exam-insight';
/**
 * 펜클래스 데이터 레이어 — 모든 화면은 이 모듈을 통해서만 서버와 통신한다.
 * (Supabase 쿼리 + 서버리스 API 호출)
 */
import { requireSupabase } from '@/lib/supabase';
import { STROKES_BUCKET } from './strokes-io';
import { kstDateKey } from './kst';
import type { Role } from '@/store/session.store';

// ---------- 공통 타입 ----------

export type PenPlan = 'none' | 'basic_3900' | 'plus_4900';
export type PenPlanStatus = 'inactive' | 'active' | 'past_due' | 'canceled';

export type SchoolLevel = '초' | '중' | '고';

export type StudentProfileFields = {
  schoolLevel: SchoolLevel | null;
  grade: number | null;
  studentPhone: string | null;
  parentPhone: string | null;
  school: string | null;
  startDate: string | null;
  address: string | null;
  notes: string | null;
  hasPen: boolean;
};

export type StudentRow = StudentProfileFields & {
  id: string;
  name: string;
  createdAt: string;
  /** null = 재원, 값 있음 = 퇴원 상태 */
  deletedAt: string | null;
  /** 주담당 선생님 id (배정 학생 구분용) */
  teacherId: string | null;
  /** true = 내가 주담당이 아니라 대표자가 배정해준 공동 담당 학생 */
  assignedOnly?: boolean;
};

/** 펜 종류 — 학원 보유 펜은 스마트볼펜/샤프펜 두 갈래다 (016) */
export type PenKind = '' | 'ballpen' | 'sharp';
export const PEN_KIND_LABEL: Record<PenKind, string> = {
  '': '미지정',
  ballpen: '스마트볼펜',
  sharp: '샤프펜',
};

/** 배정 이력 한 건 — 주인이 바뀌어도 이전 학생 필기는 서버에 남는다 (016) */
export type PenHolderEvent = {
  studentId: string | null;
  studentName: string;
  at: string;
};

export type PenRow = {
  id: string;
  teacherId: string;
  mac: string;
  name: string;
  /** 등록 시 입력한 영구 펜 번호 (011 적용 전 데이터는 null) */
  penNumber: number | null;
  assignedStudentId: string | null;
  plan: PenPlan;
  planStatus: PenPlanStatus;
  planStartedAt: string | null;
  createdAt: string;
  /** 크래들 iInterface 모델명 (예: NWP-F45-PD). 016 적용 전엔 '' */
  model: string;
  kind: PenKind;
  holderHistory: PenHolderEvent[];
  /** 함께 쓰는 학생 id 목록 — 다인 사용 구조 (016) */
  sharedStudentIds: string[];
  /** 수집 워터마크(ms) — 이후의 새 획은 수신일 문서로 저장 (016) */
  collectedUntilMs: number;
};

export type SubmissionRow = {
  id: string;
  studentId: string;
  teacherId: string;
  title: string;
  noteLabel: string | null;
  pageCount: number;
  strokeCount: number;
  durationMs: number;
  writtenFrom: string | null;
  writtenTo: string | null;
  strokesPath: string;
  thumbnailPath: string | null;
  status: 'submitted' | 'reviewed';
  feedbackVisible: boolean;
  createdAt: string;
  /** join 된 상대 이름 (조회 API 에 따라 채워짐) */
  studentName?: string;
  teacherName?: string;
};

export type FeedbackRow = {
  id: string;
  submissionId: string;
  teacherId: string;
  body: string;
  ocrText: string | null;
  ocrEdited: string | null;
  updatedAt: string;
};

export const PLAN_LABEL: Record<PenPlan, string> = {
  none: '구독 없음',
  basic_3900: '베이직 · 월 3,900원',
  plus_4900: '플러스 · 월 4,900원 (기능 준비중)',
};

// ---------- 매핑 ----------

function mapStudent(r: Record<string, unknown>): StudentRow {
  return {
    id: String(r.id),
    teacherId: (r.teacher_id as string | null) ?? null,
    name: String(r.name ?? ''),
    createdAt: String(r.created_at ?? ''),
    deletedAt: (r.deleted_at as string | null) ?? null,
    schoolLevel: (r.school_level as SchoolLevel | null) ?? null,
    grade: (r.grade as number | null) ?? null,
    studentPhone: (r.student_phone as string | null) ?? null,
    parentPhone: (r.parent_phone as string | null) ?? null,
    school: (r.school as string | null) ?? null,
    startDate: (r.start_date as string | null) ?? null,
    address: (r.address as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    hasPen: Boolean(r.has_pen),
  };
}

function mapPen(r: Record<string, unknown>): PenRow {
  return {
    id: String(r.id),
    teacherId: String(r.teacher_id),
    mac: String(r.mac),
    name: String(r.name ?? ''),
    penNumber: typeof r.pen_number === 'number' ? r.pen_number : null,
    assignedStudentId: (r.assigned_student_id as string | null) ?? null,
    plan: (r.plan as PenPlan) ?? 'none',
    planStatus: (r.plan_status as PenPlanStatus) ?? 'inactive',
    planStartedAt: (r.plan_started_at as string | null) ?? null,
    createdAt: String(r.created_at ?? ''),
    model: String(r.model ?? ''),
    kind: (r.kind as PenKind) ?? '',
    holderHistory: Array.isArray(r.holder_history)
      ? (r.holder_history as PenHolderEvent[])
      : [],
    sharedStudentIds: Array.isArray(r.shared_student_ids)
      ? (r.shared_student_ids as string[])
      : [],
    collectedUntilMs:
      typeof r.collected_until_ms === 'number' ? r.collected_until_ms : 0,
  };
}

function mapSubmission(r: Record<string, unknown>): SubmissionRow {
  const student = r.student as { name?: string } | null;
  const teacher = r.teacher as { name?: string } | null;
  return {
    id: String(r.id),
    studentId: String(r.student_id),
    teacherId: String(r.teacher_id),
    title: String(r.title ?? ''),
    noteLabel: (r.note_label as string | null) ?? null,
    pageCount: Number(r.page_count ?? 1),
    strokeCount: Number(r.stroke_count ?? 0),
    durationMs: Number(r.duration_ms ?? 0),
    writtenFrom: (r.written_from as string | null) ?? null,
    writtenTo: (r.written_to as string | null) ?? null,
    strokesPath: String(r.strokes_path ?? ''),
    thumbnailPath: (r.thumbnail_path as string | null) ?? null,
    status: (r.status as 'submitted' | 'reviewed') ?? 'submitted',
    feedbackVisible: Boolean(r.feedback_visible),
    createdAt: String(r.created_at ?? ''),
    studentName: student?.name,
    teacherName: teacher?.name,
  };
}

function mapFeedback(r: Record<string, unknown>): FeedbackRow {
  return {
    id: String(r.id),
    submissionId: String(r.submission_id),
    teacherId: String(r.teacher_id),
    body: String(r.body ?? ''),
    ocrText: (r.ocr_text as string | null) ?? null,
    ocrEdited: (r.ocr_edited as string | null) ?? null,
    updatedAt: String(r.updated_at ?? ''),
  };
}

// ---------- 서버리스 API 호출 ----------

async function authedPost<T>(path: string, body: unknown): Promise<T> {
  const supabase = requireSupabase();
  const call = async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return fetch(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  };
  let res = await call();
  if (res.status === 401) {
    // 앱을 하루 종일 켜 두면 액세스 토큰이 만료된 채 남는 일이 있다
    // (2026-08-17 실사고: AI 분석에 "유효하지 않은 세션"). 한 번 갱신 후 재시도.
    await supabase.auth.refreshSession();
    res = await call();
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(
      res.status === 401
        ? '로그인이 만료됐습니다 — 로그아웃 후 다시 로그인해 주세요.'
        : (json.error ?? `요청 실패 (${res.status})`),
    );
  }
  return json;
}

// ---------- 학생 관리 (선생님) ----------

// 학생 기록만 조회한다. 기존 학생의 로그인 정보는 목록으로 가져오지 않는다.
const STUDENT_SELECT = 'id,name,teacher_id,created_at,deleted_at,school_level,grade,student_phone,parent_phone,school,start_date,address,notes,has_pen';

export async function listMyStudents(): Promise<StudentRow[]> {
  const supabase = requireSupabase();
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user.id;
  const { data, error } = await supabase
    .from('sp_profiles')
    .select(STUDENT_SELECT)
    .eq('role', 'student')
    .eq('teacher_id', uid)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const primary = (data ?? []).map(mapStudent);

  // 대표자가 배정해준 공동 담당 학생 — 014 마이그레이션 전에는 테이블이 없어
  // 조회가 실패하므로 조용히 주담당 목록만 반환한다 (기존 동작 그대로).
  let assigned: StudentRow[] = [];
  try {
    const { data: ts, error: tsError } = await supabase
      .from('sp_teacher_students')
      .select('student_id')
      .eq('teacher_id', uid ?? '');
    if (!tsError && ts && ts.length > 0) {
      const ids = ts
        .map((r) => String((r as { student_id: unknown }).student_id))
        .filter((id) => !primary.some((s) => s.id === id));
      if (ids.length > 0) {
        const { data: rows } = await supabase
          .from('sp_profiles')
          .select(STUDENT_SELECT)
          .eq('role', 'student')
          .in('id', ids);
        assigned = (rows ?? [])
          .map(mapStudent)
          .map((s) => ({ ...s, assignedOnly: true }));
      }
    }
  } catch {
    // 마이그레이션 전 — 무시
  }
  if (assigned.length === 0) return primary;
  return [...primary, ...assigned].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

/** 특정 학생의 제출(펜 데이터) 목록 — 선생님 RLS(teacher_id) 로 조회 가능 */
/**
 * 학생별 제출 요약 — **한 번의 조회로** 기록 일수와 마지막 업로드 시각을 함께 낸다.
 * 학생 목록은 이 둘을 같이 쓴다(일수는 버튼 배지, 마지막 시각은 최근 업로드순 정렬).
 */
export type StudentSubmissionSummary = {
  /** 학생 id → 필기 기록 일수 (한국 날짜 기준 고유 일자 수) */
  days: Record<string, number>;
  /** 학생 id → 가장 최근 제출 시각 (ISO) */
  lastAt: Record<string, string>;
};

export async function summarizeSubmissionsByStudent(): Promise<StudentSubmissionSummary> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('sp_submissions')
    .select('student_id, created_at');
  if (error) throw new Error(error.message);
  const days: Record<string, Set<string>> = {};
  const lastAt: Record<string, string> = {};
  for (const r of data ?? []) {
    const sid = String(r.student_id);
    const iso = String(r.created_at);
    const d = new Date(iso);
    const key = kstDateKey(d.getTime()); // 한국 시간 고정
    (days[sid] ??= new Set()).add(key);
    if (!lastAt[sid] || iso > lastAt[sid]) lastAt[sid] = iso;
  }
  return {
    days: Object.fromEntries(Object.entries(days).map(([k, v]) => [k, v.size])),
    lastAt,
  };
}

/** 학생별 필기 기록 일수만 — 옛 호출부 호환 */
export async function countSubmissionDaysByStudent(): Promise<
  Record<string, number>
> {
  return (await summarizeSubmissionsByStudent()).days;
}

/** 학생의 제출(필기 기록) 개수만 — 크래들 재수거 감지용 가벼운 head 카운트 */
export async function countStudentSubmissions(
  studentId: string,
): Promise<number> {
  const supabase = requireSupabase();
  const { count, error } = await supabase
    .from('sp_submissions')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', studentId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function listStudentSubmissions(
  studentId: string,
): Promise<SubmissionRow[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('sp_submissions')
    .select(SUBMISSION_SELECT)
    .eq('student_id', studentId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapSubmission);
}

// ---------- 관리자 AI/OCR 설정 ----------

export type OcrEngine = 'openrouter' | 'gemini';

export type OcrSettings = {
  engine: OcrEngine;
  openrouterModel: string;
};

export type AiSettingsResponse = {
  ocr: OcrSettings;
  env: { openrouter: boolean; gemini: boolean };
  /** 저장된 분석 프롬프트 (빈 문자열이면 기본값 사용 중) */
  analysisPrompt: string;
  defaultAnalysisPrompt: string;
};

export function adminSaveAnalysisPrompt(
  analysisPrompt: string,
): Promise<{ ok: boolean }> {
  return authedPost('/api/ai', { action: 'settings-save', analysisPrompt });
}

// ---------- AI 필적 과정 분석 ----------

export type AnalysisStage = {
  fromMs: number;
  toMs: number;
  title: string;
  body: string;
};

/** 풀이 중 문제점 — 화면에서 빨간색으로 표시 (선생님 수정 가능) */
export type AnalysisIssue = {
  fromMs: number;
  toMs: number;
  title: string;
  why: string;
  suggestion: string;
};

export type AnswerVerdict = 'correct' | 'wrong' | 'unknown';

/** 풀이 결과 판정 — 펜 데이터(시도·재방문·시간) 기반 */
export type SolveOutcome = {
  status: 'solved' | 'partial' | 'attempted' | 'not_attempted' | 'unknown';
  reason: string;
  attempts: number;
  revisits: number;
  timeSpentMs: number;
  perceivedDifficulty: 'easy' | 'normal' | 'hard' | 'unknown';
  difficultyNote: string;
};

export type AnalysisSolution = {
  studentAnswer: string;
  correctAnswer: string;
  verdict: AnswerVerdict;
  explanation: string;
};

/** 모범 풀이 비교 — api/_analysis.ts 의 ModelComparison 과 같은 모양 */
export type ModelComparison = {
  verdict: 'same' | 'similar' | 'different' | 'unknown';
  summary: string;
  studentApproach: string;
  modelApproach: string;
  difference: string;
  whyDifferent: string;
  mismatchNote: string;
  advice: string;
};

export type AnalysisReport = {
  assessment?: AssessmentMetadata;
  headline: string;
  overview: string;
  /** 과정에 대한 서술형 — 시각 표기 없이. 구버전 캐시에는 없다 */
  narrative?: string;
  stages: AnalysisStage[];
  /** pressure 는 폐지(이 펜은 0/1 접촉 여부뿐) — 구캐시 호환용으로만 남김 */
  traits: { pace: string; corrections: string; pressure?: string };
  // 구버전 캐시/수정본에는 없을 수 있다 — 렌더 시 기본값 처리
  psychology?: string;
  issues?: AnalysisIssue[];
  solution?: AnalysisSolution;
  outcome?: SolveOutcome;
  /** 모범 풀이 비교 — 모범 풀이가 있는 문항에서만. 구캐시엔 없다 */
  modelComparison?: ModelComparison | null;
  /** 국어 교재에서만 — 5-Depth 성취 × 행동 심리 (구캐시엔 없다) */
  korean?: KoreanInsight | null;
  /** 수학 교재에서만 — 내신 문항 행동 데이터(번복·부분 점수·인지 블록). 구캐시엔 없다 */
  exam?: ExamInsight | null;
  generatedAt: string;
  model: string;
};

/** 분석 범위 — 전체(미지정) / 그룹·페이지·문항(스트로크 부분집합) */
export type AnalysisScope = { key: string; strokeIds: string[] };

export function analyzeWriting(
  submissionId: string,
  force = false,
  scope?: AnalysisScope,
  /** 범위 전용 OCR(문항 지문+풀이) — 정답 판정·오류 검출 근거 */
  scopeOcrText?: string,
  /** 문항별 타임라인 요약 — 시도·재방문·난이도 판단 근거 */
  problemsContext?: string,
  /** 교재 과목 (027) — 서버가 과목별 분석 프롬프트를 고른다 (미지정 = 수학) */
  subject?: string,
): Promise<{ report: AnalysisReport; cached: boolean }> {
  return authedPost('/api/ai', {
    action: 'analyze',
    submissionId,
    force,
    ...(scope ? { scope } : {}),
    ...(scopeOcrText?.trim() ? { scopeOcrText: scopeOcrText.trim() } : {}),
    ...(problemsContext?.trim() ? { problemsContext: problemsContext.trim() } : {}),
    ...(subject ? { subject } : {}),
  });
}

/** AI 과정 분석(현재 화면 기준)+OCR 을 바탕으로 학생 피드백 코멘트 초안 생성 */
export function generateFeedbackDraft(
  submissionId: string,
  context?: { analysis?: AnalysisReport | null; ocrText?: string | null },
): Promise<{ draft: string }> {
  return authedPost('/api/ai', {
    action: 'feedback-draft',
    submissionId,
    ...(context?.analysis ? { analysis: context.analysis } : {}),
    ...(context?.ocrText ? { ocrText: context.ocrText } : {}),
  });
}

export function adminGetAiSettings(): Promise<AiSettingsResponse> {
  return authedPost('/api/ai', { action: 'settings-get' });
}

export function adminSaveAiSettings(ocr: OcrSettings): Promise<{ ok: boolean }> {
  return authedPost('/api/ai', { action: 'settings-save', ocr });
}

export function adminTestOcr(
  ocr: OcrSettings,
): Promise<{ ok: boolean; engine: string; error?: string }> {
  return authedPost('/api/ai', { action: 'settings-test', ocr });
}

export type StudentTrashAction = 'trash' | 'restore' | 'purge';

/** 학생 휴지통 액션 — 서버리스(서비스키)가 담당 관계 검증 후 수행 */
export function studentTrashAction(
  action: StudentTrashAction,
  studentId: string,
): Promise<{ ok: boolean; action: string; name: string }> {
  return authedPost('/api/student-trash', { action, studentId });
}

/** 학생 생성 시 함께 저장할 선택 프로필 (필수는 name + schoolLevel/grade) */
export type StudentProfileInput = Partial<{
  schoolLevel: SchoolLevel;
  grade: number;
  studentPhone: string;
  parentPhone: string;
  school: string;
  startDate: string;
  address: string;
  notes: string;
  hasPen: boolean;
}>;

export function createStudent(
  name: string,
  profile: StudentProfileInput = {},
): Promise<{ id: string; name: string }> {
  return authedPost('/api/create-student', { name, profile });
}

/** 학생 프로필 수정 — 서버리스가 담당 관계 검증 후 서비스키로 수행 */
export function updateStudentProfile(
  studentId: string,
  profile: StudentProfileInput & { name?: string },
): Promise<{ ok: boolean }> {
  return authedPost('/api/student-trash', {
    action: 'update',
    studentId,
    profile,
  });
}

export async function changeMyPassword(newPassword: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message);
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user.id;
  if (uid) {
    await supabase
      .from('sp_profiles')
      .update({ temp_password: null, must_change_password: false })
      .eq('id', uid);
  }
}

// ---------- 펜 관리 ----------

export async function listMyPens(): Promise<PenRow[]> {
  const supabase = requireSupabase();
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user.id;
  const { data, error } = await supabase
    .from('sp_pens')
    .select('*')
    .eq('teacher_id', uid)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapPen);
}

/** 학원 전체 펜 목록 — 016 정책 적용 시 같은 학원 선생님 펜까지, 미적용이면 내 것만(RLS). */
export async function listAcademyPens(): Promise<PenRow[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('sp_pens')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapPen);
}

/** 크래들에서 발견한 펜을 학원 레지스트리에 등록한다. 016 미적용이면 새 칼럼 없이 재시도. */
export async function registerAcademyPen(input: {
  mac: string;
  name: string;
  model: string;
  kind: PenKind;
  penNumber: number | null;
  holder: { id: string; name: string } | null;
}): Promise<PenRow> {
  const supabase = requireSupabase();
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user.id;
  const base: Record<string, unknown> = {
    teacher_id: uid,
    mac: input.mac,
    name: input.name,
    assigned_student_id: input.holder?.id ?? null,
  };
  const full: Record<string, unknown> = {
    ...base,
    model: input.model,
    kind: input.kind,
    holder_history: input.holder
      ? [
          {
            studentId: input.holder.id,
            studentName: input.holder.name,
            at: new Date().toISOString(),
          },
        ]
      : [],
  };
  if (input.penNumber != null) {
    base.pen_number = input.penNumber;
    full.pen_number = input.penNumber;
  }
  let res = await supabase.from('sp_pens').insert(full).select().single();
  if (res.error && /model|kind|holder_history|pen_number/.test(res.error.message)) {
    // 016(또는 011) 미적용 — 구 스키마 칼럼만으로 재시도
    const legacy = { ...base };
    delete legacy.pen_number;
    res = await supabase.from('sp_pens').insert(legacy).select().single();
  }
  if (res.error) throw new Error(res.error.message);
  return mapPen(res.data);
}

/**
 * 펜 주인 배정/이관/회수 — 이력을 남긴다. 이전 학생의 필기 기록은
 * (학생,날짜) 단위로 서버에 저장돼 있어 이관해도 그대로 보존된다.
 */
export async function assignPenHolder(
  pen: PenRow,
  student: { id: string; name: string } | null,
): Promise<void> {
  const supabase = requireSupabase();
  const event: PenHolderEvent = {
    studentId: student?.id ?? null,
    studentName: student?.name ?? '(회수)',
    at: new Date().toISOString(),
  };
  let res = await supabase
    .from('sp_pens')
    .update({
      assigned_student_id: student?.id ?? null,
      holder_history: [...pen.holderHistory, event],
    })
    .eq('id', pen.id)
    .select('id');
  if (res.error && /holder_history/.test(res.error.message)) {
    // 016 미적용 — 이력 없이 배정만
    res = await supabase
      .from('sp_pens')
      .update({ assigned_student_id: student?.id ?? null })
      .eq('id', pen.id)
      .select('id');
  }
  if (res.error) throw new Error(res.error.message);
  // 🚨 RLS 는 권한 밖 갱신을 **오류 없이 0행**으로 끝낸다 — 그동안 배정이
  // 조용히 무시되고 셀렉트만 원래대로 튕겨, "학생 선택이 안 된다" 로 보였다
  // (2026-08-18 실사고). 0행이면 명시적으로 알린다.
  if (!res.data || res.data.length === 0) {
    throw new Error(
      '배정이 저장되지 않았습니다 — 이 펜의 등록이 삭제됐거나 다른 학원 소속입니다. 화면을 새로고침한 뒤 [펜 등록]부터 다시 해주세요.',
    );
  }
}

/** 수집 워터마크 갱신 — 016 미적용이면 조용히 무시한다(로컬 폴백이 담당). */
export async function updatePenCollectedUntil(
  penId: string,
  ms: number,
): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('sp_pens')
    .update({ collected_until_ms: ms })
    .eq('id', penId);
  if (error && !/collected_until_ms/.test(error.message)) {
    throw new Error(error.message);
  }
}

/** 함께 쓰는 학생 목록 갱신 — 다인 사용 구조 (016). */
export async function setPenSharedStudents(
  penId: string,
  studentIds: string[],
): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('sp_pens')
    .update({ shared_student_ids: studentIds })
    .eq('id', penId);
  if (error) throw new Error(error.message);
}

export async function addPen(input: {
  mac: string;
  name: string;
  penNumber?: number | null;
}): Promise<PenRow> {
  const supabase = requireSupabase();
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user.id;
  const base = { teacher_id: uid, mac: input.mac, name: input.name };
  let res =
    input.penNumber != null
      ? await supabase
          .from('sp_pens')
          .insert({ ...base, pen_number: input.penNumber })
          .select()
          .single()
      : await supabase.from('sp_pens').insert(base).select().single();
  // 011 마이그레이션(pen_number 칼럼) 미적용이면 칼럼 없이 재시도 — 번호는 로컬 폴백이 담당
  if (
    res.error &&
    input.penNumber != null &&
    /pen_number/.test(res.error.message)
  ) {
    res = await supabase.from('sp_pens').insert(base).select().single();
  }
  if (res.error) {
    throw new Error(
      res.error.code === '23505' ? '이미 등록된 펜입니다.' : res.error.message,
    );
  }
  return mapPen(res.data);
}

export async function updatePen(
  id: string,
  patch: Partial<{
    name: string;
    penNumber: number | null;
    assignedStudentId: string | null;
    plan: PenPlan;
    planStatus: PenPlanStatus;
    kind: PenKind;
  }>,
): Promise<void> {
  const supabase = requireSupabase();
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.kind !== undefined) row.kind = patch.kind;
  if (patch.penNumber !== undefined) row.pen_number = patch.penNumber;
  if (patch.assignedStudentId !== undefined)
    row.assigned_student_id = patch.assignedStudentId;
  if (patch.plan !== undefined) {
    row.plan = patch.plan;
    row.plan_status = patch.plan === 'none' ? 'inactive' : 'active';
    row.plan_started_at = patch.plan === 'none' ? null : new Date().toISOString();
  }
  if (patch.planStatus !== undefined) row.plan_status = patch.planStatus;
  const { error } = await supabase.from('sp_pens').update(row).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function removePen(id: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('sp_pens').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ---------- 제출 ----------

const SUBMISSION_SELECT =
  '*, student:sp_profiles!student_id(name), teacher:sp_profiles!teacher_id(name)';

export async function createSubmission(input: {
  title: string;
  noteLabel: string | null;
  pageCount: number;
  strokeCount: number;
  durationMs: number;
  writtenFrom: string | null;
  writtenTo: string | null;
  strokesPath: string;
  thumbnailPath: string | null;
}): Promise<SubmissionRow> {
  const supabase = requireSupabase();
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user.id;
  if (!uid) throw new Error('로그인이 필요합니다.');
  const { data: me } = await supabase
    .from('sp_profiles')
    .select('teacher_id')
    .eq('id', uid)
    .maybeSingle();
  const teacherId = me?.teacher_id as string | null;
  if (!teacherId) {
    throw new Error('담당 선생님이 지정되지 않은 계정입니다. 선생님께 문의해주세요.');
  }
  const { data, error } = await supabase
    .from('sp_submissions')
    .insert({
      student_id: uid,
      teacher_id: teacherId,
      title: input.title,
      note_label: input.noteLabel,
      page_count: input.pageCount,
      stroke_count: input.strokeCount,
      duration_ms: input.durationMs,
      written_from: input.writtenFrom,
      written_to: input.writtenTo,
      strokes_path: input.strokesPath,
      thumbnail_path: input.thumbnailPath,
    })
    .select(SUBMISSION_SELECT)
    .single();
  if (error) throw new Error(error.message);
  return mapSubmission(data);
}

export async function listSubmissions(scope: {
  role: Role;
}): Promise<SubmissionRow[]> {
  const supabase = requireSupabase();
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user.id;
  let query = supabase
    .from('sp_submissions')
    .select(SUBMISSION_SELECT)
    .order('created_at', { ascending: false });
  if (scope.role === 'student') query = query.eq('student_id', uid);
  if (scope.role === 'teacher') query = query.eq('teacher_id', uid);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapSubmission);
}

export async function getSubmission(id: string): Promise<SubmissionRow | null> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('sp_submissions')
    .select(SUBMISSION_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapSubmission(data) : null;
}

export async function updateSubmission(
  id: string,
  patch: Partial<{ status: 'submitted' | 'reviewed'; feedbackVisible: boolean }>,
): Promise<void> {
  const supabase = requireSupabase();
  const row: Record<string, unknown> = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.feedbackVisible !== undefined)
    row.feedback_visible = patch.feedbackVisible;
  const { error } = await supabase
    .from('sp_submissions')
    .update(row)
    .eq('id', id);
  if (error) throw new Error(error.message);
}

/**
 * 제출(필기 기록) 삭제 — **본문(스토리지)까지** 지운다.
 *
 * 순서가 중요하다: 스토리지 먼저, DB 행은 마지막. 반대로 하면 행이 사라진 뒤
 * 스토리지 삭제가 실패했을 때 고아 파일을 찾을 방법이 없다. 스토리지가 먼저
 * 실패하면 행이 남아 있어 다시 시도할 수 있다.
 *
 * RLS 는 권한 밖 삭제를 **오류 없이 0행**으로 끝내므로, 삭제된 행 수를 확인해
 * 0 이면 명시적으로 실패를 알린다 (020_submission_delete.sql 적용 필요).
 */
export async function deleteSubmission(sub: {
  id: string;
  strokesPath: string;
  thumbnailPath: string | null;
}): Promise<void> {
  const supabase = requireSupabase();
  const paths = [sub.strokesPath, sub.thumbnailPath].filter(
    (p): p is string => !!p,
  );
  if (paths.length > 0) {
    const { error } = await supabase.storage.from(STROKES_BUCKET).remove(paths);
    if (error) throw new Error(`필기 원본 삭제 실패: ${error.message}`);
  }
  const { data, error } = await supabase
    .from('sp_submissions')
    .delete()
    .eq('id', sub.id)
    .select('id');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error(
      '삭제 권한이 없습니다 — DB 마이그레이션(020_submission_delete.sql)이 적용됐는지 확인하세요.',
    );
  }
}

// ---------- 알림 ----------

export type NotificationRow = {
  id: string;
  userId: string;
  type: 'feedback';
  submissionId: string | null;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
};

function mapNotification(r: Record<string, unknown>): NotificationRow {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    type: (r.type as 'feedback') ?? 'feedback',
    submissionId: (r.submission_id as string | null) ?? null,
    title: String(r.title ?? ''),
    body: String(r.body ?? ''),
    read: Boolean(r.read),
    createdAt: String(r.created_at ?? ''),
  };
}

export async function listNotifications(): Promise<NotificationRow[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('sp_notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapNotification);
}

export async function markNotificationRead(id: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('sp_notifications')
    .update({ read: true })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function markAllNotificationsRead(): Promise<void> {
  const supabase = requireSupabase();
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user.id;
  const { error } = await supabase
    .from('sp_notifications')
    .update({ read: true })
    .eq('user_id', uid)
    .eq('read', false);
  if (error) throw new Error(error.message);
}

/**
 * 선생님이 피드백을 학생에게 공개할 때 호출 — 서버리스(/api/notify-feedback)가
 * 담당 선생님인지 검증한 뒤 학생 대상 알림을 만든다. (테이블 RLS insert 우회)
 */
export async function notifyFeedbackPublished(
  submission: { id: string },
): Promise<void> {
  await authedPost('/api/notify-feedback', { submissionId: submission.id });
}

// ---------- 피드백 ----------

export async function getFeedback(
  submissionId: string,
): Promise<FeedbackRow | null> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('sp_feedback')
    .select('*')
    .eq('submission_id', submissionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapFeedback(data) : null;
}

export async function upsertFeedback(
  submissionId: string,
  patch: Partial<{ body: string; ocrText: string | null; ocrEdited: string | null }>,
): Promise<void> {
  const supabase = requireSupabase();
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user.id;
  const row: Record<string, unknown> = {
    submission_id: submissionId,
    teacher_id: uid,
    updated_at: new Date().toISOString(),
  };
  if (patch.body !== undefined) row.body = patch.body;
  if (patch.ocrText !== undefined) row.ocr_text = patch.ocrText;
  if (patch.ocrEdited !== undefined) row.ocr_edited = patch.ocrEdited;
  const { error } = await supabase
    .from('sp_feedback')
    .upsert(row, { onConflict: 'submission_id' });
  if (error) throw new Error(error.message);
}

// ---------- OCR ----------

export function recognizeImage(
  imageDataUrl: string,
  prompt?: string,
  grading?: { subject: string; question: string },
): Promise<{ text: string }> {
  return authedPost('/api/ai', {
    action: 'ocr',
    image: imageDataUrl,
    ...(grading ? { grading } : {}),
    ...(prompt ? { prompt } : {}),
  });
}

// ---------- 펜 펌웨어 배포 (관리자 업로드 → 선생님 수신) ----------

export type AdminProfileRow = StudentRow & {
  role: Role;
  teacherId: string | null;
  teacherName?: string;
  /** (선생님 행) 소속 학원 */
  academyId: string | null;
  academyName?: string;
  /** (학생 행) 담당 선생님의 소속 학원 — 학생의 학원은 선생님을 통해 파생.
   *  이름은 화면에서 adminListAcademies 결과로 매핑한다. */
  teacherAcademyId?: string | null;
  /** (선생님 행) 학원 대표자 여부·전화번호·대상학생 (014) */
  isAcademyOwner: boolean;
  phone: string | null;
  teacherStudentLevels: StudentLevel[];
};

export async function adminListProfiles(role?: Role): Promise<AdminProfileRow[]> {
  const supabase = requireSupabase();
  const buildQuery = (select: string) => {
    let q = supabase
      .from('sp_profiles')
      .select(select)
      .order('created_at', { ascending: false });
    if (role) q = q.eq('role', role);
    return q;
  };
  // sp_profiles 의 teacher_id 는 같은 테이블을 가리키는 self-FK 라
  // PostgREST 임베드가 방향을 "자식"으로 잘못 잡아 빈 배열을 준다.
  // → 담당 선생님/그 학원은 임베드 대신 선생님 프로필을 따로 조회해 매핑한다.
  let hasAcademy = true;
  let { data, error } = await buildQuery('*, academy:sp_academies!academy_id(name)');
  if (error && /sp_academies|academy|schema cache|does not exist/i.test(error.message)) {
    // 009 마이그레이션(sp_academies) 적용 전 — 학원 조인 없이 폴백 조회
    hasAcademy = false;
    ({ data, error } = await buildQuery('*'));
  }
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Record<string, unknown>[];

  // 담당 선생님(id → {name, academy_id}) 룩업 — 학생 행의 선생님/학원 파생용.
  const teacherIds = [
    ...new Set(
      rows
        .map((r) => r.teacher_id as string | null)
        .filter((v): v is string => Boolean(v)),
    ),
  ];
  const teacherMap = new Map<string, { name: string; academyId: string | null }>();
  if (teacherIds.length > 0) {
    const { data: tData } = await supabase
      .from('sp_profiles')
      .select('id, name, academy_id')
      .in('id', teacherIds);
    for (const t of (tData ?? []) as Record<string, unknown>[]) {
      teacherMap.set(String(t.id), {
        name: String(t.name ?? ''),
        academyId: (t.academy_id as string | null) ?? null,
      });
    }
  }

  return rows.map((r) => {
    const teacherId = (r.teacher_id as string | null) ?? null;
    const teacher = teacherId ? teacherMap.get(teacherId) : undefined;
    return {
      ...mapStudent(r),
      role: r.role as Role,
      teacherId,
      teacherName: teacher?.name,
      academyId: hasAcademy ? ((r.academy_id as string | null) ?? null) : null,
      academyName: (r.academy as { name?: string } | null)?.name,
      teacherAcademyId: teacher?.academyId ?? null,
      isAcademyOwner: Boolean(r.is_academy_owner),
      phone: (r.phone as string | null) ?? null,
      teacherStudentLevels: Array.isArray(r.student_levels)
        ? (r.student_levels as StudentLevel[])
        : [],
    };
  });
}

// ---------- 펜 재고 (관리자 — sp_settings 'pen_inventory') ----------

export type PenInventory = {
  /** 스마트볼펜 총 보유 자루 수 (포스트매스 재고) */
  smartBallpen: number;
  /** 샤프펜 총 보유 자루 수 */
  sharpPen: number;
};

export async function adminGetPenInventory(): Promise<PenInventory> {
  const supabase = requireSupabase();
  const { data } = await supabase
    .from('sp_settings')
    .select('value')
    .eq('key', 'pen_inventory')
    .maybeSingle();
  const v = (data?.value ?? {}) as Partial<PenInventory>;
  return {
    smartBallpen: Math.max(0, Math.round(Number(v.smartBallpen) || 0)),
    sharpPen: Math.max(0, Math.round(Number(v.sharpPen) || 0)),
  };
}

export async function adminSavePenInventory(inv: PenInventory): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('sp_settings').upsert({
    key: 'pen_inventory',
    value: inv,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

// ---------- 학원별 펜 배포 수량 (관리자 설정 — sp_settings 'pen_allocations') ----------

export type PenAllocation = { smartBallpen: number; sharpPen: number };

export async function adminGetPenAllocations(): Promise<
  Record<string, PenAllocation>
> {
  const supabase = requireSupabase();
  const { data } = await supabase
    .from('sp_settings')
    .select('value')
    .eq('key', 'pen_allocations')
    .maybeSingle();
  const raw = (data?.value ?? {}) as Record<string, Partial<PenAllocation>>;
  const out: Record<string, PenAllocation> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = {
      smartBallpen: Math.max(0, Math.round(Number(v?.smartBallpen) || 0)),
      sharpPen: Math.max(0, Math.round(Number(v?.sharpPen) || 0)),
    };
  }
  return out;
}

/** 한 학원의 배포 수량 저장 (병합 upsert) */
export async function adminSavePenAllocation(
  academyId: string,
  alloc: PenAllocation,
): Promise<void> {
  const supabase = requireSupabase();
  const current = await adminGetPenAllocations();
  const { error } = await supabase.from('sp_settings').upsert({
    key: 'pen_allocations',
    value: { ...current, [academyId]: alloc },
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

/** (관리자) 공동 담당 배정 전체 — 학원 상세에서 선생님별 배정 학생 표시용.
 *  014 미적용(테이블 없음)이면 빈 배열. */
export async function adminListTeacherAssignments(): Promise<
  Array<{ teacherId: string; studentId: string }>
> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('sp_teacher_students')
    .select('teacher_id, student_id');
  if (error || !data) return [];
  return (data as Array<{ teacher_id: string; student_id: string }>).map(
    (r) => ({ teacherId: String(r.teacher_id), studentId: String(r.student_id) }),
  );
}

// ---------- 학원 (관리자) ----------

export type AcademyRow = {
  id: string;
  name: string;
  memo: string | null;
  /** 자가 가입 시 입력한 학원 위치 (014) */
  location: string | null;
  createdAt: string;
  /** 학원 전용 홈페이지 주소 — /h/{slug} (017). 아직 안 정했으면 null */
  slug: string | null;
  /** 홈페이지를 마지막으로 올린 시각. null 이면 아직 홈페이지 없음 */
  sitePublishedAt: string | null;
  /** 올린 원본 ZIP 파일명 — 무엇을 올렸는지 알아보게 */
  siteSourceName: string | null;
};

function mapAcademy(r: Record<string, unknown>): AcademyRow {
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    memo: (r.memo as string | null) ?? null,
    location: (r.location as string | null) ?? null,
    createdAt: String(r.created_at ?? ''),
    slug: (r.slug as string | null) ?? null,
    sitePublishedAt: (r.site_published_at as string | null) ?? null,
    siteSourceName: (r.site_source_name as string | null) ?? null,
  };
}

export async function adminListAcademies(): Promise<AcademyRow[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('sp_academies')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapAcademy);
}

export async function adminCreateAcademy(input: {
  name: string;
  memo?: string;
}): Promise<AcademyRow> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('sp_academies')
    .insert({ name: input.name, memo: input.memo || null })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return mapAcademy(data);
}

export async function adminUpdateAcademy(
  id: string,
  input: { name: string; memo?: string },
): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('sp_academies')
    .update({ name: input.name, memo: input.memo || null })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function adminDeleteAcademy(id: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('sp_academies').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ---------- 학원 전용 홈페이지 (017) ----------

/** 홈페이지 주소(slug) 지정. 전역 유일 — 겹치면 알아볼 수 있는 문구로 바꿔 던진다. */
export async function adminSetAcademySlug(
  id: string,
  slug: string,
): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('sp_academies')
    .update({ slug })
    .eq('id', id);
  if (error) {
    if (/duplicate key|unique/i.test(error.message))
      throw new Error('이미 다른 학원이 쓰고 있는 주소입니다.');
    throw new Error(error.message);
  }
}

/**
 * 홈페이지 파일 한 벌을 올린다. (관리자 브라우저에서 Storage 로 직접 —
 * 서버리스 함수가 이미 12개로 한도라 새로 못 만든다.)
 *
 * 같은 학원에 다시 올리면 **이전 파일을 먼저 지운다** — 안 지우면 예전 페이지가
 * 남아 새 홈페이지에 없는 주소가 계속 살아있게 된다.
 */
export async function adminUploadAcademySite(
  academyId: string,
  slug: string,
  files: { path: string; body: Blob; contentType: string }[],
  sourceName: string,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const supabase = requireSupabase();
  const bucket = supabase.storage.from('academy-sites');

  // 1) 이전 게시물 제거
  const { data: old } = await bucket.list(slug, { limit: 1000 });
  if (old && old.length > 0) {
    const stale = await collectPaths(bucket, slug);
    if (stale.length > 0) await bucket.remove(stale);
  }

  // 2) 새 파일 업로드
  let done = 0;
  for (const f of files) {
    const { error } = await bucket.upload(`${slug}/${f.path}`, f.body, {
      contentType: f.contentType,
      upsert: true,
      // 홈페이지를 새로 올렸는데 방문자가 옛 화면을 보면 안 된다
      cacheControl: '60',
    });
    if (error) throw new Error(`${f.path}: ${error.message}`);
    done += 1;
    onProgress?.(done, files.length);
  }

  // 3) 게시 기록 — 이게 있어야 /h/{slug} 가 열린다
  const { data: session } = await supabase.auth.getSession();
  const { error } = await supabase
    .from('sp_academies')
    .update({
      site_published_at: new Date().toISOString(),
      site_published_by: session.session?.user.id ?? null,
      site_source_name: sourceName,
    })
    .eq('id', academyId);
  if (error) throw new Error(error.message);
}

/** 폴더 아래 모든 파일 경로를 모은다 (Storage 는 재귀 조회가 없다) */
async function collectPaths(
  bucket: ReturnType<ReturnType<typeof requireSupabase>['storage']['from']>,
  prefix: string,
): Promise<string[]> {
  const out: string[] = [];
  const { data } = await bucket.list(prefix, { limit: 1000 });
  for (const entry of data ?? []) {
    const full = `${prefix}/${entry.name}`;
    // id 가 없으면 폴더 — 한 단계 더 들어간다
    if (entry.id) out.push(full);
    else out.push(...(await collectPaths(bucket, full)));
  }
  return out;
}

/** 홈페이지를 내린다 — 파일은 지우지 않고 게시만 해제(되돌리기 쉽게) */
export async function adminUnpublishAcademySite(id: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('sp_academies')
    .update({ site_published_at: null })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export type AcademySiteRow = {
  id: string;
  name: string;
  slug: string;
  logoText: string | null;
  logoImageUrl: string | null;
  themeColor: string | null;
};

/** slug 로 게시된 학원 홈페이지를 찾는다 — 로그인 없이 열리는 공개 조회 */
export async function getAcademySite(
  slug: string,
): Promise<AcademySiteRow | null> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('sp_academy_sites')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    slug: String(r.slug ?? ''),
    logoText: (r.logo_text as string | null) ?? null,
    logoImageUrl: (r.logo_image_url as string | null) ?? null,
    themeColor: (r.theme_color as string | null) ?? null,
  };
}

/** 홈페이지 첫 화면의 공개 URL (iframe 이 띄울 주소) */
export function academySiteEntryUrl(slug: string): string {
  const supabase = requireSupabase();
  return supabase.storage
    .from('academy-sites')
    .getPublicUrl(`${slug}/index.html`).data.publicUrl;
}

/** 선생님의 소속 학원 배정/해제 (관리자) */
export async function adminSetTeacherAcademy(
  teacherId: string,
  academyId: string | null,
): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('sp_profiles')
    .update({ academy_id: academyId })
    .eq('id', teacherId);
  if (error) throw new Error(error.message);
}

export async function adminListPens(): Promise<
  Array<PenRow & { teacherName?: string; studentName?: string }>
> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('sp_pens')
    .select(
      '*, teacher:sp_profiles!teacher_id(name), student:sp_profiles!assigned_student_id(name)',
    )
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    ...mapPen(r),
    teacherName: (r.teacher as { name?: string } | null)?.name,
    studentName: (r.student as { name?: string } | null)?.name,
  }));
}

export function createTeacher(input: {
  name: string;
  email: string;
  password: string;
}): Promise<{ id: string }> {
  return authedPost('/api/create-teacher', input);
}

// ---------- 학원 회원체계 (가입·선생님관리·배정·브랜딩) ----------

export type StudentLevel = '초' | '중' | '고' | '재수생' | '기타';
export const STUDENT_LEVELS: StudentLevel[] = ['초', '중', '고', '재수생', '기타'];

export type AcademyTeacherRow = {
  id: string;
  name: string;
  /** 이메일(=아이디) */
  email: string | null;
  phone: string | null;
  studentLevels: StudentLevel[];
  isOwner: boolean;
  mustChangePassword: boolean;
  tempPassword: string | null;
  createdAt: string;
};

function mapAcademyTeacher(r: Record<string, unknown>): AcademyTeacherRow {
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    email: (r.username as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
    studentLevels: Array.isArray(r.student_levels)
      ? (r.student_levels as StudentLevel[])
      : [],
    isOwner: Boolean(r.is_academy_owner),
    mustChangePassword: Boolean(r.must_change_password),
    tempPassword: (r.temp_password as string | null) ?? null,
    createdAt: String(r.created_at ?? ''),
  };
}

async function myAcademyId(): Promise<string> {
  const supabase = requireSupabase();
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user.id;
  const { data, error } = await supabase
    .from('sp_profiles')
    .select('academy_id')
    .eq('id', uid ?? '')
    .maybeSingle();
  if (error) throw new Error(error.message);
  const academyId = (data as { academy_id?: string | null } | null)?.academy_id;
  if (!academyId) throw new Error('소속 학원이 없습니다. (마이그레이션 필요)');
  return academyId;
}

/** 학원 회원가입 — 인증 불필요 (authedPost 는 세션 없으면 토큰 없이 호출) */
export function signupAcademy(input: {
  name: string;
  phone: string;
  email: string;
  password: string;
  academyName: string;
  academyLocation: string;
}): Promise<{ id: string; academyId: string }> {
  return authedPost('/api/academy', { action: 'signup', ...input });
}

/** 우리 학원 선생님 목록 (대표자 화면) */
export async function listAcademyTeachers(): Promise<AcademyTeacherRow[]> {
  const supabase = requireSupabase();
  const academyId = await myAcademyId();
  const { data, error } = await supabase
    .from('sp_profiles')
    .select('*')
    .eq('role', 'teacher')
    .eq('academy_id', academyId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapAcademyTeacher);
}

export function createAcademyTeacher(input: {
  name: string;
  phone: string;
  email: string;
  studentLevels: StudentLevel[];
}): Promise<{ id: string; email: string; tempPassword: string }> {
  return authedPost('/api/academy', { action: 'create-teacher', ...input });
}

export function deleteAcademyTeacher(teacherId: string): Promise<{ ok: true }> {
  return authedPost('/api/academy', { action: 'delete-teacher', teacherId });
}

/** 우리 학원 전체 학생 (대표자 — 배정 화면용, 주담당 선생님 무관) */
export async function listAcademyStudents(): Promise<StudentRow[]> {
  const supabase = requireSupabase();
  const academyId = await myAcademyId();
  const { data: teachers, error: tError } = await supabase
    .from('sp_profiles')
    .select('id')
    .eq('role', 'teacher')
    .eq('academy_id', academyId);
  if (tError) throw new Error(tError.message);
  const teacherIds = (teachers ?? []).map((t) => String((t as { id: unknown }).id));
  if (teacherIds.length === 0) return [];
  const { data, error } = await supabase
    .from('sp_profiles')
    .select(STUDENT_SELECT)
    .eq('role', 'student')
    .in('teacher_id', teacherIds)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapStudent);
}

/** 선생님별 배정(공동 담당) 현황 — { teacherId: studentId[] } */
export async function listTeacherAssignments(): Promise<Record<string, string[]>> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('sp_teacher_students')
    .select('teacher_id, student_id');
  if (error) throw new Error(error.message);
  const out: Record<string, string[]> = {};
  for (const r of (data ?? []) as Array<{ teacher_id: string; student_id: string }>) {
    (out[r.teacher_id] ??= []).push(r.student_id);
  }
  return out;
}

/** 배정 반영 — 추가/제거를 diff 로 전달 (대표자 RLS) */
export async function setTeacherAssignments(
  teacherId: string,
  addStudentIds: string[],
  removeStudentIds: string[],
): Promise<void> {
  const supabase = requireSupabase();
  if (addStudentIds.length > 0) {
    const { error } = await supabase.from('sp_teacher_students').insert(
      addStudentIds.map((sid) => ({ teacher_id: teacherId, student_id: sid })),
    );
    if (error) throw new Error(error.message);
  }
  if (removeStudentIds.length > 0) {
    const { error } = await supabase
      .from('sp_teacher_students')
      .delete()
      .eq('teacher_id', teacherId)
      .in('student_id', removeStudentIds);
    if (error) throw new Error(error.message);
  }
}

/** 학원 브랜딩(이름·위치·로고·테마 색) 수정 — 대표자 RLS */
export async function updateMyAcademy(patch: {
  name?: string;
  location?: string | null;
  logoText?: string | null;
  logoImageUrl?: string | null;
  themeColor?: string | null;
  /** 교재·문항별 AI 프롬프트 별도 설정 (021 마이그레이션 필요) */
  customPromptsEnabled?: boolean;
}): Promise<void> {
  const supabase = requireSupabase();
  const academyId = await myAcademyId();
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.location !== undefined) row.location = patch.location;
  if (patch.logoText !== undefined) row.logo_text = patch.logoText;
  if (patch.logoImageUrl !== undefined) row.logo_image_url = patch.logoImageUrl;
  if (patch.themeColor !== undefined) row.theme_color = patch.themeColor;
  if (patch.customPromptsEnabled !== undefined)
    row.custom_prompts_enabled = patch.customPromptsEnabled;
  const { error } = await supabase
    .from('sp_academies')
    .update(row)
    .eq('id', academyId);
  if (error) throw new Error(error.message);
}

/** 로고 이미지 업로드 — 서버 API 경유(스토리지 RLS 비의존) → 공개 URL 반환.
 *  PNG·JPG·WebP·SVG, 2MB 이하. */
export async function uploadAcademyLogo(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const { url } = await authedPost<{ url: string }>('/api/academy', {
    action: 'upload-logo',
    contentType: file.type || 'image/png',
    dataBase64: btoa(binary),
  });
  return url;
}

// ---------- 학원 도입 신청 (랜딩페이지 접수 → 슈퍼관리자) ----------

export type AcademyApplicationRow = {
  id: string;
  academyName: string;
  location: string;
  studentCount: number | null;
  teacherCount: number | null;
  contactName: string | null;
  contactPhone: string;
  contactEmail: string | null;
  memo: string | null;
  status: 'new' | 'contacted' | 'done' | 'rejected';
  adminNote: string | null;
  createdAt: string;
};

/** 신청 접수 — **로그인 없이** 호출된다(랜딩페이지 폼). */
export async function submitAcademyApplication(
  row: Record<string, unknown>,
): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('sp_academy_applications').insert(row);
  if (error) throw new Error(error.message);
}

function mapApplication(r: Record<string, unknown>): AcademyApplicationRow {
  return {
    id: String(r.id),
    academyName: String(r.academy_name ?? ''),
    location: String(r.location ?? ''),
    studentCount: (r.student_count as number | null) ?? null,
    teacherCount: (r.teacher_count as number | null) ?? null,
    contactName: (r.contact_name as string | null) ?? null,
    contactPhone: String(r.contact_phone ?? ''),
    contactEmail: (r.contact_email as string | null) ?? null,
    memo: (r.memo as string | null) ?? null,
    status: (r.status as AcademyApplicationRow['status']) ?? 'new',
    adminNote: (r.admin_note as string | null) ?? null,
    createdAt: String(r.created_at ?? ''),
  };
}

/** 접수 목록 (슈퍼관리자) — 최근 순 */
export async function adminListApplications(): Promise<AcademyApplicationRow[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('sp_academy_applications')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapApplication);
}

/** 처리 상태·메모 갱신 (슈퍼관리자) */
export async function adminUpdateApplication(
  id: string,
  patch: { status?: AcademyApplicationRow['status']; adminNote?: string },
): Promise<void> {
  const supabase = requireSupabase();
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.adminNote !== undefined) row.admin_note = patch.adminNote;
  const { error } = await supabase
    .from('sp_academy_applications')
    .update(row)
    .eq('id', id);
  if (error) throw new Error(error.message);
}
