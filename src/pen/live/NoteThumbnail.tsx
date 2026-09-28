import { useEffect, useRef } from 'react';
import { normalizedPressure } from './model/stroke';
import { drawSmoothStroke } from './model/smooth-stroke';
import type { Stroke } from './model/stroke';
import type { Bounds } from './model/stroke-groups';

type Props = {
  strokes: readonly Stroke[];
  bbox: Bounds;
  className?: string;
};

/**
 * Compact stroke-only renderer used inside NoteCard. Maps `bbox` to the
 * canvas with a small margin so the strokes never kiss the edge. No
 * background — the card surface shows through.
 */
export function NoteThumbnail({ strokes, bbox, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;

    let raf = 0;
    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.floor(wrapper.offsetWidth));
      const h = Math.max(1, Math.floor(wrapper.offsetHeight));
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);

      const margin = 6;
      const innerW = Math.max(1, w - margin * 2);
      const innerH = Math.max(1, h - margin * 2);
      const bw = Math.max(1e-3, bbox.maxX - bbox.minX);
      const bh = Math.max(1e-3, bbox.maxY - bbox.minY);

      // Uniform fit, centered.
      const scale = Math.min(innerW / bw, innerH / bh);
      const offsetX = margin + (innerW - bw * scale) / 2 - bbox.minX * scale;
      const offsetY = margin + (innerH - bh * scale) / 2 - bbox.minY * scale;

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#1A1815';

      for (const stroke of strokes) {
        const dots = stroke.dots;
        if (dots.length === 0) continue;
        if (dots.length === 1) {
          const d = dots[0];
          ctx.beginPath();
          const r = Math.max(0.6, normalizedPressure(d) * 1.4 + 0.6);
          ctx.fillStyle = '#1A1815';
          ctx.arc(d.x * scale + offsetX, d.y * scale + offsetY, r, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        // 꺾은선 방지 — 베지어 스무딩 (필압 굵기는 구간별 유지)
        drawSmoothStroke(
          ctx,
          dots.map((d) => ({
            x: d.x * scale + offsetX,
            y: d.y * scale + offsetY,
          })),
          (i) => Math.max(0.7, normalizedPressure(dots[i]) * 1.6 + 0.7),
        );
      }
    };

    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    });
    ro.observe(wrapper);
    raf = requestAnimationFrame(draw);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [strokes, bbox.minX, bbox.minY, bbox.maxX, bbox.maxY]);

  return (
    <div
      ref={wrapperRef}
      className={
        'relative h-full w-full overflow-hidden rounded-md bg-parchment-50 ' +
        (className ?? '')
      }
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(to bottom, transparent 0, transparent 13px, #1A1815 13px, #1A1815 14px)',
        }}
      />
    </div>
  );
}
