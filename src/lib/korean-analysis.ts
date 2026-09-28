/**
 * 국어 전용 분석 규격 — 5-Depth 성취 × 행동 심리(펜 궤적).
 *
 * 근거: 사용자가 준 국어 마스터 프롬프트(2026-09-05). 국어 시험지·학습지·테스트지는
 * 수학처럼 "계산이 맞았나" 로 볼 수 없다. 조건을 지켰는지, 핵심어를 넣었는지,
 * 규범에 맞는지, 지문과 논리가 맞는지, 어느 영역의 이해가 부족한지를 갈라서 본다.
 * 여기에 펜 궤적에서 읽은 **행동 심리**(멈칫·확신도·고쳐 쓴 방향)를 겹쳐야
 * "정답이지만 불안정한 정답" 같은 판단이 나온다.
 *
 * ⚠️ 원본 프롬프트는 필압(Pressure)으로 확신도를 보라고 하지만, **이 펜의 필압은
 * 0/1(종이에 닿았나)뿐이라 쓸 수 없다.** 그래서 확신도는 속도·멈칫·시도 횟수·
 * 고쳐 쓴 흔적으로 대신 산출한다. 화면·리포트도 그렇게 밝힌다.
 *
 * 이 파일은 순수 계산만 담는다(supabase·React 없음) — node 테스트가 그대로 부른다.
 */

// ---------- 5-Depth ----------

export const KOREAN_DEPTHS = [
  {
    depth: 1,
    key: 'form',
    name: '조건·형식',
    hint: '글자 수, 어미, 문장 형식 같은 기계적 조건을 지켰는가',
  },
  {
    depth: 2,
    key: 'keyword',
    name: '내용·핵심어',
    hint: '채점 기준의 핵심어를 답안에 담았는가',
  },
  {
    depth: 3,
    key: 'grammar',
    name: '문법·표현',
    hint: '맞춤법·띄어쓰기 등 국어 규범을 지켰는가',
  },
  {
    depth: 4,
    key: 'logic',
    name: '논리·이해',
    hint: '지문 내용과 논리적으로 맞는가',
  },
  {
    depth: 5,
    key: 'area',
    name: '영역 성취',
    hint: '화법·작문·문법·독서·문학 중 이 문항이 묻는 영역을 이해했는가',
  },
] as const;

export type KoreanDepth = 1 | 2 | 3 | 4 | 5;

/** 국어 출제 영역 (Depth 5) */
export const KOREAN_AREAS = ['화법', '작문', '문법', '독서', '문학'] as const;
export type KoreanArea = (typeof KOREAN_AREAS)[number];

export function isKoreanArea(v: unknown): v is KoreanArea {
  return typeof v === 'string' && (KOREAN_AREAS as readonly string[]).includes(v);
}

/** met=지킴 / partial=일부 / missed=놓침 / na=이 문항엔 해당 없음 */
export type DepthVerdict = 'met' | 'partial' | 'missed' | 'na';

export const DEPTH_VERDICT_LABEL: Record<DepthVerdict, string> = {
  met: '충족',
  partial: '부분',
  missed: '미충족',
  na: '해당 없음',
};

export type KoreanDepthScore = {
  depth: KoreanDepth;
  verdict: DepthVerdict;
  /** 왜 그렇게 봤는지 한 줄 — 답안의 어느 대목이 근거인지 */
  note: string;
};

export function depthName(depth: KoreanDepth): string {
  return KOREAN_DEPTHS.find((d) => d.depth === depth)?.name ?? `Depth ${depth}`;
}

/**
 * 5-Depth 득점률 — 충족 1점, 부분 0.5점, 해당 없음은 분모에서 뺀다.
 * 해당 없는 항목까지 분모에 넣으면 서술형이 없는 객관식 문항이 늘 낮게 나온다.
 */
export function depthScoreRate(scores: readonly KoreanDepthScore[]): number | null {
  const judged = scores.filter((s) => s.verdict !== 'na');
  if (judged.length === 0) return null;
  const got = judged.reduce(
    (sum, s) => sum + (s.verdict === 'met' ? 1 : s.verdict === 'partial' ? 0.5 : 0),
    0,
  );
  return Math.round((got / judged.length) * 100);
}

// ---------- 행동 심리 (Axis 2) ----------

export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'unknown';

export const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  high: '확신',
  medium: '보통',
  low: '불안정',
  unknown: '판단 보류',
};

/** 고쳐 쓴 방향 — 궤적 겹침·X표·다시 쓴 흔적에서 읽는다 */
export type RevisionKind =
  | 'wrong_to_right'
  | 'right_to_wrong'
  | 'reworked'
  | 'none'
  | 'unknown';

export const REVISION_LABEL: Record<RevisionKind, string> = {
  wrong_to_right: '오답 → 정답 선회',
  right_to_wrong: '정답 → 오답 수정',
  reworked: '고쳐 씀(결과 유지)',
  none: '수정 없음',
  unknown: '판단 보류',
};

