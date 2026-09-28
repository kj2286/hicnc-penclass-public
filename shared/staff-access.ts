/** 학생은 로그인 주체가 아니라 선생님이 관리하는 기록이다. */
export function isStaffRole(role: unknown): role is 'teacher' | 'admin' {
  return role === 'teacher' || role === 'admin';
}
