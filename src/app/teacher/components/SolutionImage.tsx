/**
 * 해설(풀이+답안) 이미지 — **문항 영역만 잘라** 보여주고, 필요하면 전체 쪽으로
 * 펼친다 (사용자 신고 2026-09-02: "풀이·답안 보기를 눌러도 해당 문항이 안 보인다"
 * — 쪽 전체 이미지라 어느 문항인지 찾기 어려웠다).
 *
 * box 는 0~1 비율(x0,y0,x1,y1). 없으면 전체 쪽만 보여준다.
 * 크롭은 캔버스로 한다 — CSS 클리핑은 인쇄·PDF 에서 어긋난다.
 */
import { useEffect, useRef, useState } from 'react';

type Box = { x0: number; y0: number; x1: number; y1: number };

export function SolutionImage({
  src,
  box,
  page,
  caption,
}: {
  src: string;
  box: Box | null;
  page: number;
  caption?: string;
}) {
  const [full, setFull] = useState(!box);
  const [cropped, setCropped] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    setCropped(null);
    setFailed(false);
    setFull(!box);
    if (!box) return;
    let alive = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (!alive) return;
      try {
        // 문항 둘레에 여백을 조금 두어 번호·답란이 잘리지 않게 한다
        const pad = 0.015;
        const x0 = Math.max(0, box.x0 - pad) * img.naturalWidth;
        const y0 = Math.max(0, box.y0 - pad) * img.naturalHeight;
        const x1 = Math.min(1, box.x1 + pad) * img.naturalWidth;
        const y1 = Math.min(1, box.y1 + pad) * img.naturalHeight;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(x1 - x0));
        canvas.height = Math.max(1, Math.round(y1 - y0));
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no ctx');
        ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0, 0, 0, canvas.width, canvas.height);
        setCropped(canvas.toDataURL('image/png'));
      } catch {
        // 크로스오리진 캔버스 오염 등 — 전체 쪽으로 물러선다
        setFailed(true);
        setFull(true);
      }
    };
    img.onerror = () => {
      if (!alive) return;
      setFailed(true);
      setFull(true);
    };
    img.src = src;
    return () => {
      alive = false;
    };
  }, [src, box]);

  const showCrop = !full && cropped;
  return (
    <figure data-testid="solution-image">
      <img
        ref={imgRef}
        src={showCrop ? cropped : src}
        alt={`해설 ${page}쪽${showCrop ? ' — 이 문항' : ''}`}
        className="w-full rounded-lg border border-line-weak"
      />
      <figcaption className="mt-1 flex items-center gap-2 text-[11px] text-ink-subtle">
        <span>
          해설 PDF p.{page}
          {caption ? ` — ${caption}` : ''}
          {showCrop ? ' (이 문항 영역만)' : ''}
        </span>
        {box && !failed && (
          <button
            type="button"
            onClick={() => setFull((v) => !v)}
            className="ml-auto rounded border border-line-weak px-1.5 py-0.5 text-[11px] text-ink-muted hover:text-ink"
          >
            {full ? '이 문항만 보기' : '쪽 전체 보기'}
          </button>
        )}
      </figcaption>
    </figure>
  );
}
