/**
 * /s/settings — 내 정보(수정 불가) + 비밀번호 변경.
 * 변경은 2단계: [비밀번호 변경] → 기존 비밀번호 확인 → 새 비밀번호 입력.
 * 새 비밀번호 규칙: 영문·숫자·특수문자 포함 8~16자.
 */
import { useState } from 'react';
import { KeyRound, UserRound } from 'lucide-react';
import { ActionButton } from 'seed-design/ui/action-button';
import { Callout } from 'seed-design/ui/callout';
import { TextField, TextFieldInput } from 'seed-design/ui/text-field';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { changeMyPassword } from '@/lib/api';
import {
  PASSWORD_RULE_TEXT,
  validateNewPassword,
  verifyCurrentPassword,
} from '@/lib/password';
import { useSessionStore } from '@/store/session.store';
import { useStudentSnackbar } from './components/snackbar';

type Step = 'idle' | 'verify' | 'new';

export function SettingsPage() {
  const profile = useSessionStore((s) => s.profile);
  const refreshProfile = useSessionStore((s) => s.refreshProfile);
  const snackbar = useStudentSnackbar();

  const [step, setStep] = useState<Step>('idle');
  const [current, setCurrent] = useState('');
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setStep('idle');
    setCurrent('');
    setPw1('');
    setPw2('');
    setError(null);
  };

  /** 1단계 — 기존 비밀번호가 맞는지 확인 */
  const submitVerify = async () => {
    if (busy || !profile?.username) return;
    if (!current) {
      setError('기존 비밀번호를 입력해주세요.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ok = await verifyCurrentPassword(profile.username, current);
      if (!ok) {
        setError('기존 비밀번호가 올바르지 않아요.');
        return;
      }
      setStep('new');
    } finally {
      setBusy(false);
    }
  };

  /** 2단계 — 규칙에 맞는 새 비밀번호로 변경 */
  const submitChange = async () => {
    if (busy) return;
    const ruleErr = validateNewPassword(pw1);
    if (ruleErr) {
      setError(ruleErr);
      return;
    }
    if (pw1 !== pw2) {
      setError('두 비밀번호가 서로 달라요. 다시 확인해주세요.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await changeMyPassword(pw1);
      await refreshProfile();
      reset();
      snackbar.success('비밀번호를 바꿨어요.');
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : '비밀번호를 바꾸지 못했어요. 잠시 후 다시 시도해주세요.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <header>
        <p className="rt-eyebrow mb-1.5">SETTINGS</p>
        <h2 className="text-2xl font-bold text-ink">설정</h2>
        <p className="mt-1 text-sm text-ink-muted">
          내 계정 정보를 확인하고 비밀번호를 바꿀 수 있어요.
        </p>
      </header>

      {profile?.mustChangePassword && (
        <Callout
          tone="warning"
          title="임시 비밀번호를 사용 중이에요"
          description="아래에서 새 비밀번호로 바꿔주세요."
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserRound size={18} className="text-brand" />
            내 정보
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <InfoRow label="이름" value={profile?.name ?? '-'} />
          <InfoRow label="아이디" value={profile?.username ?? '-'} />
          <p className="text-xs text-ink-subtle">
            이름과 아이디는 선생님이 등록한 정보라 직접 바꿀 수 없어요.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound size={18} className="text-brand" />
            비밀번호 변경
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {step === 'idle' && (
            <>
              <p className="text-sm text-ink-muted">
                보안을 위해 먼저 기존 비밀번호를 확인한 뒤 새 비밀번호를
                설정해요. 새 비밀번호는 {PASSWORD_RULE_TEXT}여야 합니다.
              </p>
              <div>
                <ActionButton
                  variant="brandSolid"
                  size="medium"
                  onClick={() => {
                    setError(null);
                    setStep('verify');
                  }}
                >
                  비밀번호 변경
                </ActionButton>
              </div>
            </>
          )}

          {step === 'verify' && (
            <>
              <TextField
                label="기존 비밀번호"
                description="지금 사용 중인 비밀번호를 입력해주세요."
                required
              >
                <TextFieldInput
                  type="password"
                  value={current}
                  onChange={(e) => setCurrent(e.currentTarget.value)}
                  placeholder="기존 비밀번호"
                  autoComplete="current-password"
                  autoFocus
                  disabled={busy}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submitVerify();
                  }}
                />
              </TextField>
              {error && <Callout tone="critical" description={error} />}
              <div className="flex items-center gap-2">
                <ActionButton
                  variant="brandSolid"
                  size="medium"
                  loading={busy}
                  onClick={() => void submitVerify()}
                >
                  확인
                </ActionButton>
                <ActionButton variant="neutralWeak" size="medium" onClick={reset}>
                  취소
                </ActionButton>
              </div>
            </>
          )}

          {step === 'new' && (
            <>
              <Callout
                tone="positive"
                description="기존 비밀번호가 확인됐어요. 새 비밀번호를 설정해주세요."
              />
              <TextField
                label="새 비밀번호"
                description={PASSWORD_RULE_TEXT}
                required
              >
                <TextFieldInput
                  type="password"
                  value={pw1}
                  onChange={(e) => setPw1(e.currentTarget.value)}
                  placeholder="새 비밀번호"
                  autoComplete="new-password"
                  autoFocus
                  disabled={busy}
                />
              </TextField>
              <TextField label="새 비밀번호 확인" required>
                <TextFieldInput
                  type="password"
                  value={pw2}
                  onChange={(e) => setPw2(e.currentTarget.value)}
                  placeholder="한 번 더 입력"
                  autoComplete="new-password"
                  disabled={busy}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submitChange();
                  }}
                />
              </TextField>
              {error && <Callout tone="critical" description={error} />}
              <div className="flex items-center gap-2">
                <ActionButton
                  variant="brandSolid"
                  size="medium"
                  loading={busy}
                  disabled={busy || pw1.length === 0 || pw2.length === 0}
                  onClick={() => void submitChange()}
                >
                  비밀번호 바꾸기
                </ActionButton>
                <ActionButton variant="neutralWeak" size="medium" onClick={reset}>
                  취소
                </ActionButton>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-neutral-weak px-4 py-3">
      <span className="text-sm text-ink-muted">{label}</span>
      <span className="text-sm font-semibold text-ink">{value}</span>
    </div>
  );
}
