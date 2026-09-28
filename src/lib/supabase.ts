import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Null when env is missing so screens can render a setup notice instead of crashing. */
export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'Supabase 환경변수(VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)가 설정되지 않았습니다.',
    );
  }
  return supabase;
}

/**
 * 학생 임시 계정은 아이디/비밀번호로 로그인한다. Supabase Auth 는 이메일 기반이므로
 * 아이디를 내부 도메인 이메일로 감싼다(회원가입/로그인 양쪽에서 동일 규칙 사용).
 */
// 기존 아이디 계정의 로그인 주소다. 제품명과 함께 바꾸면 기존 계정을 찾을 수 없다.
export const STUDENT_EMAIL_DOMAIN = 'student.penclass.app';

export function usernameToEmail(username: string): string {
  const clean = username.trim().toLowerCase();
  return clean.includes('@') ? clean : `${clean}@${STUDENT_EMAIL_DOMAIN}`;
}
