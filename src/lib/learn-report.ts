import type { AssessmentMetadata } from './assessment';
/**
 * 학습분석 리포트 — 문서 모델·저장·AI 생성.
 *
 * 생성은 리뷰 화면에서: (전체 OCR + 문항별 타임라인) 을 조립해 AI(action
 * 'report')에 보내고, 응답과 펜 실측치를 합쳐 ReportDoc 을 만들어 저장한다.
 * 저장은 sp-strokes 버킷 `{studentId}/{submissionId}.learn-report.json`.
 * 편집(텍스트 수정·섹션 순서·숨김)은 ReportPage 가 이 문서를 직접 고친다.
 */
import { requireSupabase } from '@/lib/supabase';
import type { PaperSubject } from './paper-subject';
import { notifyAiStateChanged } from '@/lib/receive-state';
import { loadReportPromptDirective } from '@/lib/paper-prompts';
import { loadClassScores } from '@/lib/class-average';
import { normalizeUnitName } from '@/lib/curriculum';
import { formatDuration } from '@/lib/duration';
import {
  finalVerdict,
  medianActiveMs,
  perceivedDifficulty10,
} from '@/lib/difficulty';
import { lookupPaperUnitEntry } from '@/lib/paper-unit-map';
import type { ModelComparison } from '@/lib/api';
import type { KoreanInsight } from '@/lib/korean-analysis';
import type { ExamInsight } from '@/lib/exam-insight';
import {
  buildExamSummary,
  reportExamFromInsight,
  type ExamReportSummary,
  type ReportExam,
} from '@/lib/exam-summary';
import {
  buildKoreanSummary,
  type KoreanReportSummary,
  type ReportKorean,
} from '@/lib/korean-report';
import { useSessionStore } from '@/store/session.store';
import { downloadJsonObject, uploadJsonObject } from '@/lib/strokes-io';
import type { ProblemTimeline } from '@/lib/problem-timeline';

export type ReportDifficulty = '쉬움' | '보통' | '어려움' | '매우 어려움';
export const REPORT_DIFFICULTIES: ReportDifficulty[] = [
  '쉬움',
  '보통',
  '어려움',
  '매우 어려움',
];

export type ReportProblem = {
  /** 문항 고유 id (클러스터 id) — **라벨은 겹친다**(단계마다 1번이 있다).
   *  이 값이 없는 문서는 옛 방식으로 만든 것이라 정오가 어긋날 수 있다. */
  problemId?: string;
  label: string;
  type: '객관식' | '주관식';
  verdict: 'correct' | 'wrong' | 'unknown';
  guessed: boolean;
  mistake: boolean;
  difficulty: ReportDifficulty;
  comment: string;
  /** 문항별 과정 요약 — "어떻게 풀었고 왜 그렇게 했는지" (리포트의 AI 과정 분석) */
  process?: string;
  /** 선생님이 고쳐 쓴 과정 요약 — 있으면 이걸 보여준다.
   *  원본(process)은 그대로 남겨 [원래대로]로 되돌릴 수 있다 (사용자 2026-08-25). */
  processEdited?: string;
  /** 이 문항이 속한 단계·유형 묶음 — 단계형 테스트지의 "1단계" 같은 소제목.
   *  리포트에서 문항을 단계별로 갈라 보여준다 (사용자 요구 2026-08-25). */
  group?: string;
  /** 이 문항의 단원 — 문항 인식이 읽어낸 값 (정오 분석표) */
  unit?: string;
  /** 단원의 세부내용 — 시험지에 인쇄돼 있거나 정리표에 있을 때만 (2026-08-25) */
  subUnit?: string;
  /** 핵심 개념 한 줄 — 취약 유형 분석표 */
  concept?: string;
  /** 평가 영역 — '개념 이해 및 접근력' | '종합 응용 및 추론력' */
  evalArea?: string;
  /** 행동 영역 — '계산력' | '추론력' | '문제해결력' | '이해력' */
  behaviorArea?: string;
  /** 펜 실측 (타임라인) */
  activeMs: number;
  spanMs: number;
  attempts: number;
  revisits: number;
  /** 모범 풀이 비교 — 문항 분석 캐시에서 옮겨 심는다 (해설이 있는 교재만) */
  modelComparison?: ModelComparison | null;
  /** 국어 전용 — 5-Depth 판정·출제 영역·행동(확신도·수정 궤적).
   *  문항 분석 캐시의 korean 블록을 그대로 옮겨 심는다 (공유 링크도 읽게). */
  korean?: ReportKorean;
  /** 내신 시험지(수학) — 문항 배점. 인식이 못 읽었으면 없음 */
  points?: number | null;
  /** 이 문항이 인쇄된 페이지 번호 — 페이지별 흐름 분석에 쓴다 */
  page?: number | null;
  /** 내신 행동 데이터(번복·부분 점수·막힌 지점) */
  exam?: ReportExam;
};

