import { formatDuration } from './duration';
/**
 * 문항별 필기 타임라인 — **순수 모델** (외부 의존 0, node 로 테스트 가능).
 *
 * 펜 데이터(스트로크 시각)만으로 문항별 행동을 요약한다:
 *  - 세그먼트: 8초 이상 손을 뗀 지점에서 나눈 연속 필기 구간 = "시도"
 *  - 재방문: 이 문항의 세그먼트 사이에 **다른 문항** 필기가 끼어 있으면
 *    "다른 문제를 풀다 돌아온" 것으로 본다
 *  - 활동 시간: 세그먼트 길이 합 (사이 공백 제외 = 실제 펜을 움직인 시간)
 *  - 체류 시간: 첫 획 ~ 마지막 획 (공백 포함)
 * 이 요약이 AI 분석의 근거(problemsContext)로 들어간다 — 시도 횟수·막힘·
 * 체감 난이도·시간 부족 판단은 전부 이 데이터를 기반으로 한다.
 */

export type TimelineStroke = {
  id: string;
  startedAt: number;
  endedAt: number | null;
};

export type TimelineProblem = {
  /** 클러스터 id */
  id: string;
  /** '5번' 또는 '영역 2' */
  label: string;
  strokeIds: readonly string[];
};

export type ProblemSegment = { fromMs: number; toMs: number; strokes: number };

export type ProblemTimeline = {
  id: string;
  label: string;
  strokeCount: number;
  /** 제출 t0 기준 상대(ms) */
  firstMs: number;
  lastMs: number;
  /** 세그먼트(시도) — SEGMENT_GAP_MS 이상 공백으로 분리 */
  segments: ProblemSegment[];
  /** 실제 필기 활동 시간 (세그먼트 합) */
  activeMs: number;
  /** 첫 획~마지막 획 (공백 포함 체류) */
  spanMs: number;
  /** 세그먼트 사이에 다른 문항 필기가 끼어 있던 횟수 */
  revisits: number;
};

/** "시도" 경계로 보는 공백 — 8초 이상 손을 떼면 별개 시도로 센다 */
export const SEGMENT_GAP_MS = 8_000;

function strokeEnd(s: TimelineStroke): number {
  return Math.max(s.endedAt ?? 0, s.startedAt);
}

/**
 * 문항별 타임라인 계산.
 * @param strokes  제출(또는 페이지) 전체 스트로크 — 재방문 판정에 필요
 * @param problems 문항 목록 (strokeIds 로 소속 판정)
 * @param t0       기준 시각 (제출 첫 획). 상대 ms 계산용.
 */
export function buildProblemTimelines(
  strokes: readonly TimelineStroke[],
  problems: readonly TimelineProblem[],
  t0: number,
): ProblemTimeline[] {
  const byId = new Map(strokes.map((s) => [s.id, s]));
  const owner = new Map<string, string>(); // strokeId -> problemId
  for (const p of problems) {
    for (const sid of p.strokeIds) owner.set(sid, p.id);
  }
  // 전체 타임라인 (재방문 판정용): 시간순 (strokeId, problemId|null)
  const ordered = [...strokes]
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((s) => ({ s, pid: owner.get(s.id) ?? null }));

  const out: ProblemTimeline[] = [];
  for (const p of problems) {
    const mine = p.strokeIds
      .map((sid) => byId.get(sid))
      .filter((s): s is TimelineStroke => !!s)
      .sort((a, b) => a.startedAt - b.startedAt);
    if (mine.length === 0) {
      out.push({
        id: p.id,
        label: p.label,
        strokeCount: 0,
        firstMs: 0,
        lastMs: 0,
        segments: [],
        activeMs: 0,
        spanMs: 0,
        revisits: 0,
      });
      continue;
    }
    // 세그먼트 분할
    const segments: ProblemSegment[] = [];
    let segFrom = mine[0].startedAt;
    let segTo = strokeEnd(mine[0]);
    let segStrokes = 1;
    for (let i = 1; i < mine.length; i++) {
      const s = mine[i];
      if (s.startedAt - segTo >= SEGMENT_GAP_MS) {
        segments.push({ fromMs: segFrom - t0, toMs: segTo - t0, strokes: segStrokes });
        segFrom = s.startedAt;
        segStrokes = 0;
      }
      segTo = Math.max(segTo, strokeEnd(s));
      segStrokes += 1;
    }
    segments.push({ fromMs: segFrom - t0, toMs: segTo - t0, strokes: segStrokes });

    // 재방문: 세그먼트 사이 공백에 다른 문항 필기가 있으면 +1
    let revisits = 0;
    for (let i = 1; i < segments.length; i++) {
      const gapFrom = segments[i - 1].toMs + t0;
      const gapTo = segments[i].fromMs + t0;
      const interleaved = ordered.some(
        ({ s, pid }) =>
          pid !== null &&
          pid !== p.id &&
          s.startedAt > gapFrom &&
          s.startedAt < gapTo,
      );
      if (interleaved) revisits += 1;
    }

    const activeMs = segments.reduce((a, g) => a + (g.toMs - g.fromMs), 0);
    out.push({
      id: p.id,
      label: p.label,
      strokeCount: mine.length,
      firstMs: mine[0].startedAt - t0,
      lastMs: strokeEnd(mine[mine.length - 1]) - t0,
      segments,
      activeMs,
      spanMs: strokeEnd(mine[mine.length - 1]) - mine[0].startedAt,
      revisits,
    });
  }
  // 처음 손댄 순서로 정렬
  out.sort((a, b) => a.firstMs - b.firstMs);
  return out;
}

