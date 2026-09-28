/**
 * 알림 — 학생 GNB 메뉴 항목. 안 읽은 개수 배지 + 클릭 시 우측 팝오버 목록.
 * 항목 클릭 → 읽음 처리 + 해당 제출로 이동. (학생 전용)
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNotificationsStore } from '@/store/notifications.store';
import { formatRelativeKo } from '@/lib/time';

export function NotificationBell() {
  const navigate = useNavigate();
  const { items, unread, load, markRead, markAll } = useNotificationsStore();
  const [open, setOpen] = useState(false);
  const [anchorTop, setAnchorTop] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    void load();
    // 가벼운 폴링(60초) — 다른 탭/세션에서 온 알림도 반영
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const toggle = () => {
    if (!open && buttonRef.current) {
      // GNB(사이드바) 스크롤 영역에 잘리지 않도록 화면 기준 위치로 띄운다.
      const rect = buttonRef.current.getBoundingClientRect();
      setAnchorTop(Math.max(12, Math.min(rect.top, window.innerHeight - 440)));
    }
    setOpen((v) => !v);
  };

  const onItem = (id: string, submissionId: string | null) => {
    void markRead(id);
    setOpen(false);
    if (submissionId) navigate(`/s/submissions/${submissionId}`);
  };

  return (
    <div ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`알림${unread > 0 ? ` (안 읽음 ${unread}건)` : ''}`}
        onClick={toggle}
        className={cn(
          'flex h-9 w-full items-center gap-2.5 px-2.5 text-[13.5px] font-medium',
          open ? 'rt-gnb-link-active' : 'rt-gnb-link',
        )}
      >
        <Bell size={18} />
        <span className="flex-1 text-left">알림</span>
        {unread > 0 && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-solid px-1 text-[10px] font-semibold leading-none text-ink-inverted">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="enter-fade fixed left-[252px] z-30 w-80 overflow-hidden rounded-2xl border border-line-weak bg-layer-floating shadow-[0_1px_2px_rgba(0,0,0,.05),0_20px_48px_-16px_rgba(0,0,0,.2)]"
          style={{ top: anchorTop }}
        >
          <div className="flex items-center justify-between border-b border-line-weak px-4 py-3">
            <span className="text-sm font-bold text-ink">알림</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => void markAll()}
                className="text-xs font-medium text-brand hover:underline"
              >
                모두 읽음
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-ink-subtle">
                아직 도착한 알림이 없어요.
              </div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => onItem(n.id, n.submissionId)}
                  className={cn(
                    'flex w-full items-start gap-3 border-b border-line-weak px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-neutral-weak',
                    !n.read && 'bg-brand-weak/40',
                  )}
                >
                  <span
                    className={cn(
                      'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                      n.read ? 'bg-transparent' : 'bg-brand-solid',
                    )}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink">
                      {n.title}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-ink-muted">
                      {n.body}
                    </span>
                    <span className="mt-1 block text-[11px] text-ink-subtle">
                      {formatRelativeKo(n.createdAt)}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