export type ReportSectionId =
  | 'stats'
  | 'aiProcess'
  | 'problems'
  | 'competency'
  | 'conceptLeak'
  | 'weakTypes'
  | 'difficultyBars'
  // 국어 전용 (마스터 프롬프트 2026-09-05) — 5-Depth 성취 / 행동 트렌드 / 산점도
  | 'koreanDepth'
  | 'koreanBehavior'
  | 'koreanScatter'
  | 'examDashboard'
  | 'examPages'
  | 'examChart'
  | 'penData'
  | 'learner'
  | 'priority'
  | 'difficultyChart'
  | 'overall';

export type ReportSection = {
  id: ReportSectionId;
  title: string;
  visible: boolean;
  /** AI 텍스트 섹션만 — 선생님이 수정 가능 */
  body?: string;
  /** 선생님이 고쳐 쓴 본문. 있으면 이걸 보여주고, [원래대로] 로 되돌린다
   *  (사용자 요구 2026-08-26 — 문항 요약과 같은 방식). */
  bodyEdited?: string;
};

export type LearnReportDoc = {
  assessment?: AssessmentMetadata;
  v: 1;
  /** 라벨이 겹쳤던 문항 — AI 코멘트가 같은 번호끼리 복제됐을 수 있다.
   *  근본 해결은 교재를 [다시 인식]해 "1단계(기본)-1번" 라벨을 얻는 것. */
  duplicateLabels?: string[];
  /** 교재(PDF) **전체** 문항 수 — 학생이 푼 문항 수가 아니다.
   *  리포트는 "20문제 중 3개" 처럼 전체를 분모로 삼아야 한다(사용자 요구). */
  totalProblems?: number;
  /**
   * 교재 과목 (027) — **생성 시점에 문서에 박는다.**
   * 공유 링크(/r/:id)는 로그인이 없어 sp_paper_owners 를 못 읽어 과목을
   * 되찾을 수 없다. 없으면(027 이전 리포트) 수학으로 읽는다.
   */
  subject?: PaperSubject;
  generatedAt: string;
  studentName: string;
  submissionTitle: string;
  problems: ReportProblem[];
  sections: ReportSection[];
  /** 분석 요약에서 선생님이 숨긴 칸 — 공유 링크에도 그대로 반영된다
   *  (사용자 요구 2026-08-27: 편집 결과가 학부모 화면에 나가야 한다). */
  hiddenStats?: string[];
  /** 숨긴 단계 (예: ['3단계']) — 리포트 전 구역에서 그 단계 문항·내용을 감춘다 */
  hiddenStages?: string[];
  /** 이 문서의 교재에 풀이+답안(모범 풀이)이 등록돼 있는가 — 없으면 리포트가
   *  "학생 풀이만으로 분석했다" 고 안내한다 (사용자 요구 2026-09-02) */
  solutionsAvailable?: boolean;
  /**
   * 또래 비교 스냅샷 — **리포트를 만들 때 함께 계산해 저장한다.**
   * 열어 놓고 기다리는 일이 없어야 한다(사용자 요구 2026-08-27): 화면에서
   * 학생들을 훑으면 몇 초씩 비고, 그 사이 "자료 없음" 이 보였다.
   */
  /**
   * 국어 요약 — **생성 시점에 계산해 문서에 박는다** (classStats 와 같은 이유).
   * 공유 링크(/r/:id)는 로그인이 없어 문항 분석 캐시를 못 읽는다.
   */
  koreanSummary?: KoreanReportSummary;
  /** 내신 시험지(수학) 요약 — 종합 대시보드·페이지 흐름·차트 Raw Data.
   *  공유 링크가 원본을 못 읽으므로 생성 시점에 계산해 박는다. */
  examSummary?: ExamReportSummary;
  classStats?: {
    /** 같은 시험지를 푼 다른 학생들의 맞은 개수 (채점 결과 기준) */
    correctCounts: number[];
    students: number;
    computedAt: string;
    /** 단원 → 다른 학생 평균 정답률 — 레이더의 점선 */
    byUnit?: Record<string, number>;
  };
};

