import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StrokeCanvas, type PaperSize } from '@/pen/live/StrokeCanvas';
import { computeAutoFitTransform } from '@/pen/live/model/stroke-transform';
import type { Stroke } from '@/pen/live/model/stroke';
import { sanitizeStrokes } from '@/lib/stroke-sanitize';
import { usePaperStore } from '@/store/paper.store';
import { usePaperPage, type PaperPageState } from './usePaperPage';
import { PaperStatusBadge } from './PaperStatusBadge';
import { hasValidPageCoords } from './paper-page-coords';
import {
  parsePaperSizeFromSearch,
  readWindowPaperSize,
  resolvePaperSize,
} from './paper-size-override';

type Props = {
  section?: number | null;
  owner?: number | null;
  noteId?: number | null;
  pageNumber?: number | null;
  strokes: readonly Stroke[];
  className?: string;
  /**
   * Rendered absolutely inside the canvas wrapper, above the page but below
   * the zoom control. Caller is responsible for positioning (e.g. `top-2
   * right-2`). Used by LiveScreen/OfflinePlaybackScreen to float Undo/Clear
   * and page info over the canvas rather than stealing vertical space.
   */
  overlay?: ReactNode;
  /**
   * Translucent rectangle drawn on top of the strokes in ncode coordinates.
   * Used by the annotation rail to point at the area belonging to the
   * currently selected note card. `null` removes the highlight.
   */
  highlight?: HighlightRect | null;
  /**
   * Lower-priority hover preview of a highlight rectangle. Rendered with a
   * lighter style and only when `highlight` is null or a different group.
   */
  hoverHighlight?: HighlightRect | null;
  /**
   * 배경 이미지가 없을 때(미등록 연습장 노트 등) 백지 대신 줄노트 느낌의
   * 폴백 배경을 깐다. 라이브 화면에서 "빈 화면"으로 보이는 것을 방지.
   */
  ruledFallback?: boolean;
  /**
   * 문항 포커스 — 지정 영역(ncode 좌표)이 화면에 꽉 차도록 줌·팬한다.
   * null 이면 기본 배율로 복귀, undefined 면 이 기능 미사용(수동 줌 유지).
   */
  focusRect?: HighlightRect | null;
  /** 이 id 의 스트로크를 빨간색으로 그린다 (AI 분석 문제점 구간) */
  highlightStrokeIds?: ReadonlySet<string>;
  /** 문항 영역 오버레이 (편집 모드) — 클릭 시 onRegionClick */
  regions?: Array<HighlightRect & { label?: string; active?: boolean }>;
  onRegionClick?: (id: string) => void;
  /** 문항 정오 마크 — 선생님 손그림 스타일 (맞음 ◯ / 틀림 빗금), 번호 위치에 표시 */
  marks?: Array<HighlightRect & { verdict: 'correct' | 'wrong' }>;
  /** 드래그로 새 영역 그리기 — onDrawRect 로 ncode 사각형 전달 */
  drawMode?: boolean;
  onDrawRect?: (rect: Omit<HighlightRect, 'id'>) => void;
};

export type HighlightRect = {
  /** Stable identifier (e.g. group id) used for animations. */
  id?: string;
  /** Min X in ncode units. */
  minX: number;
  /** Min Y in ncode units. */
  minY: number;
  /** Max X in ncode units. */
  maxX: number;
  /** Max Y in ncode units. */
  maxY: number;
};

const MIN_SCALE = 0.5;
const MAX_SCALE = 8;
const BUTTON_STEP = 1.25;

type ZoomState = {
  scale: number;
  /** Pan offset from the centered position, in wrapper pixels. */
  panX: number;
  panY: number;
};
const IDENTITY_ZOOM: ZoomState = { scale: 1, panX: 0, panY: 0 };

type ReadyPdf = Extract<PaperPageState, { kind: 'ready' }>;

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Composite background PDF + StrokeCanvas overlay with zoom-aware
 * rendering.
 *
 * Design (see the task description for background):
 *
 *   - `zoom.scale` is the visual target. Updates every wheel/click event.
 *     Only CSS transforms (translate, scale) depend on it — no layout
 *     reflow, no canvas resizing, no pdf.js work.
 *   - `renderScale` is the resolution that content is actually drawn at.
 *     Debounced from `zoom.scale`; only updates 180 ms after the user
 *     stops zooming. On update: StrokeCanvas' layer dims change → its
 *     ResizeObserver fires a *synchronous* redraw; pdf.js is asked for a
 *     higher-res bitmap.
 *   - PDF and stroke layers carry their own CSS-scale factor that bridges
 *     from their rendered resolution to the user's target zoom. Both
 *     layers occupy the same visual rectangle, so they align regardless
 *     of internal render resolution.
 *
 * Falls back to stroke-only auto-fit rendering when the paper is
 * unavailable (404 / disabled / no page info).
 */
