/**
 * 중·고등 **내신 시험지** 분석 계산 — 수학 마스터 프롬프트(2026-09-05) 대응.
 *
 * 기존 리포트는 학원 테스트지(단계형)를 전제로 만들어졌다. 내신 시험지는 다르다:
 * 배점이 문항마다 다르고, 주관식·서술형 비중이 크며, 페이지를 넘길수록 체력이
 * 떨어진다. 그래서 **총점 대비 득점**, **페이지별 흐름**, **문항별 소요·멈칫·번복**
 * 을 축으로 다시 잡는다.
 *
 * ⚠️ 원본 프롬프트의 필압(Pressure)·호버링(Hovering)은 이 펜에서 그대로 못 얻는다.
 *  - 필압: 0/1(종이 접촉 여부)뿐이라 심리 지표로 쓸 수 없다 → 쓰지 않는다.
 *  - 호버링: 펜이 공중에 뜬 시간을 따로 기록하지 않는다 → **획 사이 공백**
 *    (체류 시간 − 실제 필기 시간)을 "인지적 멈칫" 으로 대신 쓴다. 화면에도 그렇게 적는다.
 * 이 대체는 숨기지 않고 리포트 각주로 밝힌다 — 없는 센서를 있는 척하면 코칭이 거짓이 된다.
 *
 * 순수 계산만 담는다(supabase·React 없음) — node 테스트가 그대로 부른다.
 */

export type ExamProblemInput = {
  /** 문항 번호 라벨 ("3번") */
  label: string;
  /** 배점 — 인식이 못 읽었으면 null */
  points: number | null;
  type: '객관식' | '주관식';
  /** 출제 단원 (없으면 빈 문자열) */
  unit?: string;
  verdict: 'correct' | 'wrong' | 'unknown';
  /** 부분 점수 (서술형) — 없으면 null */
  partialPoints?: number | null;
  /** 실제 필기 시간(ms) */
  activeMs: number;
  /** 첫 획~마지막 획(ms) */
  spanMs: number;
  /** 8초 이상 손을 뗀 경계로 나눈 시도 수 */
  attempts: number;
  /** 다른 문항을 풀다 돌아온 횟수 */
  revisits: number;
  /** 이 문항이 인쇄된 페이지 (1부터). 모르면 null */
  page?: number | null;
  /** 풀이를 지우거나 덧쓴 횟수 — AI 분석이 읽어낸 값. 못 읽었으면 null */
  overwrites?: number | null;
};

/** 인지적 멈칫 — 체류에서 실제 필기를 뺀 시간 */
export function hoveringMs(p: { activeMs: number; spanMs: number }): number {
  return Math.max(0, Math.round(p.spanMs - p.activeMs));
}

/** 멈칫 횟수 — 시도가 n 번이면 그 사이 공백이 n-1 번 */
export function hesitationCount(p: { attempts: number }): number {
  return Math.max(0, p.attempts - 1);
}

/**
 * 심리 불안정도 1~10 (원본 프롬프트의 anxiety_index).
 * 필압을 못 쓰므로 **멈칫 비율·시도·재방문·번복**으로 만든다. 1=안정, 10=매우 불안정.
 */
export function anxietyIndex(p: {
  activeMs: number;
  spanMs: number;
  attempts: number;
  revisits: number;
  overwrites?: number | null;
}): number {
  const span = Math.max(1, p.spanMs);
  const idle = Math.min(1, hoveringMs(p) / span);
  const attempts = Math.min(1, hesitationCount(p) / 4);
  const revisits = Math.min(1, p.revisits / 3);
  const over = Math.min(1, (p.overwrites ?? 0) / 3);
  const raw = idle * 0.4 + attempts * 0.25 + revisits * 0.2 + over * 0.15;
  return Math.max(1, Math.min(10, Math.round(raw * 9) + 1));
}

// ---------- 1. 종합 대시보드 ----------

export type ExamSummary = {
  /** 시험지 총 배점 — 배점을 하나도 못 읽었으면 null */
  totalPoints: number | null;
  /** 획득 점수 (부분 점수 반영). totalPoints 가 null 이면 null */
  earnedPoints: number | null;
  correct: number;
  wrong: number;
  /** 채점이 안 끝난 문항 */
  unknown: number;
  /** 체류 시간 합 */
  spanMs: number;
  /** 실제 필기 시간 합 */
  activeMs: number;
  /** 인지적 멈칫 합 */
  hoveringMs: number;
  /** 멈칫 비율 0~1 — 행동 기반 체감 난이도의 근거 */
  hoverRatio: number;
  /** 체감 난이도 등급 */
  felt: '쉬움' | '보통' | '어려움' | '매우 어려움';
  /** 문항별 불안정도 평균(1~10) */
  avgAnxiety: number;
};

export function summarizeExam(problems: readonly ExamProblemInput[]): ExamSummary {
  const spanMs = problems.reduce((s, p) => s + Math.max(0, p.spanMs), 0);
  const activeMs = problems.reduce((s, p) => s + Math.max(0, p.activeMs), 0);
  const hover = Math.max(0, spanMs - activeMs);
  const hoverRatio = spanMs > 0 ? hover / spanMs : 0;
  const scored = problems.filter((p) => p.points != null);
  const totalPoints = scored.length > 0 ? scored.reduce((s, p) => s + (p.points ?? 0), 0) : null;
  const earnedPoints =
    totalPoints == null
      ? null
      : scored.reduce((s, p) => {
          if (p.partialPoints != null) return s + p.partialPoints;
          return s + (p.verdict === 'correct' ? (p.points ?? 0) : 0);
        }, 0);
  const anx = problems.map((p) => anxietyIndex(p));
  return {
    totalPoints,
    earnedPoints,
    correct: problems.filter((p) => p.verdict === 'correct').length,
    wrong: problems.filter((p) => p.verdict === 'wrong').length,
    unknown: problems.filter((p) => p.verdict === 'unknown').length,
    spanMs,
    activeMs,
    hoveringMs: hover,
    hoverRatio,
    felt: feltDifficulty(hoverRatio),
    avgAnxiety:
      anx.length === 0 ? 1 : Math.round((anx.reduce((a, b) => a + b, 0) / anx.length) * 10) / 10,
  };
}