/** 라벨에서 단계를 읽어낸다 — "1단계(기본)-3번" 도 "1단계 3번"(옛 형식) 도 잡는다 */
function groupFromLabel(label: string): string {
  const m = /^(.+?)[\s-]+\d+번$/.exec(label.trim());
  return m ? m[1].trim() : '';
}

/** 문항 분석의 korean 블록 → 문서에 심을 최소 값. 없으면 빈 객체(필드 자체를 안 만든다) */
function koreanOf(
  insight: KoreanInsight | null | undefined,
): { korean?: ReportKorean } {
  if (!insight) return {};
  return {
    korean: {
      ...(insight.area ? { area: insight.area } : {}),
      ...(insight.depths?.length ? { depths: insight.depths } : {}),
      confidence: insight.behavior.confidence,
      revision: insight.behavior.revision,
    },
  };
}

/** 라벨에서 문항 번호를 읽어낸다 — "1단계(기본)-3번" → 3 */
function noOf(label: string): number {
  const m = /(\d+)\s*번\s*$/.exec(label.trim());
  return m ? parseInt(m[1], 10) : 0;
}

export function reportPath(studentId: string, submissionId: string): string {
  return `${studentId}/${submissionId}.learn-report.json`;
}

export async function loadLearnReport(
  studentId: string,
  submissionId: string,
): Promise<LearnReportDoc | null> {
  const doc = await downloadJsonObject<LearnReportDoc | null>(
    reportPath(studentId, submissionId),
  );
  return doc && doc.v === 1 ? doc : null;
}

export async function saveLearnReport(
  studentId: string,
  submissionId: string,
  doc: LearnReportDoc,
): Promise<void> {
  await uploadJsonObject(reportPath(studentId, submissionId), doc);
}

type ReportAIResponse = {
  report?: {
    assessment?: AssessmentMetadata;
    problems?: Array<{
      label?: string;
      type?: string;
      verdict?: string;
      guessed?: boolean;
      mistake?: boolean;
      difficulty?: string;
      comment?: string;
      /** 문항별 과정 요약 — 어떻게 풀었고 왜 그랬는지 */
      process?: string;
    }>;
    /** 전체 문제풀이 총정리 (AI 과정 분석 머리글) */
    processOverall?: string;
    learnerAnalysis?: string;
    priorityProblems?: string;
    overall?: string;
  };
  error?: string;
};

/** AI 리포트 생성 호출 (서버 action 'report') */
async function requestReportAI(
  submissionId: string,
  reportContext: string,
  subject?: PaperSubject,
): Promise<NonNullable<ReportAIResponse['report']>> {
  const supabase = requireSupabase();
  const call = async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return fetch('/api/ai', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        action: 'report',
        submissionId,
        reportContext,
        ...(subject ? { subject } : {}),
      }),
    });
  };
  // **일시 오류는 스스로 버틴다** (사용자 원칙 2026-08-18: 완료될 때까지).
  // AI 업스트림(모델 서버)의 5xx·네트워크 순단이 그대로 화면 오류가 되면
  // 사용자가 재시도 노동을 떠안는다 — 3s/6s/12s/24s 백오프로 5회까지.
  let res: Response | null = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      res = await call();
    } catch {
      res = null; // 네트워크 순단
    }
    if (res && res.status === 401) {
      // 토큰 만료 — 한 번 갱신 후 같은 시도 안에서 재호출
      await supabase.auth.refreshSession();
      res = await call().catch(() => null);
    }
    if (res && res.status < 500) break;
    if (attempt < 4) {
      await new Promise((r) => setTimeout(r, 3000 * 2 ** attempt));
    }
  }
  if (!res) {
    throw new Error('네트워크 연결을 확인해주세요 — 리포트 서버에 닿지 못했습니다.');
  }
  const json = (await res.json().catch(() => ({}))) as ReportAIResponse;
  if (!res.ok || !json.report) {
    throw new Error(
      res.status === 401
        ? '로그인이 만료됐습니다 — 로그아웃 후 다시 로그인해 주세요.'
        : (json.error ?? `리포트 생성 실패 (${res.status})`),
    );
  }
  return json.report;
}

