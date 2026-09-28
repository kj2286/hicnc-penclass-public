import type { Stroke } from './stroke';
import { strokeBounds } from './stroke';

export type PaperSize = {
  Xmin: number;
  Xmax: number;
  Ymin: number;
  Ymax: number;
};

export type Transform = {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
};

/**
 * Ncode ruler is 6.72 pt/nu (see image-loader's NCODE_TO_PT), so 1 ncode unit
 * spans 6.72 × 25.4 / 72 ≈ 2.371 mm of physical paper. Used to express pen
 * stroke thickness in real-world millimetres independent of paper size and
 * canvas dimensions.
 */
export const MM_PER_NU = (6.72 * 25.4) / 72;

/**
 * Pixel density of the canvas in CSS px per millimetre of paper, derived
 * from the paper bounds and current canvas dims. Uses the smaller of the
 * X/Y densities so that, on the (rare) aspect-mismatched layouts where
 * scaleX !== scaleY, stroke widths stay visually conservative rather than
 * appearing fatter on the squished axis.
 */
export function paperPixelsPerMm(
  paperSize: PaperSize,
  cssW: number,
  cssH: number,
): number {
  const t = computePaperTransform(paperSize, cssW, cssH);
  const density = Math.min(t.scaleX, t.scaleY) / MM_PER_NU;
  return Number.isFinite(density) && density > 0 ? density : 0;
}

/**
 * Paper-size mode: map ncode bounds directly to canvas CSS dims. Uses
 * independent scaleX/scaleY. The canvas (baseW × baseH) is itself derived
 * from the page image's pixel aspect, which equals the server paperSize
 * aspect by construction (both come from widthPx/heightPx), so the mapping
 * stays undistorted.
 *
 * Given a dot at (Xmin, Ymin) it lands at canvas (0, 0); (Xmax, Ymax) at
 * (cssW, cssH).
 */
export function computePaperTransform(
  paperSize: PaperSize,
  cssW: number,
  cssH: number,
): Transform {
  const paperW = Math.max(1e-6, paperSize.Xmax - paperSize.Xmin);
  const paperH = Math.max(1e-6, paperSize.Ymax - paperSize.Ymin);
  const scaleX = cssW / paperW;
  const scaleY = cssH / paperH;
  return {
    scaleX,
    scaleY,
    offsetX: -paperSize.Xmin * scaleX,
    offsetY: -paperSize.Ymin * scaleY,
  };
}

/**
 * Auto-fit mode: pad stroke bounds by `margin` on each side, fit inside the
 * canvas preserving aspect ratio, and center. Uniform scale (scaleX == scaleY).
 * Returns null for empty stroke input.
 */
export function computeAutoFitTransform(
  strokes: readonly Stroke[],
  cssW: number,
  cssH: number,
  margin: number = 0.15,
): Transform | null {
  const bounds = strokeBounds(strokes as Stroke[]);
  if (!bounds) return null;
  const rangeX = bounds.maxX - bounds.minX;
  const rangeY = bounds.maxY - bounds.minY;
  const paddedMinX = bounds.minX - rangeX * margin;
  const paddedMaxX = bounds.maxX + rangeX * margin;
  const paddedMinY = bounds.minY - rangeY * margin;
  const paddedMaxY = bounds.maxY + rangeY * margin;
  const contentW = paddedMaxX - paddedMinX;
  const contentH = paddedMaxY - paddedMinY;
  const scale = Math.min(cssW / contentW, cssH / contentH);
  return {
    scaleX: scale,
    scaleY: scale,
    offsetX: (cssW - contentW * scale) / 2 - paddedMinX * scale,
    offsetY: (cssH - contentH * scale) / 2 - paddedMinY * scale,
  };
}
