import { generatePassword, requireCaller } from './_lib.js';

type Req = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: { studentId?: string };
};
type Res = { status: (code: number) => Res; json: (body: unknown) => void };

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
  const studentId = req.body?.studentId;
  if (!studentId) {
    res.status(400).json({ error: 'studentId가 필요합니다.' });
    return;
  }

  const { data: student } = await admin
    .from('sp_profiles')
    .select('id, role, teacher_id, username')
    .eq('id', studentId)
    .maybeSingle();
  if (!student || student.role !== 'student') {
    res.status(404).json({ error: '학생을 찾을 수 없습니다.' });
    return;
  }
  if (caller.role === 'teacher' && student.teacher_id !== caller.id) {
    res.status(403).json({ error: '내 학생만 재발급할 수 있습니다.' });
    return;
  }

  const password = generatePassword();
  const { error: authError } = await admin.auth.admin.updateUserById(studentId, {
    password,
  });
  if (authError) {
    res.status(500).json({ error: `비밀번호 변경 실패: ${authError.message}` });
    return;
  }
  await admin
    .from('sp_profiles')
    .update({ temp_password: password, must_change_password: true })
    .eq('id', studentId);

  res.status(200).json({ username: student.username, password });
}
