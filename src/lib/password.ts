/**
 * 비밀번호 정책 — 학생이 직접 설정하는 비밀번호는
 * **영문·숫자·특수문자를 모두 포함한 8~16자**여야 한다.
 */
import { requireSupabase, usernameToEmail } from '@/lib/supabase';

export const PASSWORD_RULE_TEXT = '영문·숫자·특수문자를 모두 포함한 8~16자';

/** 규칙 위반 시 사용자 표시용 메시지, 통과 시 null */
export function validateNewPassword(pw: string): string | null {
  if (pw.length < 8 || pw.length > 16) {
    return '비밀번호는 8~16자여야 해요.';
  }
  if (!/[a-zA-Z]/.test(pw)) return '영문자를 포함해주세요.';
  if (!/\d/.test(pw)) return '숫자를 포함해주세요.';
  if (!/[^a-zA-Z0-9]/.test(pw)) return '특수문자(!@# 등)를 포함해주세요.';
  return null;
}

// ---------- 학원(선생님) 계정 비밀번호 정책 ----------
// 회원가입·선생님 임시 비밀번호 변경에 적용. 학생 정책과 별개로 유지해
// 기존 학생 플로우에 회귀가 없게 한다.

export const ACADEMY_PASSWORD_RULE_TEXT =
  '대문자·소문자·특수문자를 각 1개 이상 포함한 8~16자';

/** 규칙 위반 시 사용자 표시용 메시지, 통과 시 null (서버 api/academy.ts 와 동일 규칙) */
export function validateAcademyPassword(pw: string): string | null {
  if (pw.length < 8 || pw.length > 16) return '비밀번호는 8~16자여야 해요.';
  if (!/[A-Z]/.test(pw)) return '대문자를 1개 이상 포함해주세요.';
  if (!/[a-z]/.test(pw)) return '소문자를 1개 이상 포함해주세요.';
  if (!/[^a-zA-Z0-9]/.test(pw)) return '특수문자(!@# 등)를 1개 이상 포함해주세요.';
  return null;
}

/**
 * 기존 비밀번호 확인 — 같은 계정으로 재로그인해 검증한다.
 * (성공해도 동일 사용자 세션이 갱신될 뿐 로그아웃되지 않는다)
 */
export async function verifyCurrentPassword(
  username: string,
  current: string,
): Promise<boolean> {
  const supabase = requireSupabase();
  const { error } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(username),
    password: current,
  });
  return !error;
}
