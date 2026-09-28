/**
 * 포털 공통 페이지 헤더 — 큰 제목 + 한 줄 보조문.
 * 장식(색 밴드·이미지)은 두지 않는다. 위계는 크기와 굵기, 그리고 여백으로만.
 */
export function PortalHero({
  title,
  subtitle,
}: {
  title: React.ReactNode;
  subtitle?: string;
}) {
  return (
    <header className="mb-7">
      <h1 className="text-[28px] font-semibold tracking-[-0.02em] text-ink">
        {title}
      </h1>
      {subtitle && (
        <p className="mt-2 max-w-[64ch] text-[15px] leading-[1.47] text-ink-muted">
          {subtitle}
        </p>
      )}
    </header>
  );
}