/**
 * 리포트 생성 — 리뷰 화면의 상태(전체 OCR·문항 타임라인)로 AI 를 호출하고
 * 펜 실측치를 합쳐 문서를 만든다. 문항 매칭은 라벨 기준.
 */
export async function generateLearnReport(args: {
  submissionId: string;
  studentName: string;
  submissionTitle: string;
  ocrText: string;
  timelines: readonly ProblemTimeline[];
  problemsContext: string;
  /** 교재 전체 문항 수 (PDF 전수 인식 결과) */
  totalProblems?: number;
  /** 교재 과목 — 문서에 그대로 박힌다 (공유 화면에서도 쓰게) */
  subject?: PaperSubject;
  /**
   * **정오의 정본** — 문항 id → 채점(정답지 반영) 결과.
   * 🚨 예전에는 리포트의 정오를 AI 응답에서 가져왔다. AI 가 지문을 다시 읽고
   * 판정을 뒤집는 데다, 라벨이 겹치면(단계마다 1번) 한 응답이 여러 문항에
   * 복제돼 **채점 13정답인데 리포트는 3정답** 이 되는 사고가 났다
   * (이정연J 6-1 A형, 사용자 신고 2026-08-25). 이제 채점 결과를 그대로 쓴다.
   */
  verdictById?: Record<string, 'correct' | 'wrong' | 'unknown' | 'blank'>;
  /** 문항 라벨 → 다른 학생들의 평균 체감 난이도 (있으면 프롬프트에 넘긴다) */
  avgFeltByLabel?: Record<string, number>;
  /** 이 리포트의 학생 id — 또래 비교에서 본인을 빼는 데 쓴다 */
  studentId?: string;
  /** 문항 id → 모범 풀이 비교 (문항 분석 캐시) — 문서에 그대로 심는다 */
  comparisonById?: Record<string, ModelComparison | null | undefined>;
  /** 문항 id → 국어 분석 (문항 분석 캐시의 korean 블록) — 국어 교재만 */
  koreanById?: Record<string, KoreanInsight | null | undefined>;
  /** 문항 id → 내신 행동 데이터 (수학 교재의 문항 분석 exam 블록) */
  examById?: Record<string, ExamInsight | null | undefined>;
  /** 문항 라벨 → 배점 (문항 인식이 읽은 값) */
  pointsByLabel?: Record<string, number | null | undefined>;
  /** 문항 라벨 → 인쇄 페이지 번호 */
  pageByLabel?: Record<string, number | null | undefined>;
  /** 교재에 풀이+답안이 등록돼 있는가 */
  solutionsAvailable?: boolean;
  /** 문항 라벨 → 인식이 읽어낸 태그 (단원·핵심개념·평가영역·행동영역) */
  tagsByLabel?: Record<
    string,
    {
      /** 이 문항이 실린 **교재(PDF) 제목** — 표지 판별이 문서 제목에 기대면
       *  세트로 묶은 뒤 "표지" 가 사라져 계산력 매핑을 놓친다 (2026-08-25) */
      paperTitle?: string;
      group?: string;
      unit?: string;
      subUnit?: string;
      concept?: string;
      evalArea?: string;
      behaviorArea?: string;
    }
  >;
}): Promise<LearnReportDoc> {
  const { submissionId, studentName, submissionTitle } = args;
  const labels = args.timelines.map((t) => t.label);
  // ── 프롬프트가 요구하는 수치를 펜 데이터로 미리 계산 ──
  // 모델이 추측하지 않도록 **우리가 계산해서 넘긴다**(사용자 요구 2026-08-26).
  const med = medianActiveMs(
    args.timelines.map((t) => ({ activeMs: t.activeMs })),
  );
  const feltRows = args.timelines.map((t) => {
    const v = args.verdictById?.[t.id];
    const verdict: 'correct' | 'wrong' | 'unknown' =
      v === 'correct' || v === 'wrong' ? v : 'unknown';
    return {
      label: t.label,
      felt: perceivedDifficulty10(
        {
          verdict,
          attempts: t.segments.length,
          revisits: t.revisits,
          activeMs: t.activeMs,
        },
        { medianActiveMs: med },
      ),
      avg: args.avgFeltByLabel?.[t.label] ?? null,
      verdict:
        verdict === 'correct' ? '맞음' : verdict === 'wrong' ? '틀림' : '판정 불가',
      attempts: t.segments.length,
      activeMs: t.activeMs,
      revisits: t.revisits,
    };
  });
  /** 서버 산정 우선순위 — 프롬프트의 5단계 정의를 그대로 따른다 */
  const priorityText = (() => {
    const buckets = new Map<number, string[]>();
    for (const r of feltRows) {
      let rank: number | null = null;
      if (r.verdict === '틀림') rank = r.felt >= 8 ? 5 : r.attempts >= 2 ? 3 : 2;
      else if (r.verdict === '판정 불가') rank = 5;
      else if (r.felt >= 8) rank = 4; // 맞았지만 크게 헤맴 → 재풀이 후 평가
      else if (r.attempts >= 3) rank = 1; // 맞았지만 여러 번 고쳐 씀 → 실수·개선
      if (rank == null) continue;
      if (!buckets.has(rank)) buckets.set(rank, []);
      buckets
        .get(rank)!
        .push(
          // 시간은 **사람이 읽는 표기**로 넘긴다 — raw 초를 주면 모델이 "180초" 로
          // 그대로 옮겨 적는다(사용자 지적 2026-08-26: 120초는 2분으로).
          `${r.label}(정답여부 ${r.verdict}, 학생시도횟수 ${r.attempts}회, 학생풀이시간 ${formatDuration(r.activeMs)}, 학생체감난이도 ${r.felt})`,
        );
    }
    if (buckets.size === 0) return '';
    const NAME: Record<number, string> = {
      1: '실수 또는 개선 필요',
      2: '원포인트 개념 학습 필요',
      3: '단기 개념 학습 필요',
      4: '재풀이 후 평가',
      5: '중장기 개념 학습 필요',
    };
    return [
      '## 우선 복습 목록 (서버 산정)',
      ...[1, 2, 3, 4, 5]
        .filter((r) => buckets.get(r)?.length)
        .map((r) => `${r}순위(${NAME[r]}): ${buckets.get(r)!.join(', ')}`),
    ].join('\n');
  })();

  const context = [
    `# 문제지: ${submissionTitle} / 학생: ${studentName}`,
    `## 디텍션된 문항 (${labels.length}개) — 반드시 이 라벨 그대로 problems 에 응답하세요`,
    labels.join(', ') || '(문항 디텍션 없음)',
    '',
    args.problemsContext || '(문항별 타임라인 없음)',
    '',
    '## 문제지 전체 OCR (문제 지문 + 학생 풀이·답)',
    args.ocrText || '(OCR 없음)',
    '',
    // 프롬프트가 요구하는 수치를 **미리 계산해 넘긴다** — 모델이 지어내지 않게.
    ...(feltRows.length > 0
      ? [
          '## 체감 난이도 (펜 데이터로 계산, 1~10)',
          '문항 | 학생 체감 | 평균 체감(다른 학생) | 정오 | 시도 | 실제 필기 | 복귀',
          ...feltRows.map(
            (r) =>
              `${r.label} | ${r.felt} | ${r.avg ?? '자료 없음'} | ${r.verdict} | ${r.attempts}회 | ${formatDuration(r.activeMs)} | ${r.revisits}회`,
          ),
          '',
        ]
      : []),
    ...(priorityText ? [priorityText, ''] : []),
    `## 학생·과목\n학생 이름: ${studentName}\n과목(문제지): ${submissionTitle}`,
    '',
    '## 추가 요청 — AI 과정 분석',
    'problems[].process 에 문항마다 **어떻게 풀었고 왜 그렇게 했는지**를 2~3문장으로',
    '적어주세요. 펜 데이터(시도 횟수·복귀·시간)와 실제 풀이 흐름을 근거로 씁니다.',
    'processOverall 에는 이 학생의 **전체 문제풀이에 대한 총정리**를 적어주세요',
    '(풀이 습관·자주 막히는 지점·잘하는 부분).',
  ].join('\n');

  // 학원 리포트 작성 기준 (교재·문항 프롬프트와 같은 토글) — 화면·자동
  // 파이프라인 어느 쪽에서 생성돼도 여기 한 곳에서 동일하게 반영된다
  const academyDirective = await loadReportPromptDirective(
    useSessionStore.getState().profile?.academyId,
  );
  const finalContext = academyDirective
    ? `${context}\n\n${academyDirective}`
    : context;

  const ai = await requestReportAI(submissionId, finalContext, args.subject);
  const byLabel = new Map(
    (ai.problems ?? []).map((p) => [String(p.label ?? ''), p]),
  );
  /** 라벨이 겹치는 문항은 AI 코멘트를 나눠 가질 수 없다 — 몇 개가 겹쳤는지
   *  세어 두었다가, 겹친 리포트는 화면에서 경고한다. */
  const labelCount = new Map<string, number>();
  for (const t of args.timelines) {
    labelCount.set(t.label, (labelCount.get(t.label) ?? 0) + 1);
  }

  const problems: ReportProblem[] = args.timelines.map((t) => {
    const p = byLabel.get(t.label);
    const tag = args.tagsByLabel?.[t.label];
    const canonVerdict = args.verdictById?.[t.id];
    const groupTag = tag?.group ?? groupFromLabel(t.label);
    const canon = lookupPaperUnitEntry(
      tag?.paperTitle || submissionTitle,
      groupTag,
      noOf(t.label),
    );
    return {
      label: t.label,
      type: p?.type === '객관식' ? '객관식' : '주관식',
      problemId: t.id,
      // 정오는 **채점 결과가 정본**이다. 없을 때만 AI 판정으로 물러선다.
      // **정답이 아니면 무조건 틀림** (사용자 지시 2026-08-26).
      // 채점이 답을 못 읽어도 "판정 불가" 로 남기지 않는다 — 정답이 아니니 틀림이다.
      verdict: finalVerdict(canonVerdict ?? p?.verdict),
      guessed: Boolean(p?.guessed),
      mistake: Boolean(p?.mistake),
      difficulty: REPORT_DIFFICULTIES.includes(
        p?.difficulty as ReportDifficulty,
      )
        ? (p?.difficulty as ReportDifficulty)
        : '보통',
      comment: String(p?.comment ?? ''),
      process: String(p?.process ?? ''),
      group: groupTag,
      // 사람이 정리한 시험지 단원표가 있으면 **그것이 정본**이다 —
      // AI 가 지문을 보고 추론한 값보다 우선한다 (사용자 2026-08-25).
      unit: canon?.unit ?? normalizeUnitName(tag?.unit ?? ''),
      // 정리표의 세부 내용은 **핵심 개념 열**로 간다 (사용자 2026-09-02: 내가 준
      // 핵심개념을 써야 한다). 단원 아래 소제목으로 겹쳐 적지 않는다.
      subUnit: canon?.sub ? '' : (tag?.subUnit ?? ''),
      concept: canon?.sub ?? args.tagsByLabel?.[t.label]?.concept ?? '',
      evalArea: args.tagsByLabel?.[t.label]?.evalArea ?? '',
      behaviorArea: args.tagsByLabel?.[t.label]?.behaviorArea ?? '',
      activeMs: t.activeMs,
      spanMs: t.spanMs,
      attempts: t.segments.length,
      revisits: t.revisits,
      modelComparison: args.comparisonById?.[t.id] ?? null,
      ...koreanOf(args.koreanById?.[t.id]),
      ...reportExamFromInsight(args.examById?.[t.id]),
      ...(args.pointsByLabel?.[t.label] != null
        ? { points: args.pointsByLabel[t.label] }
        : {}),
      ...(args.pageByLabel?.[t.label] != null ? { page: args.pageByLabel[t.label] } : {}),
    };
  });

  const duplicateLabels = [...labelCount.entries()]
    .filter(([, n]) => n > 1)
    .map(([l]) => l);

  // 또래 비교를 **여기서** 계산해 문서에 넣는다 — 열 때 기다리지 않게.
  // 실패해도 리포트 생성을 막지 않는다(없으면 화면이 "자료 없음" 으로 둔다).
  const classStats = await loadClassScores(args.studentId, submissionTitle).catch(
    () => null,
  );

  /** 수학 전용 섹션(단원 밸런스·개념 누수·취약 유형)을 넣을지 — 027 */
  const mathOnly = (args.subject ?? '수학') === '수학';
  /** 국어 전용 섹션(5-Depth·행동 트렌드·산점도) — 마스터 프롬프트 2026-09-05 */
  const koreanDoc = args.subject === '국어';

  return {
    v: 1,
    assessment: ai.assessment,
    duplicateLabels: duplicateLabels.length > 0 ? duplicateLabels : undefined,
    ...(classStats ? { classStats } : {}),
    ...(koreanDoc ? { koreanSummary: buildKoreanSummary(problems) } : {}),
    // 내신 시험지(수학) 요약 — 총점·페이지 흐름·차트 (마스터 프롬프트 2026-09-05)
    ...(mathOnly ? { examSummary: buildExamSummary(problems) } : {}),
    generatedAt: new Date().toISOString(),
    studentName,
    submissionTitle,
    totalProblems: args.totalProblems,
    ...(args.subject ? { subject: args.subject } : {}),
    ...(args.solutionsAvailable != null
      ? { solutionsAvailable: args.solutionsAvailable }
      : {}),
    problems,
    sections: [
      { id: 'stats', title: '분석 요약', visible: true },
      // 밸런스 분석은 **AI 과정 분석 위**에 온다 (사용자 요구 2026-08-25).
      // 단원·평가영역·행동영역 태그는 수학 시험지에만 인쇄돼 있다 — 국어·영어·
      // 과학 리포트에 빈 표를 그리면 "왜 비었냐" 는 질문만 늘어난다 (027).
      // 내신 시험지는 **총점·체감 난이도·멘탈 흐름**이 맨 앞에 온다 —
      // 강단에서 먼저 보는 것이 "몇 점이고 어디서 흔들렸나" 다 (마스터 프롬프트 2026-09-05).
      ...(mathOnly
        ? [
            {
              id: 'examDashboard' as const,
              title: '종합 성취도 · 심리 브리핑',
              visible: true,
            },
            {
              id: 'competency' as const,
              title: '단원 및 출제 영역별 성취 밸런스 분석',
              visible: true,
            },
          ]
        : []),
      {
        id: 'aiProcess',
        title: 'AI 과정 분석 (펜 데이터 기반)',
        visible: true,
        body: String(ai.processOverall ?? ''),
      },
      { id: 'problems', title: '문제별 정오 분석', visible: true },
      ...(mathOnly
        ? [
            { id: 'examPages' as const, title: '페이지별 체력 · 집중도 흐름', visible: true },
            { id: 'conceptLeak' as const, title: '핵심 개념 누수 진단', visible: true },
            { id: 'weakTypes' as const, title: '취약 유형 집중 분석', visible: true },
            { id: 'examChart' as const, title: '문항 행동 데이터 (차트용)', visible: true },
          ]
        : []),
      // 국어는 정오 분석 아래에 세 구역이 더 붙는다 — 5-Depth 성취, 펜 궤적에서
      // 읽은 행동 트렌드, 그 둘을 겹쳐 본 산점도 (마스터 프롬프트 2026-09-05).
      ...(koreanDoc
        ? [
            { id: 'koreanDepth' as const, title: '5-Depth 성취 분석', visible: true },
            { id: 'koreanBehavior' as const, title: '행동 트렌드 분석', visible: true },
            { id: 'koreanScatter' as const, title: '인지-행동 산점도', visible: true },
          ]
        : []),
      // 취약 유형 **바로 아래** — 체감 난이도 막대 (문제 난이도는 폐지, 2026-09-02)
      { id: 'difficultyBars', title: '문항별 체감 난이도', visible: true },
      {
        id: 'learner',
        title: '학습자 결과분석',
        visible: true,
        body: String(ai.learnerAnalysis ?? ''),
      },
      {
        id: 'priority',
        title: '우선 학습대상 문제',
        visible: true,
        body: String(ai.priorityProblems ?? ''),
      },
      {
        id: 'overall',
        title: '종합분석 · 향후 지도방향',
        visible: true,
        body: String(ai.overall ?? ''),
      },
    ],
  };
}

