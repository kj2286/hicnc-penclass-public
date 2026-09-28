/**
 * 공개 예정 자리표시 — 아직 열지 않은 기능의 라우트를 막을 때 사용.
 * (메뉴는 PortalShell 의 disabled 로 함께 잠근다)
 */
import { EmptyState, type EmptyStateIllustration } from '@/components/EmptyState';

export function ComingSoon({
  title,
  illustration = 'inbox',
}: {
  title: string;
  illustration?: EmptyStateIllustration;
}) {
  return (
    <div className="rounded-xl border border-line-weak bg-layer-default">
      <EmptyState
        illustration={illustration}
        title={`${title} — 공개 예정`}
        description="준비 중인 기능입니다. 곧 공개할 예정이에요."
      />
    </div>
  );
}
