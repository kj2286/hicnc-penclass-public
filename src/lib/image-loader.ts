/**
 * Tiny helper to preload an image URL into an HTMLImageElement that's
 * ready to be drawn into a canvas. The signed PNG previews returned by
 * NGS have CORS headers, so `crossOrigin = 'anonymous'` is safe and lets
 * us call `ctx.drawImage(img, …)` without tainting the canvas.
 */
export function preloadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // CDN serves images cookie-authenticated; `use-credentials` makes
    // the browser attach the Cloud-CDN-Cookie on cross-origin GETs.
    // Same-origin paths (e.g. through the Vite /cdn proxy) work either
    // way — `use-credentials` is the safe default.
    img.crossOrigin = 'use-credentials';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

/**
 * Translate a server-rendered preview's pixel dimensions + DPI into ncode
 * units, using the canonical 6.72 pt per ncode unit ratio (1 pt = 1/72 inch).
 *
 *   px -> in:  px / dpi
 *   in -> pt:  in * 72
 *   pt -> nu:  pt / 6.72
 */
export const NCODE_TO_PT = 6.72;

export function pxToNcodeUnits(px: number, dpi: number): number {
  if (dpi <= 0) return 0;
  return (px / dpi) * 72 / NCODE_TO_PT;
}

export type NcodePaperSize = {
  Xmin: 0;
  Xmax: number;
  Ymin: 0;
  Ymax: number;
};

export function paperSizeFromPreview(args: {
  widthPx: number;
  heightPx: number;
  dpi: number;
}): NcodePaperSize {
  return {
    Xmin: 0,
    Xmax: pxToNcodeUnits(args.widthPx, args.dpi),
    Ymin: 0,
    Ymax: pxToNcodeUnits(args.heightPx, args.dpi),
  };
}

/** Millimetres → ncode units (mm → inch → pt → nu). */
export function mmToNcodeUnits(mm: number): number {
  if (!(mm > 0)) return 0;
  return (mm / 25.4) * 72 / NCODE_TO_PT;
}

/**
 * ncode paperSize from the **authoritative imprint paper size** (mm) — the
 * paper the ncode was actually issued for (BE.ngs imprint args). This is the
 * true coordinate basis, unlike `paperSizeFromPreview` which *infers* it from
 * the preview raster's px/dpi and therefore breaks if the server ever renders
 * the preview at a size/dpi that doesn't match the paper.
 */
export function paperSizeFromImprint(args: {
  paperWidthMm: number;
  paperHeightMm: number;
}): NcodePaperSize {
  return {
    Xmin: 0,
    Xmax: mmToNcodeUnits(args.paperWidthMm),
    Ymin: 0,
    Ymax: mmToNcodeUnits(args.paperHeightMm),
  };
}

/**
 * Portrait A4 (210 × 297 mm) coordinate basis in ncode units — about
 * 88.6 × 125.3 nu. The basis for the missing-imprint fallback (see
 * `a4FallbackPaperSize` / `resolvePaperSizeBasis`): NGS's default imprint is
 * "A4 자동 맞춤" (BE.ngs `ncode_imprinter.go`), so a page that doesn't carry
 * `paperWidthMm` was almost certainly issued on A4 and its ncode space spans
 * A4 — NOT the preview raster's native size.
 */
export const A4_PAPER_SIZE: NcodePaperSize = paperSizeFromImprint({
  paperWidthMm: 210,
  paperHeightMm: 297,
});

/**
 * Orientation-matched A4 basis used when the server doesn't return the real
 * imprint paper size. NGS's default imprint fits each page into A4 with the
 * orientation chosen from the page's long axis (BE.ngs `detectOrientation` /
 * `a4Inches`), so we mirror that: landscape preview → 297×210, else 210×297.
 */
export function a4FallbackPaperSize(args: {
  widthPx: number;
  heightPx: number;
}): NcodePaperSize {
  if (args.widthPx > args.heightPx) {
    return paperSizeFromImprint({ paperWidthMm: 297, paperHeightMm: 210 });
  }
  return A4_PAPER_SIZE;
}

type Rect = { Xmin: number; Xmax: number; Ymin: number; Ymax: number };

/** Max relative difference between two paperSizes' extents (0 = identical). */
export function paperSizeRelDiff(a: Rect, b: Rect): number {
  const aw = a.Xmax - a.Xmin;
  const ah = a.Ymax - a.Ymin;
  const bw = b.Xmax - b.Xmin;
  const bh = b.Ymax - b.Ymin;
  if (aw <= 0 || ah <= 0 || bw <= 0 || bh <= 0) return Infinity;
  return Math.max(Math.abs(aw - bw) / bw, Math.abs(ah - bh) / bh);
}

/**
 * Choose the ncode coordinate basis the overlay maps strokes through.
 *
 * Prefers the authoritative imprint paper size (`paperWidthMm/paperHeightMm`)
 * when present; falls back to the preview-raster derivation for legacy / PoC
 * pages that carry no imprint args. `drift` is the relative gap between the two
 * when both exist — a non-trivial value means the server's preview render no
 * longer matches the imprint paper, which would otherwise *silently* misalign
 * strokes. Callers surface it as a dev warning instead of failing quietly.
 *
 * This is the root-cause guard for the "overlay forced to the wrong paper"
 * class of bug: the coordinate basis is the size the ncode was issued for, not
 * a hardcoded paper (the old A4 bug) nor an inference that can drift.
 *
 * Fallback when `paperWidthMm` is absent (legacy / un-migrated pages): use an
 * orientation-matched **A4** basis, NOT the preview raster's native size. NGS's
 * default imprint is "A4 자동 맞춤", so an un-migrated page's ncode space spans
 * A4 even when its source PDF wasn't A4. The preview-derived size is the *page*
 * size, which is only the ncode basis when it happens to equal the imprint
 * paper — using it as the basis is exactly what mis-positioned strokes on pages
 * registered before per-page `paperWidthMm` was persisted (BE.ngs PR #34).
 * `drift` reports how far that A4 assumption sits from the preview-derived size
 * so a genuinely non-A4 page missing its mm still surfaces a dev warning.
 */
export function resolvePaperSizeBasis(args: {
  widthPx: number;
  heightPx: number;
  dpi: number;
  paperWidthMm?: number | null;
  paperHeightMm?: number | null;
}): {
  paperSize: NcodePaperSize;
  source: 'imprint' | 'a4-fallback';
  drift: number | null;
} {
  const preview = paperSizeFromPreview(args);
  if (
    args.paperWidthMm != null &&
    args.paperHeightMm != null &&
    args.paperWidthMm > 0 &&
    args.paperHeightMm > 0
  ) {
    const imprint = paperSizeFromImprint({
      paperWidthMm: args.paperWidthMm,
      paperHeightMm: args.paperHeightMm,
    });
    return {
      paperSize: imprint,
      source: 'imprint',
      drift: paperSizeRelDiff(imprint, preview),
    };
  }
  const fallback = a4FallbackPaperSize(args);
  return {
    paperSize: fallback,
    source: 'a4-fallback',
    drift: paperSizeRelDiff(fallback, preview),
  };
}
