/**
 * 필기 스무딩 — 점열을 quadratic Bézier(중점 기법)로 그린다.
 *
 * 펜 샘플링 좌표를 lineTo 로 직결하면 글자가 꺾은선처럼 보인다. 각 점을
 * 제어점으로, 이웃 점과의 중점을 끝점으로 하는 2차 베지어를 이어 붙이면
 * 원 좌표를 지나치게 왜곡하지 않으면서 부드러운 곡선이 된다.
 *
 * 필압 굵기를 살리기 위해 구간마다 sub-path 를 따로 stroke 한다 —
 * 호출부가 lineCap/lineJoin 을 'round' 로 두면 이음이 보이지 않는다.
 */
/** 온스크린/오프스크린 컨텍스트를 모두 받기 위한 최소 구조 타입 */
type PathCtx = {
  lineWidth: number;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  stroke(): void;
};

export function drawSmoothStroke(
  ctx: PathCtx,
  pts: ReadonlyArray<{ x: number; y: number }>,
  /** 구간 i(점 i 에서 출발)의 선 굵기 */
  widthAt: (i: number) => number,
): void {
  const n = pts.length;
  if (n < 2) return;
  if (n === 2) {
    ctx.lineWidth = widthAt(0);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[1].x, pts[1].y);
    ctx.stroke();
    return;
  }

  const midX = (i: number) => (pts[i].x + pts[i + 1].x) / 2;
  const midY = (i: number) => (pts[i].y + pts[i + 1].y) / 2;

  // 시작: 첫 점 → 첫 중점 (직선)
  ctx.lineWidth = widthAt(0);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  ctx.lineTo(midX(0), midY(0));
  ctx.stroke();

  // 본체: 중점 → (제어점 = 실제 점) → 다음 중점
  for (let i = 1; i < n - 1; i++) {
    ctx.lineWidth = widthAt(i);
    ctx.beginPath();
    ctx.moveTo(midX(i - 1), midY(i - 1));
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX(i), midY(i));
    ctx.stroke();
  }

  // 끝: 마지막 중점 → 마지막 점 (직선)
  ctx.lineWidth = widthAt(n - 2);
  ctx.beginPath();
  ctx.moveTo(midX(n - 2), midY(n - 2));
  ctx.lineTo(pts[n - 1].x, pts[n - 1].y);
  ctx.stroke();
}
