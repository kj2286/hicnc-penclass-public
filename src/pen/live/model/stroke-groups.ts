import type { Stroke } from './stroke';

export type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type StrokeGroup = {
  /** Stable id derived from the first stroke's id. */
  id: string;
  /** 1-based index in writing order. */
  index: number;
  /** Strokes in this group, in chronological order. */
  strokes: Stroke[];
  /** Tight axis-aligned bbox of all dots in the group (ncode units). */
  bbox: Bounds;
  /** Padded bbox used for highlighting on paper (a hair larger than `bbox`). */
  highlightBox: Bounds;
  /** Earliest startedAt across the group. */
  startedAt: number;
  /** Latest endedAt across the group (falls back to last startedAt). */
  endedAt: number;
  /** Total dot count across the group. */
  dotCount: number;
};

export type GroupingOptions = {
  /** Max ms allowed between current group's last activity and next stroke's start. */
  timeGapMs?: number;
  /** Max ncode-unit gap between current group bbox and next stroke bbox edges. */
  distanceNcode?: number;
  /** Padding (ncode units) added to the highlight box on every side. */
  highlightPadNcode?: number;
};

export const DEFAULT_TIME_GAP_MS = 2500;
export const DEFAULT_DISTANCE_NCODE = 6;
export const DEFAULT_HIGHLIGHT_PAD_NCODE = 1.0;

/**
 * Compute tight bounding box for a single stroke's dots.
 * Returns null when the stroke has no dots.
 */
export function strokeBbox(stroke: Stroke): Bounds | null {
  if (stroke.dots.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const d of stroke.dots) {
    if (d.x < minX) minX = d.x;
    if (d.y < minY) minY = d.y;
    if (d.x > maxX) maxX = d.x;
    if (d.y > maxY) maxY = d.y;
  }
  if (minX === maxX) {
    minX -= 0.25;
    maxX += 0.25;
  }
  if (minY === maxY) {
    minY -= 0.25;
    maxY += 0.25;
  }
  return { minX, minY, maxX, maxY };
}

function unionBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/**
 * Edge-to-edge gap between two axis-aligned bounding boxes.
 * Returns 0 when they overlap or touch.
 */
export function bboxGap(a: Bounds, b: Bounds): number {
  const dx = Math.max(0, Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX));
  const dy = Math.max(0, Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY));
  return Math.hypot(dx, dy);
}

function padBounds(b: Bounds, pad: number): Bounds {
  return {
    minX: b.minX - pad,
    minY: b.minY - pad,
    maxX: b.maxX + pad,
    maxY: b.maxY + pad,
  };
}

/**
 * Group strokes into bounding-boxed clusters by writing order, time proximity,
 * and spatial proximity. Two consecutive strokes belong to the same group when:
 *  1. The time gap (next.startedAt − current.endedAt) ≤ timeGapMs, AND
 *  2. The bbox-edge distance (current.bbox ↔ next.bbox) ≤ distanceNcode.
 * Otherwise the next stroke starts a new group.
 *
 * Strokes are pre-sorted by startedAt to honour writing order even if the
 * input array is unsorted (e.g., if mid-page edits arrive out of order).
 */
export function groupStrokes(
  strokes: readonly Stroke[],
  opts: GroupingOptions = {},
): StrokeGroup[] {
  const timeGapMs = opts.timeGapMs ?? DEFAULT_TIME_GAP_MS;
  const distanceNcode = opts.distanceNcode ?? DEFAULT_DISTANCE_NCODE;
  const highlightPad = opts.highlightPadNcode ?? DEFAULT_HIGHLIGHT_PAD_NCODE;

  const ordered = [...strokes]
    .filter((s) => s.dots.length > 0)
    .sort((a, b) => a.startedAt - b.startedAt);
  if (ordered.length === 0) return [];

  type Acc = {
    strokes: Stroke[];
    bbox: Bounds;
    startedAt: number;
    endedAt: number;
    dotCount: number;
  };

  const acc: Acc[] = [];
  let cur: Acc | null = null;

  for (const stroke of ordered) {
    const sb = strokeBbox(stroke);
    if (!sb) continue;
    const finishedAt = stroke.endedAt ?? stroke.startedAt;

    if (cur === null) {
      cur = {
        strokes: [stroke],
        bbox: sb,
        startedAt: stroke.startedAt,
        endedAt: finishedAt,
        dotCount: stroke.dots.length,
      };
      continue;
    }

    const timeGap = stroke.startedAt - cur.endedAt;
    const spaceGap = bboxGap(cur.bbox, sb);

    if (timeGap > timeGapMs || spaceGap > distanceNcode) {
      acc.push(cur);
      cur = {
        strokes: [stroke],
        bbox: sb,
        startedAt: stroke.startedAt,
        endedAt: finishedAt,
        dotCount: stroke.dots.length,
      };
    } else {
      cur.strokes.push(stroke);
      cur.bbox = unionBounds(cur.bbox, sb);
      cur.endedAt = Math.max(cur.endedAt, finishedAt);
      cur.dotCount += stroke.dots.length;
    }
  }
  if (cur) acc.push(cur);

  return acc.map((g, i): StrokeGroup => {
    const head = g.strokes[0];
    return {
      id: `grp_${head.id}`,
      index: i + 1,
      strokes: g.strokes,
      bbox: g.bbox,
      highlightBox: padBounds(g.bbox, highlightPad),
      startedAt: g.startedAt,
      endedAt: g.endedAt,
      dotCount: g.dotCount,
    };
  });
}

/** Width / height helpers for callers that don't want to do the math themselves. */
export function boundsWidth(b: Bounds): number {
  return Math.max(0, b.maxX - b.minX);
}

export function boundsHeight(b: Bounds): number {
  return Math.max(0, b.maxY - b.minY);
}