/**
 * 행동 기반 체감 난이도 — 푸는 시간 중 **멈춰 있던 비율**로 가른다.
 * 원본 프롬프트의 "풀이 시간 대비 공중 체류 비율" 을 우리가 가진 값으로 옮긴 것.
 */
export function feltDifficulty(hoverRatio: number): ExamSummary['felt'] {
  if (hoverRatio >= 0.7) return '매우 어려움';
  if (hoverRatio >= 0.5) return '어려움';
  if (hoverRatio >= 0.3) return '보통';
  return '쉬움';
}

// ---------- 2. 페이지별 흐름 ----------

export type PageFlow = {
  page: number;
  from: string;
  to: string;
  units: string[];
  problems: number;
  /** 문항당 평균 체류(ms) */
  avgSpanMs: number;
  hoveringMs: number;
  hesitations: number;
  overwrites: number | null;
  /** 이전 페이지 대비 문항당 평균 필기 시간 변화율 (첫 페이지는 null) */
  paceDelta: number | null;
  /** 체력·집중 판정 */
  trend: '유지' | '느려짐' | '빨라짐' | null;
};

/**
 * 페이지 단위 묶음 — 시간 배분과 집중도 변화를 본다.
 * 페이지를 모르는 문항(page=null)은 0페이지로 모으지 않고 **버린다** —
 * 섞으면 페이지 흐름이 통째로 거짓이 된다.
 */
export function pageFlows(problems: readonly ExamProblemInput[]): PageFlow[] {
  const byPage = new Map<number, ExamProblemInput[]>();
  for (const p of problems) {
    if (p.page == null) continue;
    const arr = byPage.get(p.page) ?? [];
    arr.push(p);
    byPage.set(p.page, arr);
  }
  const pages = [...byPage.keys()].sort((a, b) => a - b);
  let prevPace: number | null = null;
  return pages.map((page) => {
    const list = byPage.get(page) ?? [];
    const span = list.reduce((s, p) => s + p.spanMs, 0);
    const active = list.reduce((s, p) => s + p.activeMs, 0);
    const overArr = list.map((p) => p.overwrites).filter((v): v is number => v != null);
    const pace = list.length > 0 ? active / list.length : 0;
    const delta = prevPace && prevPace > 0 ? (pace - prevPace) / prevPace : null;
    prevPace = pace;
    return {
      page,
      from: list[0]?.label ?? '',
      to: list[list.length - 1]?.label ?? '',
      units: [...new Set(list.map((p) => p.unit).filter((u): u is string => !!u))],
      problems: list.length,
      avgSpanMs: list.length > 0 ? Math.round(span / list.length) : 0,
      hoveringMs: Math.max(0, span - active),
      hesitations: list.reduce((s, p) => s + hesitationCount(p), 0),
      overwrites: overArr.length > 0 ? overArr.reduce((a, b) => a + b, 0) : null,
      paceDelta: delta,
      trend: delta == null ? null : delta > 0.25 ? '느려짐' : delta < -0.25 ? '빨라짐' : '유지',
    };
  });
}

// ---------- 4. 시각화용 JSON ----------

export type ExamChartRow = {
  id: string;
  isCorrect: boolean | 'partial';
  score: number | null;
  duration_sec: number;
  hovering_sec: number;
  overwrite_count: number | null;
  anxiety_index: number;
};

/** 프론트 차트·외부 분석용 Raw Data (원본 프롬프트 4번) */
export function buildExamChartRows(
  problems: readonly ExamProblemInput[],
): ExamChartRow[] {
  return problems.map((p) => ({
    id: p.label,
    isCorrect:
      p.partialPoints != null && p.points != null && p.partialPoints > 0 && p.partialPoints < p.points
        ? 'partial'
        : p.verdict === 'correct',
    score: p.points,
    duration_sec: Math.round(p.spanMs / 100) / 10,
    hovering_sec: Math.round(hoveringMs(p) / 100) / 10,
    overwrite_count: p.overwrites ?? null,
    anxiety_index: anxietyIndex(p),
  }));
}

/** 유형별 집계 — 내신은 주관식·서술형 비중이 성패를 가른다 */
export function byType(problems: readonly ExamProblemInput[]): Record<
  '객관식' | '주관식',
  { count: number; correct: number; points: number | null; earned: number | null }
> {
  const make = (t: '객관식' | '주관식') => {
    const list = problems.filter((p) => p.type === t);
    const scored = list.filter((p) => p.points != null);
    return {
      count: list.length,
      correct: list.filter((p) => p.verdict === 'correct').length,
      points: scored.length > 0 ? scored.reduce((s, p) => s + (p.points ?? 0), 0) : null,
      earned:
        scored.length > 0
          ? scored.reduce(
              (s, p) =>
                s + (p.partialPoints ?? (p.verdict === 'correct' ? (p.points ?? 0) : 0)),
              0,
            )
          : null,
    };
  };
  return { 객관식: make('객관식'), 주관식: make('주관식') };
}
