/**
 * 일러스트 빈 상태 — public/illust-*.png (1024px, 흰 배경, seed 톤 추상 일러스트).
 * 데이터 로직 없이 표시만 담당한다. 컨테이너(카드/보더 박스)는 호출부가 유지한다.
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const ILLUSTRATIONS = {
  pen: '/illust-pen.png',
  inbox: '/illust-inbox.png',
  feedback: '/illust-feedback.png',
  live: '/illust-live.png',
} as const;

export type EmptyStateIllustration = keyof typeof ILLUSTRATIONS;

export function EmptyState({
  illustration,
  title,
  description,
  action,
  size = 'default',
  className,
}: {
  illustration: EmptyStateIllustration;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  /** sm — 카드 내부 등 좁은 자리용 (일러스트·여백 축소) */
  size?: 'default' | 'sm';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'enter-fade flex flex-col items-center justify-center px-6 text-center',
        size === 'sm' ? 'py-8' : 'py-12',
        className,
      )}
    >
      <img
        src={ILLUSTRATIONS[illustration]}
        alt=""
        draggable={false}
        className={cn(
          'aspect-square select-none',
          size === 'sm' ? 'w-28' : 'w-44',
        )}
      />
      <p
        className={cn(
          'break-keep font-bold text-ink',
          size === 'sm' ? 'mt-1 text-sm' : 'mt-2 text-base',
        )}
      >
        {title}
      </p>
      {description && (
        <div className="mt-1 max-w-sm break-keep text-sm text-ink-muted">
          {description}
        </div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
