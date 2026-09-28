import type { Stroke, StrokeDot } from '@/pen/live/model/stroke';
import type { RawOfflineDot, RawOfflineStroke } from '@/lib/pen-event-bus';

let strokeCounter = 0;

function getDots(raw: RawOfflineStroke): RawOfflineDot[] {
  return (raw.Dots ?? raw.dots ?? []) as RawOfflineDot[];
}

function safeTs(d: RawOfflineDot | undefined): number {
  return typeof d?.timeStamp === 'number' ? d.timeStamp : 0;
}

function toStrokeDot(d: RawOfflineDot): StrokeDot {
  return {
    x: typeof d.x === 'number' ? d.x : 0,
    y: typeof d.y === 'number' ? d.y : 0,
    pressure: typeof d.f === 'number' ? d.f : 0,
    maxPressure: 852,
    timeStamp: typeof d.timeStamp === 'number' ? d.timeStamp : 0,
  };
}

/**
 * Convert a raw `{Dots: Dot[]}` stroke emitted by web_pen_sdk into our
 * normalized `Stroke` type used by StrokeCanvas/playback.
 *
 * Dots with `dotType === PEN_DOWN (0)` are the SDK's state-transition markers
 * with `x = -1, y = -1` — we drop them so the stroke contains only real coords,
 * mirroring the Flutter StrokeAssembler semantics.
 */
export function rawStrokeToStroke(raw: RawOfflineStroke): Stroke | null {
  const rawDots = getDots(raw);
  if (rawDots.length === 0) return null;

  const first = rawDots[0];
  const pi = first.pageInfo ?? {};
  const section = pi.section ?? 0;
  const owner = pi.owner ?? 0;
  const noteId = pi.book ?? pi.note ?? 0;
  const pageNumber = pi.page ?? 0;

  // Skip the marker pen-down dot (x=-1, y=-1) but keep move/up coords.
  const coordDots = rawDots
    .filter((d) => (d.dotType ?? d.DotType) !== 0)
    .map(toStrokeDot);

  // If every dot was a marker, nothing to render — bail out.
  if (coordDots.length === 0) return null;

  strokeCounter += 1;
  return {
    id: `offline_${Date.now()}_${strokeCounter}`,
    section,
    owner,
    noteId,
    pageNumber,
    dots: coordDots,
    startedAt: safeTs(rawDots[0]),
    endedAt: safeTs(rawDots[rawDots.length - 1]),
  };
}

/**
 * Group decoded strokes by page number. Returns a map keyed by pageNumber
 * (not by full pageKey — a single note download shares section/owner/noteId).
 */
export function groupStrokesByPage(
  raw: RawOfflineStroke[],
): { strokesByPage: Record<number, Stroke[]>; totalStrokes: number; totalDots: number } {
  const strokesByPage: Record<number, Stroke[]> = {};
  let totalStrokes = 0;
  let totalDots = 0;
  for (const r of raw) {
    const s = rawStrokeToStroke(r);
    if (!s) continue;
    const bucket = strokesByPage[s.pageNumber] ?? [];
    bucket.push(s);
    strokesByPage[s.pageNumber] = bucket;
    totalStrokes += 1;
    totalDots += s.dots.length;
  }
  return { strokesByPage, totalStrokes, totalDots };
}
