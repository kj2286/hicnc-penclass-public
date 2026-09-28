import {
  generatePassword,
  generateUsername,
  requireCaller,
  STUDENT_EMAIL_DOMAIN,
} from './_lib.js';

/** 선택 프로필 필드 — 값이 있을 때만 insert 에 포함 (008 마이그레이션 컬럼) */
export type StudentProfileInput = {
  schoolLevel?: string; // 초|중|고
  grade?: number;
  studentPhone?: string;
  parentPhone?: string;
  school?: string;
  startDate?: string; // YYYY-MM-DD
  address?: string;
  notes?: string;
  hasPen?: boolean;
};

type Req = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: { name?: string; profile?: StudentProfileInput };
};
type Res = {
  status: (code: number) => Res;
  json: (body: unknown) => void;
};

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  const gate = await requireCaller(req, ['teacher', 'admin']);
  if ('error' in gate) {
    res.status(gate.status).json({ error: gate.error });
    return;
  }
  const { caller, admin } = gate;

  const name = (req.body?.name ?? '').trim();
  if (!name) {
    res.status(400).json({ error: '학생 이름을 입력해주세요.' });
    return;
  }

  // username 충돌 시 몇 번 재시도
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const username = generateUsername();
    const password = generatePassword();
    const email = `${username}@${STUDENT_EMAIL_DOMAIN}`;

    const { data: created, error: authError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, role: 'student' },
    });
    if (authError) {
      if (/already|registered|exists/i.test(authError.message)) continue;
      res.status(500).json({ error: `계정 생성 실패: ${authError.message}` });
      return;
    }

    const p = req.body?.profile ?? {};
    const optional: Record<string, unknown> = {};
    if (p.schoolLevel && ['초', '중', '고'].includes(p.schoolLevel))
      optional.school_level = p.schoolLevel;
    if (typeof p.grade === 'number' && p.grade >= 1 && p.grade <= 6)
      optional.grade = p.grade;
    if (p.studentPhone?.trim()) optional.student_phone = p.studentPhone.trim();
    if (p.parentPhone?.trim()) optional.parent_phone = p.parentPhone.trim();
    if (p.school?.trim()) optional.school = p.school.trim();
    if (p.startDate?.trim()) optional.start_date = p.startDate.trim();
    if (p.address?.trim()) optional.address = p.address.trim();
    if (p.notes?.trim()) optional.notes = p.notes.trim();
    if (typeof p.hasPen === 'boolean') optional.has_pen = p.hasPen;

    const { error: profileError } = await admin.from('sp_profiles').insert({
      id: created.user.id,
      role: 'student',
      name,
      username,
      teacher_id: caller.role === 'teacher' ? caller.id : null,
      must_change_password: true,
      temp_password: password,
      ...optional,
    });
    if (profileError) {
      await admin.auth.admin.deleteUser(created.user.id);
      res.status(500).json({ error: `프로필 생성 실패: ${profileError.message}` });
      return;
    }

    res.status(200).json({ id: created.user.id, name, username, password });
    return;
  }
  res.status(500).json({ error: '아이디 생성에 실패했습니다. 다시 시도해주세요.' });
}
