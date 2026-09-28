/**
 * 단원별 성취 레이더 — 리포트 슬라이드 02 의 형태.
 * 라이브러리 없이 SVG 로 그린다(인쇄·PDF 캡처에서 그대로 나온다).
 *
 * ⚠️ '학원 평균' 점선은 **다른 학생들의 결과를 모아야** 그릴 수 있다 —
 *    아직 집계가 없어 학생 성취도만 그린다. 없는 선을 그리지 않는다.
 */
export type RadarAxis = { label: string; value: number; avg?: number | null };

export function UnitRadar({
  axes,
  size = 320,
}: {
  axes: RadarAxis[];
  size?: number;
}) {
  if (axes.length < 3) return null;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 52; // 라벨 자리
  const n = axes.length;
  const pt = (i: number, ratio: number) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [cx + Math.cos(a) * r * ratio, cy + Math.sin(a) * r * ratio] as const;
  };
  const ring = (ratio: number) =>
    axes
      .map((_, i) => {
        const [x, y] = pt(i, ratio);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  const shape = axes
    .map((ax, i) => {
      const [x, y] = pt(i, Math.max(0, Math.min(100, ax.value)) / 100);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="mx-auto block w-full max-w-[360px]"
      role="img"
      aria-label="단원별 성취도"
    >
      {[0.25, 0.5, 0.75, 1].map((t) => (
        <polygon
          key={t}
          points={ring(t)}
          fill="none"
          stroke="#e8e8e4"
          strokeWidth={1}
        />
      ))}
      {axes.map((_, i) => {
        const [x, y] = pt(i, 1);
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={x}
            y2={y}
            stroke="#e8e8e4"
            strokeWidth={1}
          />
        );
      })}
      {[20, 40, 60, 80, 100].map((v) => (
        <text
          key={v}
          x={cx + 4}
          y={cy - (r * v) / 100 + 4}
          fontSize={9}
          fill="#a8a8b0"
        >
          {v}
        </text>
      ))}
      <polygon
        points={shape}
        fill="rgba(224,49,49,0.18)"
        stroke="#e03131"
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
      {axes.map((ax, i) => {
        const [x, y] = pt(i, Math.max(0, Math.min(100, ax.value)) / 100);
        return <circle key={i} cx={x} cy={y} r={3.5} fill="#e03131" />;
      })}
      {/* 학원(내 학생) 평균 — 값이 하나라도 있을 때만 점선으로 겹쳐 그린다 */}
      {axes.some((a) => a.avg != null) && (
        <polygon
          points={axes
            .map((ax, i) => {
              const v = Math.max(0, Math.min(100, ax.avg ?? 0)) / 100;
              const [x, y] = pt(i, v);
              return `${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .join(' ')}
          fill="none"
          stroke="#19191c"
          strokeWidth={1.5}
          strokeDasharray="5 4"
          strokeLinejoin="round"
        />
      )}
      {axes.map((ax, i) => {
        const [x, y] = pt(i, 1.16);
        const anchor = x < cx - 8 ? 'end' : x > cx + 8 ? 'start' : 'middle';
        return (
          <text
            key={ax.label}
            x={x}
            y={y}
            fontSize={10.5}
            fill="#797988"
            textAnchor={anchor}
          >
            {ax.label.length > 12 ? `${ax.label.slice(0, 11)}…` : ax.label}
          </text>
        );
      })}
    </svg>
  );
}
