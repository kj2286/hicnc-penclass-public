import { randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function serviceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export type CallerProfile = {
  id: string;
  role: 'student' | 'teacher' | 'admin';
  name: string;
};

/** Authorization: Bearer <supabase access token> 검증 → 프로필 반환 */
export async function requireCaller(
  req: { headers: Record<string, string | string[] | undefined> },
  roles?: Array<CallerProfile['role']>,
): Promise<{ caller: CallerProfile; admin: SupabaseClient } | { error: string; status: number }> {
  const auth = req.headers.authorization;
  const token = typeof auth === 'string' ? auth.replace(/^Bearer\s+/i, '') : '';
  if (!token) return { error: '로그인이 필요합니다.', status: 401 };

  const admin = serviceClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return { error: '유효하지 않은 세션입니다.', status: 401 };

  const { data: profile } = await admin
    .from('sp_profiles')
    .select('id, role, name')
    .eq('id', data.user.id)
    .maybeSingle();
  if (!profile) return { error: '프로필을 찾을 수 없습니다.', status: 403 };

  const caller = profile as CallerProfile;
  if (roles && !roles.includes(caller.role)) {
    return { error: '권한이 없습니다.', status: 403 };
  }
  return { caller, admin };
}

const USERNAME_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function randomFrom(alphabet: string, length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export function generateUsername(): string {
  return `pen${randomFrom(USERNAME_ALPHABET, 5)}`;
}

/** 학생·선생님 임시 비밀번호는 발급마다 생성하며 첫 로그인에서 변경한다. */
export function generatePassword(): string {
  return `Hc1!${randomBytes(9).toString('base64url')}`;
}

// src/lib/supabase.ts의 아이디 로그인 규칙과 같아야 한다.
export const STUDENT_EMAIL_DOMAIN = 'student.penclass.app';