export function PaperCanvas({
  section,
  owner,
  noteId,
  pageNumber,
  strokes,
  className,
  overlay,
  highlight,
  hoverHighlight,
  ruledFallback = false,
  focusRect,
  highlightStrokeIds,
  regions,
  onRegionClick,
  marks,
  drawMode = false,
  onDrawRect,
}: Props) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [wrapperW, setWrapperW] = useState<number>(0);
  const [wrapperH, setWrapperH] = useState<number>(0);

  useLayoutEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const sync = () => {
      const rect = el.getBoundingClientRect();
      setWrapperW(rect.width);
      setWrapperH(rect.height);
    };
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    sync();
    return () => ro.disconnect();
  }, []);

  const hasPageCoords = hasValidPageCoords({ section, owner, noteId, pageNumber });

  const [retryToken, setRetryToken] = useState(0);

  // ---- Zoom state --------------------------------------------------------
  // PNG previews are fixed-resolution, so we no longer re-rasterise on
  // zoom-in (unlike the old pdf.js path). `renderScale` stays at 1; we
  // keep it as a named constant because the stroke layer's CSS scale and
  // size formulas below derive from it, and surfacing the 1 inline would
  // hide that relationship.
  const [zoom, setZoom] = useState<ZoomState>(IDENTITY_ZOOM);
  // 줌 확대 시 스트로크가 CSS 업스케일로 뿌옇게 보이지 않도록, 줌이 멈추고
  // 180ms 뒤 스트로크 레이어를 목표 배율로 재래스터한다 (잉크처럼 선명하게).
  // 상한 4×: 그 이상은 캔버스 메모리 대비 체감 이득이 없다.
  const [renderScale, setRenderScale] = useState(1);
  useEffect(() => {
    const target = Math.min(4, Math.max(1, zoom.scale));
    if (target === renderScale) return;
    const t = window.setTimeout(() => setRenderScale(target), 180);
    return () => window.clearTimeout(t);
  }, [zoom.scale, renderScale]);

  // Reset zoom on page change.
  useEffect(() => {
    setZoom(IDENTITY_ZOOM);
    setRenderScale(1);
  }, [section, owner, noteId, pageNumber]);

  const paperPage = usePaperPage(
    hasPageCoords ? section! : 0,
    hasPageCoords ? owner! : 0,
    hasPageCoords ? noteId! : 0,
    hasPageCoords ? pageNumber! : null,
    Math.max(0, Math.floor(wrapperW)),
    Math.max(0, Math.floor(wrapperH)),
    retryToken,
  );

  const handleRetry = useCallback(() => {
    if (!hasPageCoords) return;
    usePaperStore
      .getState()
      .invalidatePaper(section!, owner!, noteId!, pageNumber!);
    setRetryToken((t) => t + 1);
  }, [hasPageCoords, section, owner, noteId, pageNumber]);

  // Hold the last "ready" preview snapshot. Keeps the bg painted across
  // brief loading transitions (e.g., user flips back to a page we just
  // had).
  const [pdfSnapshot, setPdfSnapshot] = useState<ReadyPdf | null>(null);

  useEffect(() => {
    if (paperPage.kind === 'ready') {
      setPdfSnapshot(paperPage);
    }
  }, [paperPage]);

  // Drop the snapshot when switching pages so the previous page's bitmap
  // doesn't flash before the new one loads.
  useEffect(() => {
    setPdfSnapshot(null);
  }, [section, owner, noteId, pageNumber]);

  // Paint the preview into the bg canvas whenever the snapshot updates.
  // Must be a *layout* effect so the new bitmap is in place before the
  // browser paints the layer's new dims — otherwise the user sees one
  // frame of mismatched (old bitmap, new layer size) content.
  useLayoutEffect(() => {
    const bg = bgCanvasRef.current;
    if (!bg || !pdfSnapshot) return;
    const ctx = bg.getContext('2d');
    if (!ctx) return;
    const { image, width, height } = pdfSnapshot.rendered;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    bg.width = width * dpr;
    bg.height = height * dpr;
    bg.style.width = `${width}px`;
    bg.style.height = `${height}px`;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, bg.width, bg.height);
    ctx.drawImage(image, 0, 0, bg.width, bg.height);
  }, [pdfSnapshot]);

  // URL ?paperSize=X1,X2,Y1,Y2 — dev-time calibration (unchanged).
  const urlOverride = useMemo(
    () =>
      typeof window !== 'undefined'
        ? parsePaperSizeFromSearch(window.location.search)
        : undefined,
    [],
  );

  const ready = pdfSnapshot != null;
  // 배경 이미지는 아직인데 페이지 기하는 아는 상태 — 필기를 최종 위치에
  // 먼저 그린다(이미지 도착 시 지오메트리 점프 없음 = "에러처럼 보임" 방지).
  const loadingMeta =
    !ready && paperPage.kind === 'loading' ? (paperPage.meta ?? null) : null;
  const metaMode = loadingMeta != null;
  const renderedW = ready
    ? pdfSnapshot!.rendered.width
    : metaMode
      ? loadingMeta.widthPx
      : 0;
  const renderedH = ready
    ? pdfSnapshot!.rendered.height
    : metaMode
      ? loadingMeta.heightPx
      : 0;

  // Fit the preview into the wrapper while preserving aspect ratio. The
  // PNG is fixed-resolution; the visible size is wrapper-bound. We pick
  // the larger of width-fit / height-fit and let CSS handle the rest.
  const fitScale = (() => {
    if ((!ready && !metaMode) || renderedW <= 0 || renderedH <= 0) return 1;
    if (wrapperW <= 0 || wrapperH <= 0) return 1;
    return Math.min(wrapperW / renderedW, wrapperH / renderedH);
  })();

  const baseW = ready || metaMode ? renderedW * fitScale : wrapperW;
  const baseH = ready || metaMode ? renderedH * fitScale : wrapperH;

  // Map ncode coords onto the page image using the actual per-page paperSize
  // the NGS server derives from (widthPx, heightPx, dpi) — the real registered
  // paper (BE.ngs PR #29 imprint args). Explicit dev-calibration overrides
  // (URL / window) still win for manual alignment. No automatic A4 basis: that
  // previously forced the overlay off-position for any non-A4 paper.
  const paperSize: PaperSize | undefined = ready
    ? resolvePaperSize({
        urlOverride,
        windowOverride: readWindowPaperSize(),
        serverPaperSize: pdfSnapshot!.rendered.paperSize,
      })
    : metaMode
      ? resolvePaperSize({
          urlOverride,
          windowOverride: readWindowPaperSize(),
          serverPaperSize: loadingMeta.paperSize,
        })
      : undefined;

  // 렌더용 정제 사본 — 용지 밖 노이즈 dot 이 화면에 긴 선을 긋는 것을 막는다
  // (2026-08-13 실사고: dot 4개가 문항 영역까지 페이지 밖으로 늘림)
  const drawStrokes = useMemo(
    () => sanitizeStrokes(strokes, paperSize ?? null),
    [strokes, paperSize],
  );

  // ---- Positioning math --------------------------------------------------
  //
  // A = effective viewport top-left of the content, in wrapper pixels.
  //     A = (wrapperW - baseW * scale) / 2     — centered at scale
  //         + panX                             — user pan offset from centered
  //
  // Visual(bx) = bx * zoom.scale + A       (bx = 0..baseW in base space)
  //
  // That formula is invariant over renderScale: whether strokes are rendered
  // at 1×, 2×, or 3× their base, the viewport mapping is the same.
  const A_x = (wrapperW - baseW * zoom.scale) / 2 + zoom.panX;
  const A_y = (wrapperH - baseH * zoom.scale) / 2 + zoom.panY;

  // The bg layer is the preview PNG at native pixel size (renderedW ×
  // renderedH); CSS-scaled to (baseW × zoom.scale) where baseW = renderedW
  // × fitScale. Combined factor = fitScale × zoom.scale.
  const pdfVisualScale = ready || metaMode ? fitScale * zoom.scale : zoom.scale;
  const strokeVisualScale = renderScale > 0 ? zoom.scale / renderScale : 1;

  // Stroke layer dims. These only change when `renderScale` changes — i.e.
  // on settle, NOT on every zoom event. During a gesture the stroke layer
  // stays the same size and only its transform shifts, which the browser
  // GPU-composites without layout reflow or canvas rewriting.
  const strokeW = Math.max(1, baseW * renderScale);
  const strokeH = Math.max(1, baseH * renderScale);

  // ---- Zoom handlers -----------------------------------------------------
  //
  // Reads of sizing state inside the setZoom updater would close over render-
  // time values; route through a ref so fast wheel events always see the
  // latest sizes.
  const depsRef = useRef({ wrapperW, wrapperH, baseW, baseH });
  useEffect(() => {
    depsRef.current = { wrapperW, wrapperH, baseW, baseH };
  });

  const zoomByFactor = useCallback(
    (factor: number, anchorX: number, anchorY: number) => {
      setZoom((prev) => {
        const nextScale = clamp(prev.scale * factor, MIN_SCALE, MAX_SCALE);
        if (nextScale === prev.scale) return prev;
        const {
          wrapperW: wW,
          wrapperH: wH,
          baseW: bW,
          baseH: bH,
        } = depsRef.current;
        if (bW <= 0 || bH <= 0) return prev;
        const prevA_x = (wW - bW * prev.scale) / 2 + prev.panX;
        const prevA_y = (wH - bH * prev.scale) / 2 + prev.panY;
        const ratio = nextScale / prev.scale;
        // Zoom-around-anchor: solve for newA such that the world-space coord
        // at the anchor stays pinned in viewport.
        const newA_x = anchorX - (anchorX - prevA_x) * ratio;
        const newA_y = anchorY - (anchorY - prevA_y) * ratio;
        const newPanX = newA_x - (wW - bW * nextScale) / 2;
        const newPanY = newA_y - (wH - bH * nextScale) / 2;
        return { scale: nextScale, panX: newPanX, panY: newPanY };
      });
    },
    [],
  );

  const zoomByStep = useCallback(
    (factor: number) => {
      const el = wrapperRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      zoomByFactor(factor, rect.width / 2, rect.height / 2);
    },
    [zoomByFactor],
  );

  const resetZoom = useCallback(() => setZoom(IDENTITY_ZOOM), []);

  // ---- 문항 포커스 — focusRect(ncode)가 화면에 꽉 차게 줌·팬 ----
  useEffect(() => {
    if (focusRect === undefined) return; // 기능 미사용
    if (focusRect === null) {
      setZoom(IDENTITY_ZOOM);
      return;
    }
    if (!ready || !paperSize || wrapperW <= 0 || wrapperH <= 0 || baseW <= 0) {
      return;
    }
    const pw = Math.max(1e-6, paperSize.Xmax - paperSize.Xmin);
    const phh = Math.max(1e-6, paperSize.Ymax - paperSize.Ymin);
    const rx = ((focusRect.minX - paperSize.Xmin) / pw) * baseW;
    const ry = ((focusRect.minY - paperSize.Ymin) / phh) * baseH;
    const rw = Math.max(1, ((focusRect.maxX - focusRect.minX) / pw) * baseW);
    const rh = Math.max(1, ((focusRect.maxY - focusRect.minY) / phh) * baseH);
    const margin = 1.3; // 문제 주변 여백
    const scale = clamp(
      Math.min(wrapperW / (rw * margin), wrapperH / (rh * margin)),
      MIN_SCALE,
      MAX_SCALE,
    );
    const cx = rx + rw / 2;
    const cy = ry + rh / 2;
    setZoom({
      scale,
      panX: wrapperW / 2 - cx * scale - (wrapperW - baseW * scale) / 2,
      panY: wrapperH / 2 - cy * scale - (wrapperH - baseH * scale) / 2,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    focusRect?.minX,
    focusRect?.minY,
    focusRect?.maxX,
    focusRect?.maxY,
    focusRect === null,
    ready,
    wrapperW,
    wrapperH,
    baseW,
    baseH,
  ]);

  // ---- 드래그 팬 — 확대 상태에서 마우스로 끌어 가려진 위아래·좌우를 본다 ----
  const panDragRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const onPanPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      // 줌 컨트롤·재시도 등 버튼 위에서는 팬 시작하지 않는다
      if ((e.target as HTMLElement).closest('button')) return;
      if (zoom.scale <= 1.001) return;
      panDragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      e.currentTarget.setPointerCapture(e.pointerId);
      setPanning(true);
    },
    [zoom.scale],
  );
  const onPanPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const st = panDragRef.current;
      if (!st || st.id !== e.pointerId) return;
      const dx = e.clientX - st.x;
      const dy = e.clientY - st.y;
      st.x = e.clientX;
      st.y = e.clientY;
      setZoom((prev) => ({ ...prev, panX: prev.panX + dx, panY: prev.panY + dy }));
    },
    [],
  );
  const onPanPointerEnd = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (panDragRef.current?.id === e.pointerId) {
        panDragRef.current = null;
        setPanning(false);
      }
    },
    [],
  );

  // Wheel / trackpad-pinch. Chromium dispatches pinch as wheel+ctrlKey, so
  // one path covers both. Non-passive to preventDefault on the page.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      // 일반 휠 스크롤도 줌인아웃 (핀치는 ctrl/meta+wheel 로 동일 경로).
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const anchorX = e.clientX - rect.left;
      const anchorY = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * (e.ctrlKey || e.metaKey ? 0.01 : 0.002));
      zoomByFactor(factor, anchorX, anchorY);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [zoomByFactor]);

  const isZoomed =
    Math.abs(zoom.scale - 1) > 0.001 || zoom.panX !== 0 || zoom.panY !== 0;

  // ncode ↔ 화면 매핑 기준 좌표계 — 오버레이(하이라이트·문항 영역)와
  // 드래그 영역 그리기가 공유한다. PDF 미준비 시 auto-fit 을 역산해 합성.
  const effPaper: PaperSize | undefined = (() => {
    if (paperSize) return paperSize;
    if (strokes.length === 0) return undefined;
    const t = computeAutoFitTransform(strokes as Stroke[], strokeW, strokeH);
    if (!t) return undefined;
    return {
      Xmin: -t.offsetX / t.scaleX,
      Xmax: (strokeW - t.offsetX) / t.scaleX,
      Ymin: -t.offsetY / t.scaleY,
      Ymax: (strokeH - t.offsetY) / t.scaleY,
    };
  })();

  // ---- 드래그로 문항 영역 그리기 (편집 모드) ----
  const drawRef = useRef<{ id: number; x0: number; y0: number } | null>(null);
  const [drawPreview, setDrawPreview] = useState<{
    left: number; top: number; width: number; height: number;
  } | null>(null);
  /** wrapper px → ncode 좌표 */
  const toNcode = useCallback(
    (px: number, py: number): { x: number; y: number } | null => {
      if (!effPaper || baseW <= 0 || baseH <= 0) return null;
      const bx = (px - A_x) / zoom.scale;
      const by = (py - A_y) / zoom.scale;
      const pw = Math.max(1e-6, effPaper.Xmax - effPaper.Xmin);
      const phh = Math.max(1e-6, effPaper.Ymax - effPaper.Ymin);
      return {
        x: effPaper.Xmin + (bx / baseW) * pw,
        y: effPaper.Ymin + (by / baseH) * phh,
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [A_x, A_y, zoom.scale, baseW, baseH, effPaper?.Xmin, effPaper?.Xmax, effPaper?.Ymin, effPaper?.Ymax],
  );
  const onDrawDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation(); // 팬 시작 방지
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    drawRef.current = { id: e.pointerId, x0: x, y0: y };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrawPreview({ left: x, top: y, width: 0, height: 0 });
  }, []);
  const onDrawMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const st = drawRef.current;
    if (!st || st.id !== e.pointerId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setDrawPreview({
      left: Math.min(st.x0, x),
      top: Math.min(st.y0, y),
      width: Math.abs(x - st.x0),
      height: Math.abs(y - st.y0),
    });
  }, []);
  const onDrawUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const st = drawRef.current;
      if (!st || st.id !== e.pointerId) return;
      drawRef.current = null;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setDrawPreview(null);
      // 6px 미만 드래그는 클릭으로 간주해 무시
      if (Math.abs(x - st.x0) < 6 || Math.abs(y - st.y0) < 6) return;
      const a = toNcode(Math.min(st.x0, x), Math.min(st.y0, y));
      const b = toNcode(Math.max(st.x0, x), Math.max(st.y0, y));
      if (!a || !b) return;
      onDrawRect?.({ minX: a.x, minY: a.y, maxX: b.x, maxY: b.y });
    },
    [onDrawRect, toNcode],
  );

  // Always promote the layers with willChange. The gesture can start on any
  // frame; toggling willChange on/off would itself thrash layers.
  const willChangeTransform = 'transform' as const;

  return (
    <div
      ref={wrapperRef}
      onPointerDown={onPanPointerDown}
      onPointerMove={onPanPointerMove}
      onPointerUp={onPanPointerEnd}
      onPointerCancel={onPanPointerEnd}
      className={cn(
        'relative h-full w-full select-none overflow-hidden rounded-lg border border-border bg-card',
        isZoomed && (panning ? 'cursor-grabbing' : 'cursor-grab'),
        className,
      )}
    >
      {!ready && ruledFallback && (
        // 미등록 노트 폴백 — 연습장 줄노트 배경 (가로줄 + 왼쪽 마진선)
        <div
          aria-hidden
          data-testid="ruled-fallback"
          className="absolute inset-0"
          style={{
            backgroundColor: '#fffdfa',
            backgroundImage:
              'linear-gradient(90deg, transparent 40px, rgba(240,110,80,0.28) 40px, rgba(240,110,80,0.28) 41px, transparent 41px), ' +
              'repeating-linear-gradient(180deg, transparent, transparent 30px, rgba(60,90,200,0.14) 30px, rgba(60,90,200,0.14) 31px)',
          }}
        />
      )}

      {metaMode && (
        // 배경 이미지 로딩 중 — 같은 기하의 흰 페이지를 먼저 깔아 필기가
        // 제자리에 보이게 한다 (이미지 도착 시 그 위에 그대로 그려진다).
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: renderedW,
            height: renderedH,
            transform: `translate(${A_x}px, ${A_y}px) scale(${pdfVisualScale})`,
            transformOrigin: '0 0',
          }}
          className="border border-line-weak bg-white"
        />
      )}

      {ready && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: renderedW,
            height: renderedH,
            transform: `translate(${A_x}px, ${A_y}px) scale(${pdfVisualScale})`,
            transformOrigin: '0 0',
            willChange: willChangeTransform,
          }}
        >
          <canvas ref={bgCanvasRef} className="block" />
        </div>
      )}

      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: strokeW,
          height: strokeH,
          transform: `translate(${A_x}px, ${A_y}px) scale(${strokeVisualScale})`,
          transformOrigin: '0 0',
          willChange: willChangeTransform,
        }}
      >
        <StrokeCanvas
          strokes={drawStrokes}
          paperSize={paperSize}
          transparent={ready || metaMode || ruledFallback}
          highlightStrokeIds={highlightStrokeIds}
        />

        {effPaper && (
          <>
            {hoverHighlight &&
              (!highlight || hoverHighlight.id !== highlight.id) && (
                <HighlightBox
                  kind="hover"
                  rect={hoverHighlight}
                  paperSize={effPaper}
                  cssW={strokeW}
                  cssH={strokeH}
                />
              )}
            {highlight && (
              <HighlightBox
                kind="active"
                rect={highlight}
                paperSize={effPaper}
                cssW={strokeW}
                cssH={strokeH}
              />
            )}
            {regions?.map((r) => (
              <RegionBox
                key={r.id ?? `${r.minX}-${r.minY}`}
                rect={r}
                paperSize={effPaper}
                cssW={strokeW}
                cssH={strokeH}
                onClick={onRegionClick}
              />
            ))}
            {marks?.map((mk, i) => (
              <VerdictMark
                key={mk.id ?? i}
                rect={mk}
                verdict={mk.verdict}
                paperSize={effPaper}
                cssW={strokeW}
                cssH={strokeH}
              />
            ))}
          </>
        )}
      </div>

      {drawMode && (
        <div
          data-testid="region-draw-layer"
          className="absolute inset-0 z-30 cursor-crosshair"
          onPointerDown={onDrawDown}
          onPointerMove={onDrawMove}
          onPointerUp={onDrawUp}
          onPointerCancel={() => {
            drawRef.current = null;
            setDrawPreview(null);
          }}
        >
          {drawPreview && (
            <div
              className="pointer-events-none absolute rounded-[3px] border-2 border-dashed border-[#dc2626] bg-[#dc2626]/10"
              style={drawPreview}
            />
          )}
        </div>
      )}

      <div className="pointer-events-none absolute right-2 top-2 z-10">
        <PaperStatusBadge state={paperPage} onRetry={handleRetry} />
      </div>

      {/* 어떤 PDF(교재)에 쓰고 있는지 — 페이지 번호만으로는 알기 어렵다 */}
      {paperPage.kind === 'ready' && paperPage.pdfTitle && (
        <div
          data-testid="paper-pdf-title"
          className="pointer-events-none absolute bottom-2 left-2 z-10 max-w-[70%] truncate rounded bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white"
        >
          {paperPage.pdfTitle} · p.{paperPage.pdfPageNumber ?? paperPage.pageNumber}
        </div>
      )}

      {overlay}

      <ZoomControls
        scale={zoom.scale}
        isZoomed={isZoomed}
        onZoomIn={() => zoomByStep(BUTTON_STEP)}
        onZoomOut={() => zoomByStep(1 / BUTTON_STEP)}
        onReset={resetZoom}
      />
    </div>
  );
}

