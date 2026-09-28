/**
 * Renders a stroke group to an off-screen PNG suitable for vision-model
 * OCR. White background + black ink, with the bbox auto-fitted into a
 * fixed-size canvas so the OCR model gets a consistent input regardless
 * of how big the user wrote on paper.
 *
 * Output is the **bare base64 body** (no `data:` prefix) — `ocr-client`
 * adds the data-URL wrapper itself.
 */

import { normalizedPressure, type Stroke } from './stroke';
import { drawSmoothStroke } from './smooth-stroke';
import type { Bounds } from './stroke-groups';

/** Target canvas size on the long axis. 768px is plenty for short notes
 *  while staying within request-size budgets (~150–250 KB base64). */
const TARGET_LONG_EDGE_PX = 768;
/** Inner margin so glyphs never kiss the edge — vision models lose
 *  characters that touch the border. */
const MARGIN_PX = 32;
/** Min canvas size on the short axis. Single-line notes have a very
 *  tall aspect ratio when scaled to 768; clamp so width stays usable. */
const MIN_SHORT_EDGE_PX = 256;

/** Same range as the live canvas, scaled to the OCR canvas's px/ncode. */
const PEN_WIDTH_MIN_FACTOR = 1.2;
const PEN_WIDTH_MAX_FACTOR = 2.4;

export type RenderResult = {
  /** Bare base64 PNG body. */
  base64: string;
  width: number;
  height: number;
};

/**
 * Render `strokes` (constrained to `bbox`) onto a white off-screen
 * canvas and encode as PNG base64. Throws if the canvas API isn't
 * available (SSR/headless without canvas mocked).
 */
export async function renderStrokeGroupToPng(
  strokes: readonly Stroke[],
  bbox: Bounds,
): Promise<RenderResult> {
  const bw = Math.max(1e-3, bbox.maxX - bbox.minX);
  const bh = Math.max(1e-3, bbox.maxY - bbox.minY);

  // Fit the bbox's long axis to TARGET_LONG_EDGE_PX (minus margins),
  // preserving aspect. Clamp the short axis so the canvas isn't a
  // pencil-thin sliver for single-line notes.
  const innerLong = TARGET_LONG_EDGE_PX - MARGIN_PX * 2;
  const aspect = bw / bh;
  let canvasW: number;
  let canvasH: number;
  if (aspect >= 1) {
    canvasW = TARGET_LONG_EDGE_PX;
    canvasH = Math.max(MIN_SHORT_EDGE_PX, Math.round(innerLong / aspect) + MARGIN_PX * 2);
  } else {
    canvasH = TARGET_LONG_EDGE_PX;
    canvasW = Math.max(MIN_SHORT_EDGE_PX, Math.round(innerLong * aspect) + MARGIN_PX * 2);
  }

  const innerW = canvasW - MARGIN_PX * 2;
  const innerH = canvasH - MARGIN_PX * 2;
  const scale = Math.min(innerW / bw, innerH / bh);
  // Center the bbox within the inner area.
  const offsetX = MARGIN_PX + (innerW - bw * scale) / 2 - bbox.minX * scale;
  const offsetY = MARGIN_PX + (innerH - bh * scale) / 2 - bbox.minY * scale;

  const canvas = createCanvas(canvasW, canvasH);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('OCR render: 2D canvas context unavailable');
  }

  // White paper background — the prompt tells the model to expect this.
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvasW, canvasH);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0A0A0A';
  ctx.fillStyle = '#0A0A0A';

  for (const stroke of strokes) {
    drawStroke(ctx, stroke, scale, offsetX, offsetY);
  }

  const base64 = await canvasToPngBase64(canvas);
  return { base64, width: canvasW, height: canvasH };
}

type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function drawStroke(
  ctx: AnyCtx,
  stroke: Stroke,
  scale: number,
  offsetX: number,
  offsetY: number,
) {
  const dots = stroke.dots;
  if (dots.length === 0) return;

  // Visual thickness scales with the canvas's px/ncode density so notes
  // captured at any paper size end up with a comfortably readable line
  // weight on the OCR canvas.
  const widthScale = Math.max(0.5, scale / 6);

  if (dots.length === 1) {
    const d = dots[0];
    const r = Math.max(1.0, thickness(d, widthScale) / 2);
    ctx.beginPath();
    ctx.arc(d.x * scale + offsetX, d.y * scale + offsetY, r, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  // 꺾은선 방지 — 베지어 스무딩 (필압 굵기는 구간별 유지)
  drawSmoothStroke(
    ctx,
    dots.map((d) => ({ x: d.x * scale + offsetX, y: d.y * scale + offsetY })),
    (i) => Math.max(1.2, thickness(dots[i], widthScale)),
  );
}

function thickness(
  d: { pressure: number; maxPressure: number },
  widthScale: number,
): number {
  const p = normalizedPressure(d);
  return (PEN_WIDTH_MIN_FACTOR + p * (PEN_WIDTH_MAX_FACTOR - PEN_WIDTH_MIN_FACTOR)) * widthScale;
}

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

function createCanvas(w: number, h: number): AnyCanvas {
  // OffscreenCanvas keeps work off the DOM and avoids visual flicker
  // when we render at unusual sizes; fall back to HTMLCanvasElement in
  // browsers that lack it (older Safari).
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(w, h);
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

async function canvasToPngBase64(canvas: AnyCanvas): Promise<string> {
  if (canvas instanceof OffscreenCanvas) {
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return blobToBase64(blob);
  }
  // HTMLCanvasElement → toDataURL is synchronous and returns the data URL.
  // Strip the `data:image/png;base64,` prefix.
  const dataUrl = canvas.toDataURL('image/png');
  const idx = dataUrl.indexOf(',');
  return idx === -1 ? '' : dataUrl.slice(idx + 1);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('FileReader returned non-string'));
        return;
      }
      const idx = result.indexOf(',');
      resolve(idx === -1 ? '' : result.slice(idx + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}
