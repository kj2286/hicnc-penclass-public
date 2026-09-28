/**
 * 필기 좌표 정제 — **용지 밖 노이즈 dot 제거**.
 *
 * 실사고(2026-08-13, 박시원 중1-1 p.1): 218획 중 4개 dot 이 용지 밖
 * (x=269 / y=217, 용지는 88.6 × 125.3)으로 찍혀 있었다. 펜이 종이 경계
 * 밖이나 다른 패턴을 순간적으로 오독하면 이런 값이 섞인다. 이 dot 하나가
 *  - 그 획의 bbox 를 페이지 밖까지 늘리고
 *  - 문항 배정(겹침 면적)을 왜곡하며
 *  - 문항 뷰 영역(= 박스 ∪ 필기 범위)을 페이지 3배 크기로 폭발시켰다.
 *
 * 그래서 **배정·영역·렌더에 쓰기 전에 반드시 이 함수를 통과**시킨다.
 * 원본(서버 저장분)은 건드리지 않는다 — 표시·계산용 사본만 만든다.
 */
import type { Stroke } from '@/pen/live/model/stroke';

export type PaperRect = {
  Xmin: number;
  Xmax: number;
  Ymin: number;
  Ymax: number;
};

/** 용지 경계 바깥으로 허용하는 여유 (용지 크기 대비). 종이 가장자리에 걸친
 *  정상 필기를 버리지 않을 만큼만 준다. */
const MARGIN_RATIO = 0.03;

/**
 * 용지 범위를 벗어난 dot 을 제거한 스트로크 사본. dot 이 모두 제거된 획은
 * 결과에서 빠진다. paper 가 없으면(미등록 페이지) 원본을 그대로 돌려준다 —
 * 기준이 없으면 함부로 버리지 않는다.
 */
export function sanitizeStrokes(
  strokes: readonly Stroke[],
  paper: PaperRect | null | undefined,
): Stroke[] {
  if (!paper) return [...strokes];
  const w = paper.Xmax - paper.Xmin;
  const h = paper.Ymax - paper.Ymin;
  if (!(w > 0 && h > 0)) return [...strokes];
  const mx = w * MARGIN_RATIO;
  const my = h * MARGIN_RATIO;
  const loX = paper.Xmin - mx;
  const hiX = paper.Xmax + mx;
  const loY = paper.Ymin - my;
  const hiY = paper.Ymax + my;

  const out: Stroke[] = [];
  for (const s of strokes) {
    const dots = s.dots.filter(
      (d) => d.x >= loX && d.x <= hiX && d.y >= loY && d.y <= hiY,
    );
    if (dots.length === 0) continue;
    out.push(dots.length === s.dots.length ? s : { ...s, dots });
  }
  return out;
}

/** 사각형을 용지 범위 안으로 자른다 (문항 영역이 페이지 밖으로 나가지 않게). */
export function clampRectToPaper<
  T extends { minX: number; minY: number; maxX: number; maxY: number },
>(rect: T, paper: PaperRect | null | undefined): T {
  if (!paper) return rect;
  return {
    ...rect,
    minX: Math.max(rect.minX, paper.Xmin),
    minY: Math.max(rect.minY, paper.Ymin),
    maxX: Math.min(rect.maxX, paper.Xmax),
    maxY: Math.min(rect.maxY, paper.Ymax),
  };
}
