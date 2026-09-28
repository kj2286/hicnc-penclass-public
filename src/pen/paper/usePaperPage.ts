import { useEffect, useState } from 'react';
import {
  usePaperStore,
  paperKeyFor,
  type PaperMeta,
} from '@/store/paper.store';

/**
 * Background image rendered for the live paper canvas. The image source
 * is a server-rendered PNG signed URL from NGS, preloaded into an
 * `HTMLImageElement` so it can be drawn into a canvas without taint.
 */
export type RenderedPreview = {
  /** Drawable source for `ctx.drawImage`. */
  image: HTMLImageElement;
  /** Native pixel dimensions of the preview PNG. */
  width: number;
  /** Native pixel dimensions of the preview PNG. */
  height: number;
  /** ncode-coord paperSize derived from (widthPx, heightPx, dpi). */
  paperSize: { Xmin: 0; Xmax: number; Ymin: 0; Ymax: number };
};

export type PaperPageState =
  | { kind: 'idle' }
  | {
      kind: 'loading';
      paperKey: string;
      /** 이미지보다 먼저 도착한 페이지 기하 — 로딩 중 필기를 제자리에 그린다 */
      meta?: PaperMeta;
    }
  | { kind: 'unavailable'; paperKey: string; reason: string }
  | {
      kind: 'ready';
      paperKey: string;
      pageNumber: number;
      rendered: RenderedPreview;
      /** 원본 PDF(교재) 제목 — 어떤 파일에 쓰는지 표시용 */
      pdfTitle: string | null;
      /** PDF 내 실제 페이지 번호(1-based). 없으면 ncode 페이지 번호로 폴백. */
      pdfPageNumber: number | null;
    };

/**
 * Resolve a `(section, owner, book, page)` tuple to a preloaded preview
 * image via NGS. Re-runs whenever the tuple changes or `retryToken`
 * increments.
 *
 * Falls back to `unavailable` when:
 *  - NGS is disabled
 *  - The ncode index doesn't contain this tuple
 *  - The signed-URL fetch or image preload fails
 */
export function usePaperPage(
  section: number,
  owner: number,
  noteId: number,
  pageNumber: number | null,
  // The width/height args are kept for call-site compatibility — they no
  // longer feed pdf.js render scale (PNG is fixed-resolution), but we
  // still rerun the effect when the wrapper resizes from 0 → real, since
  // the consumer wants a "ready" state only once it has a layout.
  targetWidth: number,
  targetHeight: number = 0,
  retryToken: number = 0,
): PaperPageState {
  const ensurePaper = usePaperStore((s) => s.ensurePaper);
  const [state, setState] = useState<PaperPageState>({ kind: 'idle' });

  useEffect(() => {
    let cancelled = false;
    if (pageNumber == null || pageNumber <= 0 || targetWidth <= 0) {
      setState({ kind: 'idle' });
      return;
    }
    const paperKey = paperKeyFor(section, owner, noteId, pageNumber);
    setState({ kind: 'loading', paperKey });

    (async () => {
      const entry = await ensurePaper(section, owner, noteId, pageNumber);
      if (cancelled) return;
      if (entry.error) {
        setState({ kind: 'unavailable', paperKey, reason: entry.error });
        return;
      }
      if (!entry.image || !entry.paperSize || !entry.page) {
        setState({
          kind: 'unavailable',
          paperKey,
          reason: 'paper not registered with NGS',
        });
        return;
      }
      setState({
        kind: 'ready',
        paperKey,
        pageNumber,
        rendered: {
          image: entry.image,
          width: entry.page.widthPx,
          height: entry.page.heightPx,
          paperSize: entry.paperSize,
        },
        pdfTitle: entry.pdfTitle ?? null,
        pdfPageNumber: entry.pdfPageNumber ?? null,
      });
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, owner, noteId, pageNumber, targetWidth, targetHeight, retryToken]);

  // 로딩 중이면 선공개 기하(metaCache)를 합쳐 준다 — 배경 이미지를 기다리는
  // 동안에도 소비자가 필기를 최종 위치·배율로 그릴 수 있다.
  const meta = usePaperStore((s) =>
    state.kind === 'loading' ? s.metaCache[state.paperKey] : undefined,
  );
  if (state.kind === 'loading' && meta) {
    return { ...state, meta };
  }
  return state;
}
