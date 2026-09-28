import type { PaperSize } from '@/pen/live/model/stroke-transform';

/**
 * Parse a paperSize override from the URL query string — a dev-time
 * calibration knob for aligning pen strokes with the PDF background when
 * the NoteServer doesn't carry `paperSize` in extraInfo.
 *
 * Format: `?paperSize=Xmin,Xmax,Ymin,Ymax` (ncode units, comma-separated)
 *   e.g., `?paperSize=3.5,85.7,3.5,118.4`
 *
 * Returns undefined when the param is missing or malformed.
 */
export function parsePaperSizeFromSearch(search: string): PaperSize | undefined {
  const raw = new URLSearchParams(search).get('paperSize');
  if (!raw) return undefined;
  const parts = raw.split(',').map((s) => Number(s.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return undefined;
  }
  const [Xmin, Xmax, Ymin, Ymax] = parts;
  if (Xmax - Xmin <= 0 || Ymax - Ymin <= 0) return undefined;
  return { Xmin, Xmax, Ymin, Ymax };
}

/**
 * Inspect a `window.__paperSize` override set ad-hoc from DevTools. Lets an
 * operator tweak values live without reloading the page (the consumer picks
 * up the latest value on each render / effect run).
 */
declare global {
  interface Window {
    __paperSize?: Partial<PaperSize>;
  }
}

/**
 * Resolve the paperSize used to map ncode coordinates onto the page image.
 *
 * Priority: explicit dev-calibration overrides first (URL `?paperSize=` then
 * `window.__paperSize`), otherwise the **server-derived per-page paperSize**
 * (computed from the page's `widthPx/heightPx/dpi`, i.e. the actual registered
 * paper). There is deliberately NO automatic A4 fallback: NGS now persists the
 * real paper size per page (BE.ngs PR #29 imprint args), so a hardcoded A4
 * basis would force the overlay off the true position for non-A4 papers. When
 * the server value is absent the caller renders stroke-only auto-fit instead.
 */
export function resolvePaperSize(args: {
  urlOverride?: PaperSize;
  windowOverride?: PaperSize;
  serverPaperSize?: PaperSize;
}): PaperSize | undefined {
  return args.urlOverride ?? args.windowOverride ?? args.serverPaperSize;
}

export function readWindowPaperSize(): PaperSize | undefined {
  if (typeof window === 'undefined') return undefined;
  const o = window.__paperSize;
  if (!o) return undefined;
  const { Xmin, Xmax, Ymin, Ymax } = o;
  if (
    typeof Xmin !== 'number' ||
    typeof Xmax !== 'number' ||
    typeof Ymin !== 'number' ||
    typeof Ymax !== 'number'
  ) {
    return undefined;
  }
  if (Xmax - Xmin <= 0 || Ymax - Ymin <= 0) return undefined;
  return { Xmin, Xmax, Ymin, Ymax };
}
