/**
 * 필기 데이터/썸네일 다운로드 — 스토리지 RLS 와 무관하게 코드에서 권한을 검증하고
 * 서비스 키로 읽어 내려준다. (선생님이 스토리지 정책에서 거부되는 문제의 안전한 우회)
 * GET /api/strokes?path=<student_id>/<file> — 호출자가 그 파일이 걸린 제출의
 * 학생 본인/담당 선생님/관리자일 때만 200.
 */
import { requireCaller } from './_lib.js';

type Req = {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
};
type Res = {
  status: (code: number) => Res;
  setHeader: (k: string, v: string) => void;
  json: (body: unknown) => void;
  send: (body: unknown) => void;
};

export default async function handler(req: Req, res: Res) {
  const gate = await requireCaller(req);
  if ('error' in gate) {
    res.status(gate.status).json({ error: gate.error });
    return;
  }
  const { caller, admin } = gate;

  const url = new URL(req.url ?? '/', 'http://local');
  const path = url.searchParams.get('path') ?? '';

  // 모범 풀이·답안(solutions/) — 학생 파일과 달리 제출에 걸려 있지 않다.
  // 교사·관리자면 코드에서 바로 허용 (스토리지 정책과 무관한 안전 우회 —
  // 2026-09-02: 정책 적용 후에도 일부 브라우저에서 직접 다운로드가 비는
  // 사례가 있어 필기와 같은 서버 경유 폴백을 둔다).
  if (/^solutions\/\d+(?:\.json|\.paper-scan\.json|\/p\d+\.png)$/.test(path)) {
    if (caller.role !== 'teacher' && caller.role !== 'admin') {
      res.status(403).json({ error: '해설을 볼 권한이 없습니다.' });
      return;
    }
    const { data, error } = await admin.storage.from('sp-strokes').download(path);
    if (error || !data) {
      res.status(404).json({ error: `해설 다운로드 실패: ${error?.message ?? '없음'}` });
      return;
    }
    const buf = Buffer.from(await data.arrayBuffer());
    res.setHeader(
      'content-type',
      path.endsWith('.png') ? 'image/png' : 'application/json',
    );
    res.setHeader('cache-control', 'private, max-age=60');
    res.status(200).send(buf);
    return;
  }

  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(json\.gz|png)$/.test(path)) {
    res.status(400).json({ error: '잘못된 path 형식입니다.' });
    return;
  }

  // 이 파일이 걸린 제출을 찾아 권한 확인
  const { data: sub } = await admin
    .from('sp_submissions')
    .select('student_id, teacher_id')
    .or(`strokes_path.eq.${path},thumbnail_path.eq.${path}`)
    .maybeSingle();
  if (!sub) {
    res.status(404).json({ error: '해당 파일이 걸린 제출을 찾을 수 없습니다.' });
    return;
  }
  const allowed =
    caller.role === 'admin' ||
    caller.id === sub.student_id ||
    caller.id === sub.teacher_id;
  if (!allowed) {
    res.status(403).json({ error: '이 필기를 볼 권한이 없습니다.' });
    return;
  }

  const { data, error } = await admin.storage.from('sp-strokes').download(path);
  if (error || !data) {
    res.status(404).json({ error: `파일 다운로드 실패: ${error?.message ?? '없음'}` });
    return;
  }
  const buf = Buffer.from(await data.arrayBuffer());
  res.setHeader(
    'content-type',
    path.endsWith('.png') ? 'image/png' : 'application/gzip',
  );
  res.setHeader('cache-control', 'private, max-age=600');
  res.status(200).send(buf);
}
