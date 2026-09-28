import { requireCaller } from './_lib.js';

type Req = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};
type Res = { status: (code: number) => Res; json: (body: unknown) => void };

/** 이전 앱의 요청을 명시적으로 종료한다. 기존 계정과 비밀번호는 바꾸지 않는다. */
export async function resetStudentPassword(req: Req, res: Res, gateCaller = requireCaller) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  const gate = await gateCaller(req, ['teacher', 'admin']);
  if ('error' in gate) {
    res.status(gate.status).json({ error: gate.error });
    return;
  }
  res.status(410).json({ error: '학생 로그인 계정은 사용하지 않습니다.' });
}

export default function handler(req: Req, res: Res) {
  return resetStudentPassword(req, res);
}
