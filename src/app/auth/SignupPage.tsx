/**
 * 학원 회원가입 — 이메일 가입. 가입자는 학원의 "대표자" 선생님이 된다.
 * 전화번호는 형식 검증만 한다 (SMS 인증은 발송 업체 연동 시 추가 예정).
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ActionButton } from 'seed-design/ui/action-button';
import { Callout } from 'seed-design/ui/callout';
import { TextField, TextFieldInput } from 'seed-design/ui/text-field';
import { signupAcademy } from '@/lib/api';
import {
  ACADEMY_PASSWORD_RULE_TEXT,
  validateAcademyPassword,
} from '@/lib/password';
import { useSessionStore } from '@/store/session.store';

function isValidPhone(raw: string): boolean {
  return /^01[016789]\d{7,8}$/.test(raw.replace(/\D/g, ''));
}

function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export function SignupPage() {
  const signIn = useSessionStore((s) => s.signIn);
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [academyName, setAcademyName] = useState('');
  const [academyLocation, setAcademyLocation] = useState('');
  const [email, setEmail] = useState('');
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (!name.trim()) return setError('이름을 입력해주세요.');
    if (!isValidPhone(phone))
      return setError('휴대폰 번호 형식이 올바르지 않습니다. (예: 010-1234-5678)');
    if (!academyName.trim()) return setError('학원명을 입력해주세요.');
    if (!academyLocation.trim())
      return setError('학원 위치를 입력해주세요. (예: 서울 강남구)');
    if (!isValidEmail(email.trim()))
      return setError('이메일 주소가 올바르지 않습니다.');
    const pwErr = validateAcademyPassword(pw1);
    if (pwErr) return setError(pwErr);
    if (pw1 !== pw2)
      return setError('두 비밀번호가 서로 달라요. 다시 확인해주세요.');

    setPending(true);
    setError(null);
    try {
      await signupAcademy({
        name: name.trim(),
        phone: phone.trim(),
        academyName: academyName.trim(),
        academyLocation: academyLocation.trim(),
        email: email.trim().toLowerCase(),
        password: pw1,
      });
      // 가입 즉시 로그인 → 선생님 포털
      const result = await signIn(email.trim().toLowerCase(), pw1);
      if (result.error) {
        navigate('/login');
        return;
      }
      navigate('/t');
    } catch (err) {
      setError(err instanceof Error ? err.message : '가입에 실패했습니다.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      data-portal="auth"
      className="flex min-h-screen items-center justify-center bg-[#f5f5f7] px-5 py-12 antialiased"
    >
      <div className="w-full max-w-[400px]">
        <Link to="/" className="mb-7 flex flex-col items-center gap-3">
          <img
            src="/brand/hicnc-logo.png"
            alt="하이씨앤씨"
            height={40}
            className="h-10 w-auto max-w-full object-contain"
            draggable={false}
          />
          <span className="text-[15px] font-medium tracking-[-0.01em] text-ink">
            펜클래스
          </span>
        </Link>
        <div className="rounded-[20px] border border-black/[0.06] bg-white p-7 shadow-[0_1px_2px_rgba(0,0,0,.04),0_8px_24px_-12px_rgba(0,0,0,.12)]">
          <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-ink">
            학원 회원가입
          </h1>
          <p className="mb-6 mt-1.5 text-[14px] leading-[1.47] text-ink-muted">
            가입하시면 하이씨앤씨 펜클래스의 학원 대표자 선생님 계정이 만들어져요.
          </p>
          <form onSubmit={onSubmit} className="space-y-4">
            <TextField label="이름" required>
              <TextFieldInput
                value={name}
                onChange={(e) => setName(e.currentTarget.value)}
                placeholder="대표자 이름"
                autoComplete="name"
                autoFocus
              />
            </TextField>
            <TextField
              label="휴대폰 번호"
              description="형식 확인만 해요. 인증번호 발송은 준비 중입니다."
              required
            >
              <TextFieldInput
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.currentTarget.value)}
                placeholder="010-1234-5678"
                autoComplete="tel"
              />
            </TextField>
            <TextField label="학원명" required>
              <TextFieldInput
                value={academyName}
                onChange={(e) => setAcademyName(e.currentTarget.value)}
                placeholder="예: 하이씨앤씨"
              />
            </TextField>
            <TextField label="학원 위치" required>
              <TextFieldInput
                value={academyLocation}
                onChange={(e) => setAcademyLocation(e.currentTarget.value)}
                placeholder="예: 서울 강남구"
              />
            </TextField>
            <TextField label="이메일 (로그인 아이디)" required>
              <TextFieldInput
                type="email"
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </TextField>
            <TextField
              label="비밀번호"
              description={ACADEMY_PASSWORD_RULE_TEXT}
              required
            >
              <TextFieldInput
                type="password"
                value={pw1}
                onChange={(e) => setPw1(e.currentTarget.value)}
                autoComplete="new-password"
              />
            </TextField>
            <TextField label="비밀번호 확인" required>
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
              loading={pending}
              className="ap-auth-submit w-full"
            >
              가입하고 시작하기
            </ActionButton>
          </form>
        </div>
        <p className="mt-5 text-center text-[14px] text-ink-muted">
          이미 계정이 있으신가요?{' '}
          <Link to="/login" className="rt-link">
            로그인
          </Link>
        </p>
      </div>
    </div>
  );
}
