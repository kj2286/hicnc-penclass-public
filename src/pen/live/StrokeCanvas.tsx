import { useEffect, useRef } from 'react';
import { normalizedPressure, type Stroke } from './model/stroke';
import { drawSmoothStroke } from './model/smooth-stroke';
import {
  computeAutoFitTransform,
  computePaperTransform,
  paperPixelsPerMm,
  type PaperSize,
} from './model/stroke-transform';

export type { PaperSize };

/** Real-world pen tip thickness range, in millimetres of paper.
 *  (사용자 피드백: 실제 잉크보다 두꺼워 보여 절반으로 조정) */
const PEN_WIDTH_MIN_MM = 0.15;
const PEN_WIDTH_MAX_MM = 0.4;

type Props = {
  /** Strokes to render. Caller owns selection/filtering. */
  strokes: readonly Stroke[];
  className?: string;
  /**
   * When provided, map ncode coordinates directly to this canvas via the
   * paper bounds (identical to `PenHelper.ncodeToScreen`). When omitted,
   * fall back to auto-fit based on stroke bounds (pre-M6 behavior).
   */
  paperSize?: PaperSize;
  /** Transparent background (used when a PDF layer renders underneath). */
  transparent?: boolean;
  /** 이 id 집합의 스트로크는 강조색으로 그린다 (AI 분석 문제점 구간 표시용) */
  highlightStrokeIds?: ReadonlySet<string>;
  /** 강조색 (기본: 빨강) */
  /** 형광펜 색 — **밝은 형광 노랑**(사용자 지정 2026-08-17). 이전 #ffd34d 는
   *  주황빛이 돌아 필기와 뒤섞여 보였다. 빨강은 채점 ○/✗ 전용이라 쓰지 않는다. */
  highlightColor?: string;
};

