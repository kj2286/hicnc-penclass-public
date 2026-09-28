/**
 * 폼 필드 — 팝업·설정 화면의 입력 한 칸을 위한 표준 골격.
 *
 * 규칙(전 화면 동일):
 *   라벨(필수 표시) → 입력 → 도움말 / 오류
 * 라벨은 항상 입력 위, 오류는 항상 입력 아래. 간격은 6px 로 고정한다.
 * 시각 장식 없이 굵기·색으로만 위계를 만든다.
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Field({
  label,
  required,
  hint,
  error,
  htmlFor,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  /** 입력 아래 도움말 — 오류가 있으면 오류가 대신 보인다 */
  hint?: ReactNode;
  error?: string | null;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label
        htmlFor={htmlFor}
        className="text-[13px] font-semibold leading-none text-ink"
      >
        {label}
        {required && (
          <span className="ml-1 align-middle text-critical" aria-hidden>
            *
          </span>
        )}
      </label>
      {children}
      {error ? (
        <p className="text-[11.5px] leading-snug text-critical">{error}</p>
      ) : hint ? (
        <p className="text-[11.5px] leading-snug text-ink-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

/** 팝업 본문의 필드 스택 — 필드 사이 간격을 한 곳에서 관리한다 */
export function FieldStack({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn('flex flex-col gap-4', className)}>{children}</div>;
}
