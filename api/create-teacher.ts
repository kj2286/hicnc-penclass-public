import { requireCaller } from './_lib.js';

type Req = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: { name?: string; email?: string; password?: string };
};
type Res = { status: (code: number) => Res; json: (body: unknown) => void };

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  const gate = await requireCaller(req, ['admin']);
  if ('error' in gate) {
    res.status(gate.status).json({ error: gate.error });
    return;
  }
  const { admin } = gate;

  const name = (req.body?.name ?? '').trim();
  const email = (req.body?.email ?? '').trim().toLowerCase();
  const password = req.body?.password ?? '';
  if (!name || !email || password.length < 6) {
    res
      .status(400)
      .json({ error: '이름/이메일/비밀번호(6자 이상)를 확인해주세요.' });
    return;
  }

  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, role: 'teacher' },
  });
  if (authError) {
    res.status(500).json({ error: `계정 생성 실패: ${authError.message}` });
    return;
  }
  const { error: profileError } = await admin.from('sp_profiles').insert({
    id: created.user.id,
    role: 'teacher',
    name,
    username: email,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    res.status(500).json({ error: `프로필 생성 실패: ${profileError.message}` });
    return;
  }
  res.status(200).json({ id: created.user.id });
}