export type KoreanBehavior = {
  confidence: ConfidenceLevel;
  /** 확신도 근거 — 필압이 아니라 속도·멈칫·시도로 판단한다 */
  confidenceNote: string;
  /** 인지 과부하가 관찰된 구간 서술 */
  overloadNote: string;
  revision: RevisionKind;
  revisionNote: string;
};

export type KoreanInsight = {
  /** Depth 5 — 이 문항의 출제 영역 */
  area: KoreanArea | null;
  depths: KoreanDepthScore[];
  behavior: KoreanBehavior;
  /** 풀이 습관·멘탈 교정 지침 한두 문장 */
  coaching: string;
};

/** 펜이 멈춰 있던 시간 — 첫 획~마지막 획 사이에서 실제 필기를 뺀 값 */
export function hesitationMs(t: { activeMs: number; spanMs: number }): number {
  return Math.max(0, Math.round(t.spanMs - t.activeMs));
}

/**
 * 심리적 불안정도 지수 0~100 (산점도 Z축).
 *
 * 필압을 못 쓰므로 **멈칫 비율 · 시도 횟수 · 재방문 · 고쳐 쓴 방향**을 섞는다.
 * 값이 크다고 오답이라는 뜻은 아니다 — "맞았지만 흔들렸다" 를 잡아내는 지표다.
 */
export function instabilityIndex(input: {
  activeMs: number;
  spanMs: number;
  attempts: number;
  revisits: number;
  revision?: RevisionKind;
}): number {
  const span = Math.max(1, input.spanMs);
  const idleRatio = Math.min(1, hesitationMs(input) / span); // 0~1
  const attempts = Math.min(1, Math.max(0, input.attempts - 1) / 4); // 1회=0, 5회+=1
  const revisits = Math.min(1, input.revisits / 3);
  const revision =
    input.revision === 'right_to_wrong'
      ? 1
      : input.revision === 'wrong_to_right' || input.revision === 'reworked'
        ? 0.5
        : 0;
  const raw = idleRatio * 0.4 + attempts * 0.25 + revisits * 0.2 + revision * 0.15;
  return Math.round(Math.min(1, raw) * 100);
}

// ---------- 문항별 행동 트렌드 (Output 2) ----------

export type KoreanProblemStat = {
  label: string;
  /** 정오 — 반 평균이 없으면 이 학생의 정오로 대신한다 */
  correct: boolean;
  activeMs: number;
  spanMs: number;
  attempts: number;
  revisits: number;
  revision?: RevisionKind;
  /** 반 평균 정답률(0~100). 없으면 null */
  classCorrectRate?: number | null;
};

/**
 * "숨은 킬러 문항" — **맞혔는데 유난히 오래 멈칫한** 문항.
 * 정답률만 보면 안 보이지만 실제로는 부담이 컸던 문항을 강단에서 짚으라는 요구다.
 * 기준: 정답 + 멈칫이 전체 중앙값의 1.8배 이상 + 최소 20초.
 */
export function hiddenKillers(
  stats: readonly KoreanProblemStat[],
  opts: { ratio?: number; minMs?: number } = {},
): KoreanProblemStat[] {
  const ratio = opts.ratio ?? 1.8;
  const minMs = opts.minMs ?? 20_000;
  if (stats.length === 0) return [];
  const all = stats.map(hesitationMs);
  // 🚨 중앙값을 **자기 자신을 뺀 나머지**로 잡는다. 문항이 몇 개 안 되면 킬러 후보가
  // 중앙값을 스스로 끌어올려 절대 안 걸린다(테스트로 재현: 4문항 중 2개가 길면 둘 다 탈락).
  return stats.filter((s, i) => {
    if (!s.correct) return false;
    const mine = hesitationMs(s);
    if (mine < minMs) return false;
    const others = all.filter((_, j) => j !== i).sort((a, b) => a - b);
    if (others.length === 0) return true;
    const median = others[Math.floor(others.length / 2)] || 0;
    return median === 0 || mine >= median * ratio;
  });
}

export type ScatterPoint = {
  label: string;
  /** X — 문항 정답률(%) */
  x: number;
  /** Y — 평균 멈칫 시간(초) */
  y: number;
  /** Z — 심리적 불안정도(0~100) */
  z: number;
};

/** 산점도 Raw Data (Output 3). 강사 리포트가 그대로 그리고, JSON 으로도 내보낸다. */
export function buildScatter(stats: readonly KoreanProblemStat[]): ScatterPoint[] {
  return stats.map((s) => ({
    label: s.label,
    x: s.classCorrectRate ?? (s.correct ? 100 : 0),
    y: Math.round(hesitationMs(s) / 100) / 10,
    z: instabilityIndex(s),
  }));
}

/** 고쳐 쓴 방향별 문항 수 — "다수가 어디서 흔들렸나" 를 한 줄로 */
export function revisionCounts(
  stats: readonly KoreanProblemStat[],
): Record<RevisionKind, number> {
  const out: Record<RevisionKind, number> = {
    wrong_to_right: 0,
    right_to_wrong: 0,
    reworked: 0,
    none: 0,
    unknown: 0,
  };
  for (const s of stats) out[s.revision ?? 'unknown'] += 1;
  return out;
}