/** 정오 채점 마크 — 선생님이 빨간펜으로 그린 것처럼. 맞음 = 동그라미,
 *  틀림 = ✗. **투명도 50%** 라 아래 필기·지문이 비쳐 보인다 (사용자 지정). */
function VerdictMark({
  rect,
  verdict,
  paperSize,
  cssW,
  cssH,
}: {
  rect: HighlightRect;
  verdict: 'correct' | 'wrong';
  paperSize: PaperSize;
  cssW: number;
  cssH: number;
}) {
  const paperW = Math.max(1e-6, paperSize.Xmax - paperSize.Xmin);
  const paperH = Math.max(1e-6, paperSize.Ymax - paperSize.Ymin);
  const left = ((rect.minX - paperSize.Xmin) / paperW) * cssW;
  const top = ((rect.minY - paperSize.Ymin) / paperH) * cssH;
  // 번호 글자 크기에 맞춘 마크 크기 — 페이지 높이의 ~3.5%
  const s = Math.max(16, cssH * 0.035);
  return (
    <svg
      aria-label={verdict === 'correct' ? '맞음' : '틀림'}
      viewBox="0 0 100 100"
      style={{
        position: 'absolute',
        left: left - s * 0.28,
        top: top - s * 0.3,
        width: s,
        height: s,
        pointerEvents: 'none',
      }}
    >
      {verdict === 'correct' ? (
        // 한 번에 돌린 듯 살짝 어긋난 동그라미
        <path
          d="M50 10 C 78 8, 94 28, 91 51 C 88 77, 66 93, 44 90 C 20 87, 7 66, 11 43 C 14 22, 32 10, 56 14"
          fill="none"
          stroke="#E0301E"
          strokeWidth={9}
          strokeLinecap="round"
          opacity={0.5}
          transform="rotate(-6 50 50)"
        />
      ) : (
        // 빨간펜 ✗ — 두 획이 살짝 어긋나게 교차
        <>
          <path
            d="M16 16 C 38 40, 60 62, 86 86"
            fill="none"
            stroke="#E0301E"
            strokeWidth={9}
            strokeLinecap="round"
            opacity={0.5}
          />
          <path
            d="M86 14 C 62 40, 40 62, 14 88"
            fill="none"
            stroke="#E0301E"
            strokeWidth={9}
            strokeLinecap="round"
            opacity={0.5}
          />
        </>
      )}
    </svg>
  );
}

