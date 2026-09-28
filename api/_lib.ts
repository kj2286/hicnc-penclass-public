import { randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isStaffRole } from '../shared/staff-access.js';

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
  if (!isStaffRole(caller.role)) {
    return { error: '학생 계정은 사용하지 않습니다. 선생님 화면에서 학생 기록을 관리해 주세요.', status: 403 };
  }
  if (roles && !roles.includes(caller.role)) {
    return { error: '권한이 없습니다.', status: 403 };
  }
  return { caller, admin };
}

/** 교사 임시 비밀번호는 발급마다 생성하며 첫 로그인에서 변경한다. */
export function generatePassword(): string {
  return `Hc1!${randomBytes(9).toString('base64url')}`;
}

// 이전 계정 형식의 호환 상수. 새 학생 계정 발급에는 사용하지 않는다.
export const STUDENT_EMAIL_DOMAIN = 'student.penclass.app';
