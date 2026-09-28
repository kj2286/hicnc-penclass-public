import type { Stroke } from '@/pen/live/model/stroke';

export type TimeRange = { min: number; max: number };

export function computeTimeRange(strokes: readonly Stroke[]): TimeRange {
  if (strokes.length === 0) return { min: 0, max: 0 };
  let min = Infinity;
  let max = -Infinity;
  for (const s of strokes) {
    if (s.startedAt != null && s.startedAt < min) min = s.startedAt;
    if (s.endedAt != null && s.endedAt > max) max = s.endedAt;
    for (const d of s.dots) {
      if (d.timeStamp != null) {
        if (d.timeStamp < min) min = d.timeStamp;
        if (d.timeStamp > max) max = d.timeStamp;
      }
    }
  }
  if (!isFinite(min)) min = 0;
  if (!isFinite(max) || max < min) max = min;
  return { min, max };
}

// ── 압축 타임라인 — 무필기 공백 제거 ────────────────────────────────────
//
// 펜이 켜진 채 오래 방치되면 실필기는 몇 분인데 재생 길이가 수백 분이 된다
// (실사고: 655획 문서가 600분으로 표시). 스트로크 사이 공백이 GAP_MAX 를
// 넘으면 그 구간을 타임라인에서 통째로 제거해, 재생·표시 시간이 "실제 쓴
// 시간"에 수렴하게 한다. GAP_MAX 이하의 짧은 멈춤(생각하는 시간)은 남긴다.

export const PLAYBACK_GAP_MAX_MS = 5_000;

export type PlaybackSegment = {
  /** 실제 시각(ms) 구간 */
  start: number;
  end: number;
  /** 압축(가상) 타임라인에서 이 구간이 시작하는 위치 */
  vStart: number;
};

export type PlaybackTimeline = {
  segments: PlaybackSegment[];
  /** 압축 타임라인 전체 길이(ms) = 실필기 시간 */
  totalV: number;
};

export function buildCompressedTimeline(
  strokes: readonly Stroke[],
  gapMaxMs: number = PLAYBACK_GAP_MAX_MS,
): PlaybackTimeline {
  const spans: Array<[number, number]> = [];
  for (const s of strokes) {
    if (s.dots.length === 0) continue;
    const a = s.dots[0].timeStamp;
    const b = s.dots[s.dots.length - 1].timeStamp;
    spans.push([a, Math.max(a, b)]);
  }
  spans.sort((x, y) => x[0] - y[0]);
  const segments: PlaybackSegment[] = [];
  for (const [a, b] of spans) {
    const last = segments[segments.length - 1];
    if (last && a - last.end <= gapMaxMs) {
      if (b > last.end) last.end = b;
    } else {
      segments.push({ start: a, end: b, vStart: 0 });
    }
  }
  let v = 0;
  for (const seg of segments) {
    seg.vStart = v;
    v += seg.end - seg.start;
  }
  return { segments, totalV: v };
}

/** 압축 시간 → 실제 시각. 구간 경계를 넘으면 공백을 건너뛴 실제 시각이 나온다. */
export function virtualToReal(tl: PlaybackTimeline, v: number): number {
  const segs = tl.segments;
  if (segs.length === 0) return 0;
  if (v <= 0) return segs[0].start;
  if (v >= tl.totalV) return segs[segs.length - 1].end;
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (segs[mid].vStart <= v) lo = mid;
    else hi = mid - 1;
  }
  const s = segs[lo];
  return Math.min(s.end, s.start + (v - s.vStart));
}

/** 실제 시각 → 압축 시간. 공백 안의 시각은 직전 구간의 끝으로 스냅된다. */
export function realToVirtual(tl: PlaybackTimeline, ts: number): number {
  const segs = tl.segments;
  if (segs.length === 0) return 0;
  if (ts <= segs[0].start) return 0;
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (segs[mid].start <= ts) lo = mid;
    else hi = mid - 1;
  }
  const s = segs[lo];
  return s.vStart + Math.min(Math.max(0, ts - s.start), s.end - s.start);
}

/**
 * Return strokes that contain only dots with timeStamp <= cutoff.
 * - Stroke entirely before cutoff → include as-is.
 * - Stroke entirely after cutoff → drop.
 * - Stroke straddling cutoff → partial copy of its dots via binary search.
 *
 * Complexity O(N log M) where N = strokes, M = max dots per stroke.
 * Ported from Flutter `stroke_playback_filter.dart`.
 */
export function filterByCutoff(
  strokes: readonly Stroke[],
  cutoff: number,
): Stroke[] {
  const out: Stroke[] = [];
  for (const s of strokes) {
    if (s.dots.length === 0) continue;
    const firstTs = s.dots[0].timeStamp;
    const lastTs = s.dots[s.dots.length - 1].timeStamp;

    if (firstTs > cutoff) {
      // Entire stroke starts after cutoff — skip
      continue;
    }
    if (lastTs <= cutoff) {
      // Entire stroke completed before cutoff — include whole
      out.push(s);
      continue;
    }
    // Stroke straddles cutoff — binary search the last dot <= cutoff
    let lo = 0;
    let hi = s.dots.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (s.dots[mid].timeStamp <= cutoff) lo = mid;
      else hi = mid - 1;
    }
    const partial = s.dots.slice(0, lo + 1);
    if (partial.length > 0) {
      out.push({ ...s, dots: partial, endedAt: partial[partial.length - 1].timeStamp });
    }
  }
  return out;
}
