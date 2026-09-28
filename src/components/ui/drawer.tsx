/**
 * 우측 슬라이드 패널(Drawer) — 화면에 고정되는 slide-over.
 *
 * 기존 공용 Dialog(SEED positioner)는 스크롤 조상 안에 놓여 페이지를 스크롤하면
 * 팝업이 함께 밀려 화면을 벗어난다. Drawer 는 body 로 포털 렌더 + position:fixed
 * + body 스크롤 잠금이라 어떤 스크롤에도 화면에 고정된다.
 *
 * 디자인: 딤 없음(연한 클릭 캐처) + 강한 그림자·좌측 라인으로 구분(전 팝업 규칙 계승),
 * 우측에서 부드럽게 슬라이드 인(중단 가능한 CSS transition, reduced-motion 존중).
 */
import * as React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const ANIM_MS = 280;

export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  closeDisabled = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  closeDisabled?: boolean;
}) {
  const [mounted, setMounted] = React.useState(open);
  const [visible, setVisible] = React.useState(false);

  // open 전이 → 마운트 후 다음 프레임에 슬라이드 인 / 닫힘 → 애니메이션 후 언마운트
  React.useEffect(() => {
    let raf = 0;
    let timer = 0;
    let revealTimer = 0;
    if (open) {
      setMounted(true);
      raf = requestAnimationFrame(() => setVisible(true));
      // WebView가 프레임 콜백을 미뤄도 패널을 화면 밖에 남겨두지 않는다.
      revealTimer = window.setTimeout(() => setVisible(true), 80);
    } else if (mounted) {
      setVisible(false);
      timer = window.setTimeout(() => setMounted(false), ANIM_MS);
    }
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      window.clearTimeout(revealTimer);
    };
  }, [open, mounted]);

  // 마운트 동안 body 스크롤 잠금 — 뒤 배경이 스크롤돼도 팝업은 화면 고정
  React.useEffect(() => {
    if (!mounted) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mounted]);

  // ESC 로 닫기
  React.useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !closeDisabled) onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mounted, onOpenChange, closeDisabled]);

  if (!mounted) return null;

  return createPortal(
    // body 로 포털되므로 data-portal 을 직접 달아 Pine 테마(그린 토큰·직사각·40px 입력·
    // 14px 기본)가 Drawer 안에도 적용되게 한다.
    <div className="fixed inset-0 z-50" data-portal="drawer">
      {/* 딤 없는 클릭 캐처 (바깥 클릭 시 닫힘) */}
      <div
        className="absolute inset-0"
        style={{
          // 모달 위계 — 뒤 화면이 확실히 뒤로 물러나야 폼에 집중된다
          background: 'rgba(16, 18, 22, 0.32)',
        }}
        onClick={() => { if (!closeDisabled) onOpenChange(false); }}
        aria-hidden
      />
      {/* 우측 고정 패널 */}
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'sp-popup absolute right-0 top-0 flex h-full w-full max-w-[520px] flex-col overflow-x-hidden bg-layer-default shadow-[0_0_60px_-12px_rgba(8,24,18,0.45)]',
          'motion-reduce:transition-none',
          className,
        )}
        style={{
          transform: visible ? 'translateX(0)' : 'translateX(100%)',
          transition: `transform ${ANIM_MS}ms cubic-bezier(0.2, 0, 0, 1)`,
          willChange: 'transform',
        }}
      >
        <div className="flex items-start justify-between gap-4 bg-layer-default px-6 pb-4 pt-6">
          <div className="min-w-0">
            {title && (
              <h2 className="text-[19px] font-bold leading-tight tracking-[-0.02em] text-ink">
                {title}
              </h2>
            )}
            {description && (
              <div className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
                {description}
              </div>
            )}
          </div>
          <button
            type="button"
            aria-label="닫기"
            disabled={closeDisabled}
            title={closeDisabled ? '교재 처리가 끝나면 닫을 수 있습니다' : undefined}
            onClick={() => { if (!closeDisabled) onOpenChange(false); }}
            className="sp-btn-free grid h-8 w-8 shrink-0 place-items-center text-ink-subtle transition-colors hover:bg-neutral-weak hover:text-ink disabled:cursor-wait disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 pb-6 pt-0">
          {children}
        </div>

        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line-weak bg-layer-default px-6 pb-6 pt-4">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