// ---------- 파생 통계 (화면·그래프용) ----------

export type ReportStats = {
  total: number;
  objective: number;
  subjective: number;
  correct: number;
  wrong: number;
  unknown: number;
  guessed: number;
  mistakes: number;
  /** 난이도별 { 총, 맞음 } */
  byDifficulty: Record<ReportDifficulty, { total: number; correct: number }>;
};

export function computeReportStats(problems: ReportProblem[]): ReportStats {
  const byDifficulty = Object.fromEntries(
    REPORT_DIFFICULTIES.map((d) => [d, { total: 0, correct: 0 }]),
  ) as ReportStats['byDifficulty'];
  const stats: ReportStats = {
    total: problems.length,
    objective: 0,
    subjective: 0,
    correct: 0,
    wrong: 0,
    unknown: 0,
    guessed: 0,
    mistakes: 0,
    byDifficulty,
  };
  for (const p of problems) {
    if (p.type === '객관식') stats.objective += 1;
    else stats.subjective += 1;
    if (p.verdict === 'correct') stats.correct += 1;
    else if (p.verdict === 'wrong') stats.wrong += 1;
    else stats.unknown += 1;
    if (p.guessed) stats.guessed += 1;
    if (p.mistake) stats.mistakes += 1;
    byDifficulty[p.difficulty].total += 1;
    if (p.verdict === 'correct') byDifficulty[p.difficulty].correct += 1;
  }
  return stats;
}