const fmt = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * AI 분석 프롬프트에 넣는 문항별 타임라인 요약 텍스트.
 * 시도 횟수·재방문·활동/체류 시간이 그대로 드러나야 모델이
 * "막힘/시간 부족/포기/돌아와서 다시 풂"을 근거 있게 판단한다.
 */
export function formatProblemsContext(
  timelines: readonly ProblemTimeline[],
  currentProblemId?: string | null,
): string {
  if (timelines.length === 0) return '';
  const lines: string[] = [
    '## 문항별 필기 타임라인 (펜 데이터 실측 — 제출 시작 기준 상대 시각)',
    '세그먼트 = 8초 이상 손을 뗀 지점으로 나눈 연속 필기(=시도). 재방문 = 그 사이에 다른 문항을 풀다 돌아옴.',
  ];
  for (const t of timelines) {
    const mark = currentProblemId && t.id === currentProblemId ? ' ★현재 분석 대상' : '';
    if (t.strokeCount === 0) {
      lines.push(`- ${t.label}: 필기 없음 (손대지 않음)${mark}`);
      continue;
    }
    const segs = t.segments
      .map((g) => `${fmt(g.fromMs)}~${fmt(g.toMs)}(${g.strokes}획)`)
      .join(', ');
    lines.push(
      // ⏱️ **길이는 시·분·초로** — raw 초를 프롬프트에 넣으면 모델이 "180초" 로
      // 그대로 옮겨 적는다(사용자 지적 2026-08-27).
      `- ${t.label}: 체류 ${fmt(t.firstMs)}~${fmt(t.lastMs)} · 실제 필기 ${formatDuration(
        t.activeMs,
      )} · ${t.strokeCount}획 · 시도 ${t.segments.length}회` +
        (t.revisits > 0 ? ` · 다른 문제 풀다 복귀 ${t.revisits}회` : '') +
        ` · 세그먼트: ${segs}${mark}`,
    );
  }

  // 문항 이동 순서 — "7번 → 8번 → 다시 7번" 같은 왔다갔다를 그대로 보여준다.
  // 이 줄이 있어야 AI 가 "왜 돌아왔는지"를 서술할 수 있다 (사용자 요구 2026-08-13).
  const visits: Array<{ label: string; fromMs: number; toMs: number }> = [];
  for (const t of timelines) {
    for (const g of t.segments) {
      visits.push({ label: t.label, fromMs: g.fromMs, toMs: g.toMs });
    }
  }
  visits.sort((a, b) => a.fromMs - b.fromMs);
  // 연속된 같은 문항은 하나로 합친다
  const path: Array<{ label: string; fromMs: number; toMs: number }> = [];
  for (const v of visits) {
    const last = path[path.length - 1];
    if (last && last.label === v.label) last.toMs = v.toMs;
    else path.push({ ...v });
  }
  if (path.length > 1) {
    lines.push(
      '',
      '## 문항 이동 순서 (푼 차례 — 되돌아간 지점이 학습 신호다)',
      path
        .map(
          (p, i) =>
            `${i + 1}. ${p.label} ${fmt(p.fromMs)}~${fmt(p.toMs)}` +
            (i > 0
              ? ` (직전 ${path[i - 1].label} 에서 이동, 공백 ${formatDuration(
                  Math.max(0, p.fromMs - path[i - 1].toMs),
                )})`
              : ''),
        )
        .join('\n'),
    );
  }
  return lines.join('\n');
}
