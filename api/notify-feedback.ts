/**
 * 피드백 공개 알림 생성 — 선생님이 제출을 공개할 때 호출.
 * 호출자가 그 제출의 담당 선생님(또는 admin)인지 검증한 뒤 서비스키로
 * 학생 대상 알림을 만든다. (테이블 RLS insert 대신 서버 검증 방식)
 * POST { submissionId }
 */
import { requireCaller } from './_lib.js';

type Req = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: { submissionId?: string };
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

  const submissionId = req.body?.submissionId;
  if (!submissionId) {
    res.status(400).json({ error: 'submissionId가 필요합니다.' });
    return;
  }

  const { data: sub } = await admin
    .from('sp_submissions')
    .select('id, student_id, teacher_id, title')
    .eq('id', submissionId)
    .maybeSingle();
  if (!sub) {
    res.status(404).json({ error: '제출을 찾을 수 없습니다.' });
    return;
  }
  if (caller.role === 'teacher' && sub.teacher_id !== caller.id) {
    res.status(403).json({ error: '내 학생의 제출만 알림을 보낼 수 있습니다.' });
    return;
  }

  // 같은 제출의 기존 미읽음 알림을 지우고 새로 넣어 중복 방지
  await admin
    .from('sp_notifications')
    .delete()
    .eq('submission_id', submissionId)
    .eq('read', false);

  const { error } = await admin.from('sp_notifications').insert({
    user_id: sub.student_id,
    type: 'feedback',
    submission_id: submissionId,
    title: '선생님 피드백이 도착했어요',
    body: `"${sub.title}" 에 대한 피드백을 확인해보세요.`,
  });
  if (error) {
    res.status(500).json({ error: `알림 생성 실패: ${error.message}` });
    return;
  }
  res.status(200).json({ ok: true });
}