export const fmtMs = formatDuration;

// ── 화면과 분리된 생성 작업 ────────────────────────────────────────────
//
// 생성은 수십 초 걸린다. 리뷰 화면 안에서만 돌리면 사용자가 다른 메뉴로
// 이동했을 때 리포트 화면이 "아직 없습니다" 로 끝난다(실사고 2026-08-18:
// "버튼 누르고 다른 메뉴 눌렀더니 오류"). 여기 모듈 레벨에 등록해 두면
// SPA 안에서 어디로 이동하든 생성·저장이 끝까지 간다. 리포트 화면은
// 저장본이 없을 때 이 진행 중 작업을 기다린다.

const pendingReports = new Map<string, Promise<LearnReportDoc>>();
/** 학생별 진행 중 리포트 수 — 학생 관리 리스트의 "리포트 생성 중" 표시용 */
const pendingByStudent = new Map<string, number>();

export function isReportPendingForStudent(studentId: string): boolean {
  return (pendingByStudent.get(studentId) ?? 0) > 0;
}

/** 이 제출의 리포트 생성이 진행 중이면 그 Promise (없으면 null) */
export function pendingLearnReport(
  submissionId: string,
): Promise<LearnReportDoc> | null {
  return pendingReports.get(submissionId) ?? null;
}

