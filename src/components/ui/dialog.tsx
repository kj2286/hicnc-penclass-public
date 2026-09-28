/** Radix-style Dialog API mapped onto SEED Dialog primitives. */
import * as React from 'react';
import { createPortal } from 'react-dom';
import {
  DialogBackdrop,
  DialogContent as SeedDialogContent,
  DialogDescription as SeedDialogDescription,
  DialogFooter as SeedDialogFooter,
  DialogHeader as SeedDialogHeader,
  DialogPositioner,
  DialogRoot,
  DialogTitle as SeedDialogTitle,
  DialogTrigger,
} from '@seed-design/react';
import { cn } from '@/lib/utils';

export function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  // 열려 있는 동안 배경 스크롤 잠금 — 팝업은 뷰포트에 고정돼 있는데 배경만
  // 흐르면 위치가 어긋나 보인다(사용자 지시 2026-08-18: 배경 스크롤 금지)
  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      {children}
    </DialogRoot>
  );
}

export { DialogTrigger };

/**
 * 팝업 공통 디자인 규칙 (전 팝업 동일 적용):
 * - 상하좌우 패딩 20px (.sp-dialog, index.css)
 * - 입력박스 높이 40px (.sp-dialog input/select, index.css)
 * - 배경 딤 없음(.sp-dialog-backdrop) — 대신 그림자+테두리로 구분
 */
export const DialogContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) =>
  // 🚨 **body 로 포털** — PortalShell 이 화면 전환마다 transform 을 걸어
  // (페이드 인) 조상에 transform 이 생기면 position:fixed 의 기준이 뷰포트가
  // 아니라 그 조상이 된다. 그래서 CSS 만으로는 팝업이 스크롤 아래에 떴다
  // (실사고 2026-08-18). Drawer 가 같은 이유로 이미 포털이다 — Dialog 도 맞춘다.
  // data-portal 로 테마 토큰([data-portal] 스코프)도 함께 따라온다.
  createPortal(
    <div data-portal="dialog">
      <DialogBackdrop className="sp-dialog-backdrop" />
      <DialogPositioner>
        <SeedDialogContent
          ref={ref}
          className={cn(
            'sp-dialog sp-popup w-full max-w-md border border-line-weak shadow-2xl',
            className,
          )}
          {...props}
        >
          {children}
        </SeedDialogContent>
      </DialogPositioner>
    </div>,
    document.body,
  ),
);
DialogContent.displayName = 'DialogContent';

/** 헤더 — 제목+설명. 구분선 없이 여백으로만 본문과 나눈다 */
export const DialogHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <SeedDialogHeader
    ref={ref}
    className={cn('sp-dialog-header', className)}
    {...props}
  />
));
DialogHeader.displayName = 'DialogHeader';

/** 푸터 — 얇은 구분선 위, 액션은 오른쪽. 주 동작이 맨 오른쪽에 온다 */
export const DialogFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <SeedDialogFooter
    ref={ref}
    className={cn('sp-dialog-footer', className)}
    {...props}
  />
));
DialogFooter.displayName = 'DialogFooter';

export const DialogTitle = SeedDialogTitle;
export const DialogDescription = SeedDialogDescription;
