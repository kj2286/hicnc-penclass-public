/**
 * 강제 비밀번호 변경 — 임시 비밀번호로 로그인한 학생은
 * 새 비밀번호를 설정하기 전까지 포털에 들어갈 수 없다.
 * (StudentShell 이 profile.mustChangePassword 로 게이트)
 */
import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { ActionButton } from 'seed-design/ui/action-button';
import { Callout } from 'seed-design/ui/callout';
import { TextField, TextFieldInput } from 'seed-design/ui/text-field';
import { changeMyPassword } from '@/lib/api';
import {
  ACADEMY_PASSWORD_RULE_TEXT,
  PASSWORD_RULE_TEXT,
  validateAcademyPassword,
  validateNewPassword,
} from '@/lib/password';
import { useSessionStore } from '@/store/session.store';

export function ForcePasswordChange() {
  const profile = useSessionStore((s) => s.profile);
  const refreshProfile = useSessionStore((s) => s.refreshProfile);
  const signOut = useSessionStore((s) => s.signOut);
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 선생님(임시 비밀번호)은 학원 정책, 학생은 기존 정책 그대로
  const isTeacher = profile?.role === 'teacher';
  const ruleText = isTeacher ? ACADEMY_PASSWORD_RULE_TEXT : PASSWORD_RULE_TEXT;
  const validate = isTeacher ? validateAcademyPassword : validateNewPassword;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const ruleErr = validate(pw1);
    if (ruleErr) {
      setError(ruleErr);
      return;
    }
    if (pw1 !== pw2) {
      setError('두 비밀번호가 서로 달라요. 다시 확인해주세요.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await changeMyPassword(pw1);
      await refreshProfile(); // mustChangePassword 해제 → 포털 진입
    } catch (err) {
      setError(
        err instanceof Error ? err.message : '비밀번호 변경에 실패했습니다.',
      );
    } finally {
      setSaving(false);
    }
  };

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
          <h1 className="flex items-center gap-2 text-[24px] font-semibold tracking-[-0.02em] text-ink">
            <KeyRound size={20} className="text-brand" /> 새 비밀번호 설정
          </h1>
          <p className="mb-6 mt-1.5 text-[14px] leading-[1.47] text-ink-muted">
            {profile?.name ?? (isTeacher ? '선생님' : '학생')}님, 임시
            비밀번호로 로그인했어요. 계속 사용하려면 나만의 새 비밀번호를 먼저
            만들어주세요.
          </p>
          <form onSubmit={submit} className="space-y-4">
            <TextField label="새 비밀번호" description={ruleText} required>
              <TextFieldInput
                type="password"
                value={pw1}
                onChange={(e) => setPw1(e.currentTarget.value)}
                autoComplete="new-password"
                autoFocus
              />
            </TextField>
            <TextField label="새 비밀번호 확인" required>
              <TextFieldInput
                type="password"
                value={pw2}
                onChange={(e) => setPw2(e.currentTarget.value)}
                autoComplete="new-password"
              />
            </TextField>
            {error && <Callout tone="critical" description={error} />}
            <ActionButton
              type="submit"
              variant="neutralSolid"
              size="large"
              className="ap-auth-submit w-full"
              loading={saving}
            >
              비밀번호 변경하고 시작하기
            </ActionButton>
          </form>
          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-5 w-full text-center text-[13px] text-ink-subtle hover:text-ink"
          >
            다른 계정으로 로그인
          </button>
        </div>
      </div>
    </div>
  );
}