/**
 * Translates an ncode-coordinate rectangle into the stroke layer's CSS box
 * (which itself is `paperSize` mapped to the stroke layer dims) and renders
 * a translucent highlighter swipe over the corresponding paper region.
 */
function HighlightBox({
  rect,
  paperSize,
  cssW,
  cssH,
  kind,
}: {
  rect: HighlightRect;
  paperSize: PaperSize;
  cssW: number;
  cssH: number;
  kind: 'hover' | 'active';
}) {
  const paperW = Math.max(1e-6, paperSize.Xmax - paperSize.Xmin);
  const paperH = Math.max(1e-6, paperSize.Ymax - paperSize.Ymin);
  const sx = cssW / paperW;
  const sy = cssH / paperH;
  const left = (rect.minX - paperSize.Xmin) * sx;
  const top = (rect.minY - paperSize.Ymin) * sy;
  const width = Math.max(2, (rect.maxX - rect.minX) * sx);
  const height = Math.max(2, (rect.maxY - rect.minY) * sy);

  const isActive = kind === 'active';
  return (
    <div
      data-testid={isActive ? 'paper-highlight-active' : 'paper-highlight-hover'}
      data-highlight-id={rect.id}
      className={
        isActive
          ? 'pointer-events-none absolute z-20 animate-highlight-pulse rounded-[3px] mix-blend-multiply'
          : 'pointer-events-none absolute z-20 rounded-[3px] mix-blend-multiply'
      }
      style={{
        left,
        top,
        width,
        height,
        background: isActive
          ? 'linear-gradient(135deg, rgba(92, 123, 255, 0.32), rgba(43, 79, 241, 0.22))'
          : 'rgba(92, 123, 255, 0.14)',
        outline: isActive
          ? '1.5px solid rgba(27, 54, 193, 0.65)'
          : '1px dashed rgba(27, 54, 193, 0.45)',
        outlineOffset: '-1px',
        transition: 'left 200ms ease, top 200ms ease, width 200ms ease, height 200ms ease',
      }}
    />
  );
}