/**
 * 생성 + 저장을 하나의 전역 작업으로. **누르면 무조건 만들어진다** —
 * 화면 이동과 무관하게 완료되고, 같은 제출의 중복 생성은 기존 작업을 돌려준다.
 */
export function runLearnReport(
  studentId: string,
  args: Parameters<typeof generateLearnReport>[0] & {
    /** 라벨별 채점 정본 — 리포트의 정오·통계는 이것으로 강제 일치시킨다.
     *  LLM 이 정오를 재추론해 맞은 개수·정답률이 채점과 어긋나던 실사고(2026-08-18). */
    gradeByLabel?: Record<string, 'correct' | 'wrong' | 'unknown'>;
  },
): Promise<LearnReportDoc> {
  const existing = pendingReports.get(args.submissionId);
  if (existing) return existing;
  pendingByStudent.set(studentId, (pendingByStudent.get(studentId) ?? 0) + 1);
  notifyAiStateChanged(); // 학생 관리 리스트가 "리포트 생성 중" 을 바로 띄운다
  const task = (async () => {
    const doc = await generateLearnReport(args);
    // 정오 판정의 정본은 채점이다 — LLM 결과를 채점으로 덮는다
    const g = args.gradeByLabel;
    if (g) {
      for (const pr of doc.problems) {
        const v = g[pr.label] ?? g[pr.label.replace(/\s/g, '')];
        if (v === 'correct' || v === 'wrong') pr.verdict = v;
      }
    }
    await saveLearnReport(studentId, args.submissionId, doc);
    return doc;
  })();
  pendingReports.set(args.submissionId, task);
  task
    .finally(() => {
      pendingReports.delete(args.submissionId);
      const n = (pendingByStudent.get(studentId) ?? 1) - 1;
      if (n <= 0) pendingByStudent.delete(studentId);
      else pendingByStudent.set(studentId, n);
      notifyAiStateChanged();
    })
    .catch(() => {});
  return task;
}