export function StrokeCanvas({
  strokes,
  className,
  paperSize,
  transparent,
  highlightStrokeIds,
  highlightColor = '#f2ff00',
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  // Refs so the ResizeObserver callback (set up once) always reads the latest
  // props when it triggers a redraw after layout changes.
  const strokesRef = useRef<readonly Stroke[]>(strokes);
  const paperSizeRef = useRef<PaperSize | undefined>(paperSize);
  const highlightRef = useRef<{ ids?: ReadonlySet<string>; color: string }>({
    ids: highlightStrokeIds,
    color: highlightColor,
  });

  // Track a hash of the stroke array to redraw whenever content changes,
  // even if the outer array reference is stable (e.g. filtered playback).
  const totalDots = strokes.reduce((acc, stroke) => acc + stroke.dots.length, 0);

  useEffect(() => {
    strokesRef.current = strokes;
    paperSizeRef.current = paperSize;
    highlightRef.current = { ids: highlightStrokeIds, color: highlightColor };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;

    const resize = () => {
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      // offsetWidth/Height report the untransformed layout box. Using
      // getBoundingClientRect would fold in any ancestor CSS transform
      // (e.g. PaperCanvas's zoom scale) and bake that scale permanently
      // into the canvas bitmap — a one-way trip since ResizeObserver
      // fires on layout changes, not transform changes.
      const w = Math.max(1, Math.floor(wrapper.offsetWidth));
      const h = Math.max(1, Math.floor(wrapper.offsetHeight));
      const resized =
        canvas.width !== w * dpr || canvas.height !== h * dpr;
      if (resized) {
        // Assigning canvas.width/height clears the bitmap. We must fill it
        // again before the browser paints, or the user sees one blank
        // frame per resize — visible as a flicker during zoom settle.
        // ResizeObserver callbacks fire post-layout, pre-paint, so a
        // synchronous draw here is painted atomically with the size change.
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      if (resized) {
        // Cancel any queued RAF draw so it doesn't stomp the sync draw.
        if (rafRef.current != null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        draw();
      } else {
        scheduleDraw();
      }
    };

    const ro = new ResizeObserver(resize);
    ro.observe(wrapper);
    resize();

    return () => {
      ro.disconnect();
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scheduleDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes, totalDots, paperSize?.Xmin, paperSize?.Xmax, paperSize?.Ymin, paperSize?.Ymax, highlightStrokeIds]);

  function scheduleDraw() {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      draw();
    });
  }

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const currentStrokes = strokesRef.current;
    const currentPaperSize = paperSizeRef.current;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cssW = canvas.width / dpr;
    const cssH = canvas.height / dpr;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);

    if (currentStrokes.length === 0) return;

    ctx.strokeStyle = '#111111';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Paper-size mode: map ncode coords directly to canvas via paperSize.
    // Stroke width is derived from the canvas's CSS-px-per-mm density so
    // visible thickness sits in the real-world 0.3–0.8 mm pen range,
    // independent of viewport size. The CSS transform on the surrounding
    // layer handles zoom — no extra compensation needed here.
    // 강조 표시는 **형광펜**이다 — 글씨 색은 건드리지 않는다.
    //
    // 예전에는 강조 대상 획을 빨갛게 칠했는데, 자동 채점의 빨간 ○/✗ 와 뜻이
    // 겹쳐 "학생이 빨간 펜으로 썼나?" 로 읽혔다(2026-08-16 사용자 지적).
    // 이제 원래 글씨(검정) 아래에 노란 형광펜을 그어 "여기 보라"만 표시한다.
    const hl = highlightRef.current;
    const marked = hl.ids;

    if (currentPaperSize) {
      const t = computePaperTransform(currentPaperSize, cssW, cssH);
      const pxPerMm = paperPixelsPerMm(currentPaperSize, cssW, cssH);
      if (marked?.size) {
        for (const stroke of currentStrokes) {
          if (!marked.has(stroke.id)) continue;
          drawHighlighter(ctx, stroke, hl.color, pxPerMm * 2.6, (d) => [
            d.x * t.scaleX + t.offsetX,
            d.y * t.scaleY + t.offsetY,
          ]);
        }
      }
      for (const stroke of currentStrokes) {
        ctx.strokeStyle = '#111111';
        drawStrokeMm(ctx, stroke, t.scaleX, t.scaleY, t.offsetX, t.offsetY, pxPerMm);
      }
      return;
    }

    // Auto-fit mode (no paper) — no physical scale reference, so use a
    // pressure-based heuristic that stays visibly thinner than M2.
    const t = computeAutoFitTransform(currentStrokes, cssW, cssH);
    if (!t) return;
    if (marked?.size) {
      for (const stroke of currentStrokes) {
        if (!marked.has(stroke.id)) continue;
        drawHighlighter(ctx, stroke, hl.color, 9, (d) => [
          d.x * t.scaleX + t.offsetX,
          d.y * t.scaleX + t.offsetY,
        ]);
      }
    }
    for (const stroke of currentStrokes) {
      ctx.strokeStyle = '#111111';
      drawStrokeAutoFit(ctx, stroke, t.scaleX, t.offsetX, t.offsetY);
    }
  }

  return (
    <div
      ref={wrapperRef}
      className={
        'relative h-full w-full overflow-hidden ' +
        (transparent
          ? ''
          : 'rounded-lg border border-border bg-card ') +
        (className ?? '')
      }
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}

/**
 * 형광펜 한 획 — 글씨 경로를 따라 굵고 반투명하게 덧칠한다.
 *
 * `multiply` 로 합성해 종이·글씨가 비쳐 보이게 한다(진짜 형광펜처럼). 굵기는
 * 글씨보다 훨씬 두껍게 잡아 "칠했다"가 분명히 읽히게 한다.
 */
function drawHighlighter(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  color: string,
  width: number,
  project: (d: { x: number; y: number }) => [number, number],
) {
  const dots = stroke.dots;
  if (dots.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(6, width);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  dots.forEach((d, i) => {
    const [x, y] = project(d);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  // 점 하나짜리 획도 보이게 — 제자리에 짧은 선을 긋는다
  if (dots.length === 1) {
    const [x, y] = project(dots[0]);
    ctx.lineTo(x + 0.01, y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawStrokeMm(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  scaleX: number,
  scaleY: number,
  offsetX: number,
  offsetY: number,
  pxPerMm: number,
) {
  const dots = stroke.dots;
  if (dots.length === 0) return;

  if (dots.length === 1) {
    const d = dots[0];
    const px = d.x * scaleX + offsetX;
    const py = d.y * scaleY + offsetY;
    const r = Math.max(0.25, mmThickness(d, pxPerMm) / 2);
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = '#111111';
    ctx.fill();
    return;
  }

  // 꺾은선 방지 — 베지어 스무딩 (필압 굵기는 구간별 유지)
  drawSmoothStroke(
    ctx,
    dots.map((d) => ({ x: d.x * scaleX + offsetX, y: d.y * scaleY + offsetY })),
    (i) => Math.max(0.5, mmThickness(dots[i], pxPerMm)),
  );
}

function drawStrokeAutoFit(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  scale: number,
  offsetX: number,
  offsetY: number,
) {
  const dots = stroke.dots;
  if (dots.length === 0) return;

  if (dots.length === 1) {
    const d = dots[0];
    const px = d.x * scale + offsetX;
    const py = d.y * scale + offsetY;
    const r = Math.max(0.4, autoFitThickness(d) / 2);
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = '#111111';
    ctx.fill();
    return;
  }

  // 꺾은선 방지 — 베지어 스무딩 (필압 굵기는 구간별 유지)
  drawSmoothStroke(
    ctx,
    dots.map((d) => ({ x: d.x * scale + offsetX, y: d.y * scale + offsetY })),
    (i) => autoFitThickness(dots[i]),
  );
}

/** CSS-px stroke width for a dot, calibrated to 0.3–0.8 mm of paper. */
function mmThickness(
  d: { pressure: number; maxPressure: number },
  pxPerMm: number,
) {
  const p = normalizedPressure(d);
  const widthMm = PEN_WIDTH_MIN_MM + p * (PEN_WIDTH_MAX_MM - PEN_WIDTH_MIN_MM);
  return widthMm * pxPerMm;
}

/** Heuristic CSS-px width for auto-fit (no physical scale reference). */
function autoFitThickness(d: { pressure: number; maxPressure: number }) {
  const p = normalizedPressure(d);
  return 0.3 + p * 0.6;
}
