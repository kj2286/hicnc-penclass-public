import { type ReactNode } from 'react';

/** 아직 구현 전인 화면의 임시 표시. 구현이 붙으면 제거된다. */
export function PagePlaceholder({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center rounded-2xl border border-dashed border-line-muted bg-layer-default p-10 text-center">
      <h2 className="text-lg font-bold text-ink">{title}</h2>
      {description && (
        <p className="mt-2 max-w-md text-sm text-ink-muted">{description}</p>
      )}
      {children}
    </div>
  );
}
