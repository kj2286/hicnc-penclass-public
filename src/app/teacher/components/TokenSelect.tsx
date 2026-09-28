/**
 * SEED 토큰으로 스타일링한 컴팩트 네이티브 셀렉트 — 테이블 행/필터처럼 좁은 곳에서
 * 드롭다운이 필요한 경우 사용. (SEED select-box 는 카드형 라디오 그룹이라
 * 인라인 드롭다운 용도로는 네이티브 select + 토큰 브리지가 적합)
 */
import * as React from 'react';
import { cn } from '@/lib/utils';

export interface TokenSelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  onValueChange?: (value: string) => void;
}

export const TokenSelect = React.forwardRef<HTMLSelectElement, TokenSelectProps>(
  ({ className, onValueChange, children, ...props }, ref) => (
    <select
      ref={ref}
      onChange={(e) => onValueChange?.(e.currentTarget.value)}
      className={cn(
        'h-9 cursor-pointer rounded-lg border border-line-solid bg-layer-default px-3 text-sm text-ink',
        'outline-none focus:border-line-brand disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
TokenSelect.displayName = 'TokenSelect';
