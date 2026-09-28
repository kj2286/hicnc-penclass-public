/**
 * 국어 리포트 요약 — 문서에 **박아 두는** 5-Depth·행동 집계.
 *
 * 공유 링크(/r/:id)는 로그인이 없어 원본(문항 분석 캐시)을 못 읽는다. 그래서
 * classStats 와 같은 방식으로, 리포트를 만들 때 여기서 계산해 문서에 넣는다.
 *
 * 이 파일은 순수 계산만 담는다(supabase·React 없음) — learn-report.ts 를
 * 통째로 끌고 오지 않고 node 테스트가 그대로 부를 수 있어야 한다.
 * 계산 규칙 자체는 korean-analysis.ts 가 정본이고 여기서는 모으기만 한다.
 */
import {
  KOREAN_AREAS,
  buildScatter,
  depthScoreRate,
  hiddenKillers,
  revisionCounts,
  type KoreanDepth,
  type KoreanDepthScore,
  type KoreanProblemStat,
  type RevisionKind,
  type ScatterPoint,
} from './korean-analysis';

/** 리포트 문항에 심는 국어 값 — 문항 분석(api/ai analyze)의 korean 블록에서 옮겨온다 */
export type ReportKorean = {
  /** 출제 영역 (화법·작문·문법·독서·문학) */
  area?: string;
  depths?: KoreanDepthScore[];
  /** ConfidenceLevel — 문서에는 문자열로 남긴다(모르는 값이 와도 깨지지 않게) */
  confidence?: string;
  /** RevisionKind */
  revision?: string;
};

/** 요약 계산에 필요한 문항 값 — ReportProblem 이 그대로 만족한다 */
export type KoreanSummaryInput = {
  label: string;
  verdict: 'correct' | 'wrong' | 'unknown';
  activeMs: number;
  spanMs: number;
  attempts: number;
  revisits: number;
  korean?: ReportKorean | null;
};

export type KoreanReportSummary = {
  /** Depth(1~5) → 충족률 %. 판정된 문항이 없으면 null */
  depthRates: Record<number, number | null>;
  /** 영역 → 성취률 %. 그 영역 문항이 없으면 null */
  areaRates: Record<string, number | null>;
  /** 숨은 킬러 문항 라벨 — 맞혔는데 유난히 오래 멈칫한 문항 */
  killers: string[];
  /** 고쳐 쓴 방향별 문항 수 (RevisionKind → 개수) */
  revision: Record<string, number>;
  scatter: ScatterPoint[];
};

const DEPTHS: KoreanDepth[] = [1, 2, 3, 4, 5];

const REVISION_KINDS: RevisionKind[] = [
  'wrong_to_right',
  'right_to_wrong',
  'reworked',
  'none',
  'unknown',
];

export function toRevisionKind(v: unknown): RevisionKind {
  return typeof v === 'string' && (REVISION_KINDS as string[]).includes(v)
    ? (v as RevisionKind)
    : 'unknown';
}

/** 문항 하나의 성취률 — 5-Depth 가 있으면 그 득점률, 없으면 정오로 대신한다.
 *  객관식만 있는 시험지는 Depth 판정이 전부 '해당 없음' 이라 영역 막대가
 *  통째로 비어 버린다 — 그때는 맞았나/틀렸나가 그 영역의 성취다. */
function achievementOf(p: KoreanSummaryInput): number | null {
  const rate = p.korean?.depths?.length ? depthScoreRate(p.korean.depths) : null;
  if (rate != null) return rate;
  if (p.verdict === 'correct') return 100;
  if (p.verdict === 'wrong') return 0;
  return null;
}

function avg(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  return Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
}

/** 문서에 박을 국어 요약 — 리포트 생성 시점과 화면에서 같은 함수를 쓴다 */
export function buildKoreanSummary(
  problems: readonly KoreanSummaryInput[],
): KoreanReportSummary {
  const stats: KoreanProblemStat[] = problems.map((p) => ({
    label: p.label,
    correct: p.verdict === 'correct',
    activeMs: p.activeMs,
    spanMs: p.spanMs,
    attempts: p.attempts,
    revisits: p.revisits,
    revision: toRevisionKind(p.korean?.revision),
  }));

  const depthRates: Record<number, number | null> = {};
  for (const d of DEPTHS) {
    // '해당 없음' 은 분모에서 뺀다 — depthScoreRate 와 같은 규칙.
    const judged: KoreanDepthScore[] = [];
    for (const p of problems) {
      const hit = p.korean?.depths?.find((x) => x.depth === d);
      if (hit && hit.verdict !== 'na') judged.push(hit);
    }
    depthRates[d] = avg(
      judged.map((x) =>
        x.verdict === 'met' ? 100 : x.verdict === 'partial' ? 50 : 0,
      ),
    );
  }

  const areaRates: Record<string, number | null> = {};
  for (const area of KOREAN_AREAS) {
    const mine = problems.filter((p) => p.korean?.area === area);
    areaRates[area] = avg(
      mine.map(achievementOf).filter((v): v is number => v != null),
    );
  }

  return {
    depthRates,
    areaRates,
    killers: hiddenKillers(stats).map((s) => s.label),
    revision: revisionCounts(stats),
    scatter: buildScatter(stats),
  };
}
