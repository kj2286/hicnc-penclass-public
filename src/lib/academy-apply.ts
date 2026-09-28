/**
 * 학원 도입 신청 — 입력 검증 (순수 함수).
 *
 * 랜딩페이지에서 로그인 없이 받는 폼이라, **잘못 들어온 값을 여기서 거른다.**
 * 접수는 한 번뿐이고 다시 물어볼 방법이 연락처밖에 없다 — 연락처가 틀리면
 * 그 신청은 통째로 죽는다. 그래서 연락처만은 형식을 확실히 본다.
 */

export type AcademyApplication = {
  academyName: string;
  location: string;
  studentCount: string;
  teacherCount: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  memo: string;
};

export const EMPTY_APPLICATION: AcademyApplication = {
  academyName: '',
  location: '',
  studentCount: '',
  teacherCount: '',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  memo: '',
};

/** 필드별 오류 메시지 — 비어 있으면 통과 */
export type ApplicationErrors = Partial<Record<keyof AcademyApplication, string>>;

/** 휴대폰/일반전화 숫자만 남긴다 */
export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '');
}

/** 010-1234-5678 형태로 보기 좋게 (입력 중에도 쓴다) */
export function formatPhone(raw: string): string {
  const d = normalizePhone(raw).slice(0, 11);
  if (d.length < 4) return d;
  if (d.length < 8) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length < 11) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}

export function validateApplication(v: AcademyApplication): ApplicationErrors {
  const e: ApplicationErrors = {};
  if (!v.academyName.trim()) e.academyName = '학원명을 입력해주세요.';
  if (!v.location.trim()) e.location = '학원 위치를 입력해주세요.';

  const phone = normalizePhone(v.contactPhone);
  if (!phone) e.contactPhone = '연락처를 입력해주세요.';
  // 휴대폰(01x, 10~11자리) 또는 지역번호 유선(9~11자리) 허용 — 학원 대표번호가
  // 유선인 경우가 많아 휴대폰만 받으면 접수를 놓친다.
  else if (!/^(01[016789]\d{7,8}|0[2-6]\d{7,9})$/.test(phone))
    e.contactPhone = '연락처 형식이 올바르지 않습니다. (예: 010-1234-5678)';

  // 이메일 — 전화번호가 틀리면 되물을 방법이 없어 연락 경로를 둘로 둔다.
  // 필수로 받되 형식만 가볍게 본다(과한 정규식은 멀쩡한 주소를 막는다).
  const email = v.contactEmail.trim();
  if (!email) e.contactEmail = '이메일을 입력해주세요.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    e.contactEmail = '이메일 형식이 올바르지 않습니다.';

  // 인원은 선택 입력 — 적었다면 숫자여야 한다
  for (const k of ['studentCount', 'teacherCount'] as const) {
    const raw = v[k].trim();
    if (!raw) continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100000)
      e[k] = '숫자로 입력해주세요.';
  }
  return e;
}

export function hasErrors(e: ApplicationErrors): boolean {
  return Object.values(e).some(Boolean);
}

/** DB(sp_academy_applications) 에 넣을 형태로 — 빈 값은 null 로 */
export function toRow(v: AcademyApplication): Record<string, unknown> {
  const num = (s: string) => {
    const n = Number(s.trim());
    return s.trim() && Number.isFinite(n) ? Math.round(n) : null;
  };
  return {
    academy_name: v.academyName.trim(),
    location: v.location.trim(),
    student_count: num(v.studentCount),
    teacher_count: num(v.teacherCount),
    contact_name: v.contactName.trim() || null,
    contact_phone: normalizePhone(v.contactPhone),
    contact_email: v.contactEmail.trim().toLowerCase() || null,
    memo: v.memo.trim() || null,
  };
}
