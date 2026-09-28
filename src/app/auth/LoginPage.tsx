import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { TextField, TextFieldInput } from 'seed-design/ui/text-field';
import { Callout } from 'seed-design/ui/callout';
import { useSessionStore } from '@/store/session.store';
import { getAcademySite } from '@/lib/api';
import { isDesk } from '@/lib/desk';
import { roleHome } from '@/App';

/**
 * 로그인 — 하이씨앤씨 펜클래스 브랜드 화면.
 *
 * 빠른 시작도 실제 서버 세션과 교사 프로필을 확인한다.
 */
export function LoginPage() {
  const { signIn, signInQuickStart, envError, status, profile } = useSessionStore();
  const navigate = useNavigate();
  // 사용자가 입력한 실제 계정만 로그인한다.
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<'quick' | 'account' | null>(null);
  const requestInFlight = useRef(false);

  // 학원 홈페이지의 [로그인] 버튼은 /login?academy={slug} 로 온다.
  // 어느 학원에서 왔는지 보여줘야 "여기가 우리 학원 로그인" 임이 분명해진다.
  const [params] = useSearchParams();
  const academySlug = params.get('academy');
  const [academyName, setAcademyName] = useState<string | null>(null);
  useEffect(() => {
    if (!academySlug) return;
    let alive = true;
    // 못 찾아도 로그인은 그대로 되어야 하므로 실패는 조용히 무시한다
    void getAcademySite(academySlug)
      .then((a) => {
        if (alive && a) setAcademyName(a.name);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [academySlug]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!username || !password || requestInFlight.current || envError) return;
    requestInFlight.current = true;
    setPending('account');
    setError(null);
    try {
      const result = await signIn(username, password);
      if (result.error) {
        setError(result.error);
        return;
      }
      const role = useSessionStore.getState().profile?.role;
      navigate(role ? roleHome(role) : '/', { replace: true });
    } catch {
      setError('로그인하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.');
    } finally {
      requestInFlight.current = false;
      setPending(null);
    }
  }

  async function onQuickStart() {
    if (requestInFlight.current || envError) return;
    requestInFlight.current = true;
    setPending('quick');
    setError(null);
    try {
      const result = await signInQuickStart();
      if (result.error) setError(result.error);
      // The existing real-profile redirect above the form handles successful entry.
    } catch {
      setError('빠른 시작을 완료하지 못했습니다. 다시 눌러 주세요.');
    } finally {
      requestInFlight.current = false;
      setPending(null);
    }
  }

  if (status === 'loading') {
    return (
      <div role="status" className="flex min-h-screen items-center justify-center text-ink-muted">
        불러오는 중…
      </div>
    );
  }

  // 저장된 세션과 서버 프로필을 모두 확인한 경우에만 기존 역할 화면으로 이동한다.
  const home = status === 'signedIn' && profile ? roleHome(profile.role) : null;
  if (home && home !== '/login') {
    return <Navigate to={home} replace />;
  }

  return (
    <div
      data-portal="auth"
      className="flex min-h-screen items-center justify-center bg-[#f5f5f7] px-5 py-12 antialiased"
    >
      <div className="w-full max-w-[400px]">
        <div className="mb-7 flex flex-col items-center gap-3">
          <img
            src="/brand/hicnc-logo.png"
            alt="하이씨앤씨"
            height={40}
            className="h-10 w-auto max-w-full object-contain"
            draggable={false}
          />
          <div className="text-[15px] font-medium tracking-[-0.01em] text-ink">
            펜클래스
          </div>
        </div>

        <div className="rounded-[20px] border border-black/[0.06] bg-white p-7 shadow-[0_1px_2px_rgba(0,0,0,.04),0_8px_24px_-12px_rgba(0,0,0,.12)]">
          <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-ink">
            펜클래스 시작하기
          </h1>
          <p className="mb-6 mt-1.5 text-[14px] leading-[1.47] text-ink-muted">
            접속 정보는 이 기기에 저장됩니다. 다른 기기에서는 새 교실로 시작합니다.
            앱 데이터를 지우면 같은 교실로 돌아올 수 없습니다.
          </p>
          <button
            type="button"
            onClick={() => void onQuickStart()}
            disabled={Boolean(pending) || Boolean(envError)}
            className="ap-auth-submit h-11 w-full rounded-xl text-[15px] font-medium text-white disabled:opacity-50"
          >
            {pending === 'quick' ? '교실을 여는 중…' : '빠르게 시작하기'}
          </button>
          {(error || envError) && (
            <div className="mt-4" role="alert">
              <Callout tone="critical" description={error ?? envError} />
            </div>
          )}
          <details className="mt-6 border-t border-[var(--hc-color-line)] pt-5">
            <summary className="cursor-pointer text-[14px] font-medium text-ink-muted focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--hc-color-primary)]">
              계정으로 로그인
            </summary>
            {academyName && <p className="mt-4 text-[14px] text-ink-muted">{academyName} 계정으로 로그인합니다.</p>}
            <form onSubmit={onSubmit} className="mt-4 space-y-4">
              <TextField label="아이디" required>
                <TextFieldInput
                  value={username}
                  onChange={(e) => setUsername(e.currentTarget.value)}
                  placeholder="아이디 또는 이메일"
                  autoComplete="username"
                  disabled={Boolean(pending)}
                />
              </TextField>
              <TextField label="비밀번호" required>
                <TextFieldInput
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.currentTarget.value)}
                  placeholder="비밀번호"
                  autoComplete="current-password"
                  disabled={Boolean(pending)}
                />
              </TextField>
              <button
                type="submit"
                disabled={Boolean(pending) || Boolean(envError)}
                className="rt-btn rt-btn-outline h-11 w-full disabled:opacity-50"
              >
                {pending === 'account' ? '로그인 중…' : '로그인'}
              </button>
            </form>
            <p className="mt-4 text-center text-[14px] text-ink-muted">
              <Link to="/signup" className="rt-link">학원 계정 만들기</Link>
            </p>
          </details>
        </div>

        {/* 브라우저에서만 — 선생님은 PC 프로그램에서 로그인하도록 안내 */}
        {!isDesk() && (
          <p className="mx-auto mt-6 max-w-[46ch] text-center text-[12px] leading-[1.6] text-ink-subtle">
            크래들 수신 등 전체 기능은 PC 프로그램(하이씨앤씨 펜클래스)에서 쓸 수 있어요.{' '}
            <Link to="/about#download" className="rt-link">
              PC 프로그램 안내
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