/** 문항 영역 박스 — 편집 모드에서 라벨과 함께 표시, 클릭으로 선택 */
function RegionBox({
  rect,
  paperSize,
  cssW,
  cssH,
  onClick,
}: {
  rect: HighlightRect & { label?: string; active?: boolean };
  paperSize: PaperSize;
  cssW: number;
  cssH: number;
  onClick?: (id: string) => void;
}) {
  const paperW = Math.max(1e-6, paperSize.Xmax - paperSize.Xmin);
  const paperH = Math.max(1e-6, paperSize.Ymax - paperSize.Ymin);
  const left = ((rect.minX - paperSize.Xmin) / paperW) * cssW;
  const top = ((rect.minY - paperSize.Ymin) / paperH) * cssH;
  const width = Math.max(4, ((rect.maxX - rect.minX) / paperW) * cssW);
  const height = Math.max(4, ((rect.maxY - rect.minY) / paperH) * cssH);
  return (
    <button
      type="button"
      data-testid="problem-region"
      title={rect.label}
      onClick={() => rect.id && onClick?.(rect.id)}
      className="absolute z-20 rounded-[4px] text-left"
      style={{
        left,
        top,
        width,
        height,
        outline: rect.active
          ? '2px solid rgba(220,38,38,0.9)'
          : '1.5px dashed rgba(21,128,61,0.7)',
        outlineOffset: '-1px',
        background: rect.active ? 'rgba(220,38,38,0.08)' : 'rgba(21,128,61,0.05)',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      {rect.label && (
        <span
          className={
            'absolute -top-0.5 left-0 -translate-y-full rounded-t px-1.5 py-0.5 text-[10px] font-bold text-white ' +
            (rect.active ? 'bg-[#dc2626]' : 'bg-[#15803d]')
          }
        >
          {rect.label}
        </span>
      )}
    </button>
  );
}

function ZoomControls({
  scale,
  isZoomed,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  scale: number;
  isZoomed: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}) {
  const pct = Math.round(scale * 100);
  return (
    <div className="absolute bottom-3 right-3 z-20 flex items-center gap-1 rounded-full border border-border bg-background/95 p-1 shadow-sm backdrop-blur">
      <button
        type="button"
        onClick={onZoomOut}
        disabled={scale <= MIN_SCALE + 0.001}
        aria-label="Zoom out"
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Minus className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onReset}
        disabled={!isZoomed}
        aria-label={`Reset zoom (current ${pct}%)`}
        title={`${pct}% — 클릭하여 원래 크기로`}
        className="min-w-[3rem] rounded-full px-2 py-1 text-center text-xs font-medium tabular-nums text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pct}%
      </button>
      <button
        type="button"
        onClick={onZoomIn}
        disabled={scale >= MAX_SCALE - 0.001}
        aria-label="Zoom in"
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus className="h-4 w-4" />
      </button>
      {isZoomed && (
        <button
          type="button"
          onClick={onReset}
          aria-label="Reset zoom"
          className="ml-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
