export type StrokeDot = {
  x: number;
  y: number;
  pressure: number;
  maxPressure: number;
  timeStamp: number;
};

export type Stroke = {
  id: string;
  section: number;
  owner: number;
  noteId: number;
  pageNumber: number;
  dots: StrokeDot[];
  startedAt: number;
  endedAt: number | null;
  /** PC 가 이 스트로크를 수신한 시각(ms). startedAt 은 펜 기기 시계라
   *  어긋날 수 있어, 배정 시각 비교 등 벽시계 연산은 이 값을 우선한다. */
  receivedAt?: number;
};

export type PageKey = string;

export type PageStrokeMap = Map<PageKey, Stroke[]>;

export function normalizedPressure(dot: {
  pressure: number;
  maxPressure: number;
}): number {
  if (!dot.maxPressure) return 0;
  return Math.max(0, Math.min(1, dot.pressure / dot.maxPressure));
}

export function strokeBounds(strokes: Stroke[]): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let any = false;
  for (const s of strokes) {
    for (const d of s.dots) {
      any = true;
      if (d.x < minX) minX = d.x;
      if (d.x > maxX) maxX = d.x;
      if (d.y < minY) minY = d.y;
      if (d.y > maxY) maxY = d.y;
    }
  }
  if (!any) return null;
  if (minX === maxX) {
    minX -= 0.5;
    maxX += 0.5;
  }
  if (minY === maxY) {
    minY -= 0.5;
    maxY += 0.5;
  }
  return { minX, maxX, minY, maxY };
}
