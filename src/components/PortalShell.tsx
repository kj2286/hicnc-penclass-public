/**
 * 공용 포털 레이아웃 — 좌측 사이드바(GNB) + 콘텐츠.
 * 원본 배치를 유지하며 하이씨앤씨 토큰으로 색·서체·표면을 적용한다.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSessionStore } from '@/store/session.store';
import { NotificationBell } from '@/components/NotificationBell';

export type NavItem = {
  to: string;
  label: string;
  icon: ReactNode;
  /** true 면 경로 완전일치일 때만 활성 */
  end?: boolean;
  /** true 면 선택 불가 — "공개 예정" 표시만 */
  disabled?: boolean;
};

/**
 * 새 웹 버전 감지 — PC 앱(웹뷰)·오래 열린 탭은 배포가 자동 반영되지 않아
 * 예전 화면을 계속 보게 된다(실사용 혼선 3회). 번들 해시가 바뀌면
 * 우하단에 새로고침 배너를 띄운다. (5분 간격 + 창 복귀 시 확인)
 */
function UpdateNudge() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const current = document
      .querySelector('script[src*="/assets/index-"]')
      ?.getAttribute('src');
    if (!current) return;
    let alive = true;
    const check = async () => {
      try {
        const html = await (await fetch('/', { cache: 'no-store' })).text();
        const m = html.match(/\/assets\/index-[^"]+\.js/);
        if (alive && m && m[0] !== current) setStale(true);
      } catch {
        /* 오프라인 등 — 무시 */
      }
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') void check();
    };
    const timer = setInterval(() => void check(), 5 * 60 * 1000);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  if (!stale) return null;
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="hc-update-nudge fixed bottom-5 right-5 z-50 px-5 py-2.5 print:hidden"
    >
      새 버전으로 새로고침
    </button>
  );
}

/** 배경색 대비 글자색 — 밝은 배경이면 진한 글자, 어두우면 흰 글자 (YIQ) */
function readableTextOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const yiq =
    (((n >> 16) & 0xff) * 299 + ((n >> 8) & 0xff) * 587 + (n & 0xff) * 114) /
    1000;
  return yiq >= 150 ? '#1d1d1f' : '#ffffff';
}

export function PortalShell({
  roleLabel,
  items,
  userAction,
  brandHeader,
}: {
  roleLabel: string;
  items: NavItem[];
  /** GNB 하단 사용자 이름 옆 액션 (예: 원장 설정 톱니) */
  userAction?: React.ReactNode;
  /** 제품별 로고 영역. 미지정 시 기존 학원 브랜딩을 유지한다. */
  brandHeader?: ReactNode;
}) {
  const { profile, academy, signOut } = useSessionStore();
  const navigate = useNavigate();
  const location = useLocation();
  // 테마는 전 포털 공통 — role 을 data-portal 로 노출한다.
  const portal = profile?.role ?? 'student';

  // 학원 브랜딩 — 선생님 포털에서만 (대표자가 설정하면 소속 선생님 전원 적용)
  const brand = portal === 'teacher' && academy ? academy : null;
  const customColor =
    brand?.themeColor && /^#?[0-9a-f]{6}$/i.test(brand.themeColor.trim())
      ? brand.themeColor.trim().startsWith('#')
        ? brand.themeColor.trim()
        : `#${brand.themeColor.trim()}`
      : null;
  // 포인트 컬러 — 학원 대표색 하나가 **확정 버튼·링크·뱃지**를
  // 모두 칠한다. 그래서 사이드바가 아니라 **화면 루트**에 주입한다
  // (버튼은 사이드바 밖에도 있다). 미지정 시 하이씨앤씨 기본색을 쓴다.
  const brandStyle = customColor
    ? ({
        '--rt-point': customColor,
        '--rt-point-fg': readableTextOn(customColor),
      } as React.CSSProperties)
    : undefined;

  return (
    <div
      className="flex h-screen gap-4 bg-[#f5f5f7] p-4"
      data-portal={portal}
      style={brandStyle}
    >
      {/* 원본 사이드바 배치와 너비를 유지한다. */}
      <aside className="rt-gnb flex w-[236px] shrink-0 flex-col">
        {/* 좌측 상단 — 제품별 로고 또는 기존 학원 브랜딩 */}
        <div className="px-4 pb-3 pt-5">
          {brandHeader ?? (brand?.logoImageUrl ? (
            <div>
              <img
                src={brand.logoImageUrl}
                alt={brand.name}
                className="max-h-11 w-auto max-w-full"
                draggable={false}
              />
              {brand.logoText && (
                <div
                  className="rt-gnb-word mt-1.5 truncate text-[14px] font-semibold leading-snug"
                  title={brand.logoText}
                >
                  {brand.logoText}
                </div>
              )}
            </div>
          ) : brand ? (
            <div className="flex items-center gap-2.5 px-1">
              <img
                src="/brand/hicnc-icon.png"
                alt=""
                width={28}
                height={28}
                className="h-7 w-7 shrink-0 rounded-lg"
                draggable={false}
                aria-hidden
              />
              <div
                className="rt-gnb-word truncate text-[15px] font-semibold"
                title={brand.logoText ?? brand.name}
              >
                {brand.logoText ?? brand.name}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 px-1">
              <img
                src="/brand/hicnc-icon.png"
                alt=""
                width={28}
                height={28}
                className="h-7 w-7 shrink-0 rounded-lg"
                draggable={false}
                aria-hidden
              />
              <div className="rt-gnb-word text-[15px] font-semibold">
                하이씨앤씨 펜클래스
              </div>
            </div>
          ))}
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-1">
          {items.map((item) =>
            item.disabled ? (
              <div
                key={item.to}
                aria-disabled="true"
                className="rt-gnb-link flex h-9 cursor-not-allowed select-none items-center gap-2.5 px-2.5 text-[13.5px] font-medium opacity-40"
              >
                {item.icon}
                {item.label}
                <span className="ml-auto rounded-full border border-current px-1.5 py-0.5 text-[10px] leading-none">
                  공개 예정
                </span>
              </div>
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'flex h-9 items-center gap-2.5 px-2.5 text-[13.5px] font-medium',
                    isActive ? 'rt-gnb-link-active' : 'rt-gnb-link',
                  )
                }
              >
                {item.icon}
                {item.label}
              </NavLink>
            ),
          )}
          {profile?.role === 'student' && <NotificationBell />}
        </nav>
        <div className="rt-gnb-divider border-t p-2">
          <div className="flex items-center justify-between gap-2 px-2 py-1.5">
            <div className="min-w-0">
              <div className="rt-gnb-word truncate text-[13.5px] font-medium">
                {profile?.name}
              </div>
              <div className="rt-gnb-sub truncate text-[12px]">
                {profile?.username?.endsWith('@hicnc-penclass.invalid')
                  ? '빠른 시작'
                  : profile?.username ?? roleLabel}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {userAction}
              <button
                type="button"
                aria-label="로그아웃"
                className="rt-gnb-icon p-1.5"
                onClick={() => {
                  void signOut().then(() => navigate('/login'));
                }}
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>
        </div>
      </aside>
      <UpdateNudge />
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="min-h-0 flex-1 overflow-y-auto px-8 py-7">
          {/* 경로가 바뀔 때마다 200ms 크로스페이드 — opacity 만 움직인다 */}
          <div
            key={location.pathname}
            className="enter-fade mx-auto w-full max-w-[1120px]"
          >
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
