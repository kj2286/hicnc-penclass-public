/**
 * 내신 시험지(수학) 리포트 요약 — 문서에 **박아 두는** 대시보드·페이지 흐름·차트 데이터.
 *
 * 공유 링크(/r/:id)는 로그인이 없어 원본을 못 읽는다. 그래서 국어 요약(korean-report.ts)·
 * 또래 비교(classStats)와 같은 방식으로, 리포트를 만들 때 계산해 문서에 넣는다.
 *
 * 계산 규칙 자체는 `exam-report.ts` 가 정본이고 여기서는 모으기만 한다.
 * 순수 계산만 담는다(supabase·React 없음).
 */
import {
  buildExamChartRows,
  byType,
  pageFlows,
  summarizeExam,
  type ExamChartRow,
  type ExamProblemInput,
  type ExamSummary,
  type PageFlow,
} from './exam-report';

/** 리포트 문항에 심는 내신 값 — 문항 분석(api/ai analyze)의 exam 블록에서 옮겨온다 */
export type ReportExam = {
  /** 지우거나 덧쓴 횟수 — 못 셌으면 생략(0 과 구분한다) */
  overwrites?: number | null;
  overwriteNote?: string;
  /** 서술형 부분 점수 */
  partialPoints?: number | null;
  /** 풀이가 멈춘 계산·논리 단계 */
  blockNote?: string;
};

/** 요약 계산에 필요한 문항 값 — ReportProblem 이 그대로 만족하도록 전부 선택 필드 */
export type ExamSummaryInput = {
  label: string;
  type: '객관식' | '주관식';
  verdict: 'correct' | 'wrong' | 'unknown';
  activeMs: number;
  spanMs: number;
  attempts: number;
  revisits: number;
  unit?: string;
  /** 문항 배점 — 인식이 못 읽었으면 생략 */
  points?: number | null;
  /** 인쇄된 페이지 번호 — 모르면 생략(페이지 흐름에서 빠진다) */
  page?: number | null;
  exam?: ReportExam | null;
};

export type ExamReportSummary = {
  /** 총점·득점·정오·멈칫·체감 난이도 (출력 1: 종합 대시보드) */
  dashboard: ExamSummary;
  /** 페이지별 시간 배분·집중도 (출력 2) */
  pages: PageFlow[];
  /** 유형별(객관식·주관식) 득점 — 내신은 서술형이 성패를 가른다 */
  types: ReturnType<typeof byType>;
  /** 차트·외부 분석용 Raw Data (출력 4) */
  chart: ExamChartRow[];
  /** 번복 횟수를 하나라도 읽어냈는가 — 못 읽었으면 화면이 "미측정" 이라 밝힌다 */
  hasOverwrites: boolean;
};

function toInput(p: ExamSummaryInput): ExamProblemInput {
  return {
    label: p.label,
    points: p.points ?? null,
    type: p.type,
    unit: p.unit,
    verdict: p.verdict,
    partialPoints: p.exam?.partialPoints ?? null,
    activeMs: Math.max(0, p.activeMs),
    spanMs: Math.max(0, p.spanMs),
    attempts: Math.max(0, p.attempts),
    revisits: Math.max(0, p.revisits),
    page: p.page ?? null,
    overwrites: p.exam?.overwrites ?? null,
  };
}

export function buildExamSummary(
  problems: readonly ExamSummaryInput[],
): ExamReportSummary {
  const rows = problems.map(toInput);
  return {
    dashboard: summarizeExam(rows),
    pages: pageFlows(rows),
    types: byType(rows),
    chart: buildExamChartRows(rows),
    hasOverwrites: rows.some((r) => r.overwrites != null),
  };
}

/** 문항 분석의 exam 블록 → 리포트 문항에 심을 값. 비면 아무것도 심지 않는다. */
export function reportExamFromInsight(
  insight:
    | {
        overwrites?: number | null;
        overwriteNote?: string;
        partialPoints?: number | null;
        blockNote?: string;
      }
    | null
    | undefined,
): { exam?: ReportExam } {
  if (!insight) return {};
  const out: ReportExam = {};
  if (insight.overwrites != null) out.overwrites = insight.overwrites;
  if (insight.overwriteNote?.trim()) out.overwriteNote = insight.overwriteNote.trim();
  if (insight.partialPoints != null) out.partialPoints = insight.partialPoints;
  if (insight.blockNote?.trim()) out.blockNote = insight.blockNote.trim();
  return Object.keys(out).length > 0 ? { exam: out } : {};
}
