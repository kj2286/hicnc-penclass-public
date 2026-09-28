import { requireCaller } from './_lib.js';

/**
 * 학생 관리 액션 — POST { action, studentId, profile? }
 *
 * - trash   : deleted_at = now()  (퇴원 처리 — 되돌릴 수 있음)
 * - restore : deleted_at = null   (재원 복귀)
 * - purge   : 영구 삭제 — sp-strokes 스토리지의 학생 폴더를 지운 뒤
 *             auth.users 를 삭제 (FK cascade 로 프로필·제출·피드백 제거)
 * - update  : 프로필 수정 (이름·학년·연락처·학교·수업시작일·주소·특이사항·펜보유)
 *
 * RLS 를 우회하는 서비스키 경로이므로 반드시 담당 선생님(또는 admin)인지
 * 검증한 뒤 수행한다. (create-student.ts 와 같은 보안 모델)
 */
type Req = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
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

  const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as {
    action?: string;
    studentId?: string;
    profile?: Record<string, unknown>;
  };
  const action = body?.action;
  const studentId = body?.studentId;
  if (
    !studentId ||
    !['trash', 'restore', 'purge', 'update'].includes(action ?? '')
  ) {
    res
      .status(400)
      .json({ error: 'action(trash|restore|purge|update) 과 studentId 가 필요합니다.' });
    return;
  }

  // 대상 검증: 학생이며, 호출자가 담당 선생님(또는 admin)인지
  const { data: student } = await admin
    .from('sp_profiles')
    .select('id, role, name, teacher_id, deleted_at')
    .eq('id', studentId)
    .maybeSingle();
  if (!student || student.role !== 'student') {
    res.status(404).json({ error: '학생을 찾을 수 없습니다.' });
    return;
  }
  if (caller.role !== 'admin' && student.teacher_id !== caller.id) {
    res.status(403).json({ error: '담당 학생이 아닙니다.' });
    return;
  }

  try {
    if (action === 'update') {
      const p = body.profile ?? {};
      const patch: Record<string, unknown> = {};
      if (typeof p.name === 'string' && p.name.trim()) patch.name = p.name.trim();
      if (p.schoolLevel === null) patch.school_level = null;
      else if (
        typeof p.schoolLevel === 'string' &&
        ['초', '중', '고'].includes(p.schoolLevel)
      )
        patch.school_level = p.schoolLevel;
      if (p.grade === null) patch.grade = null;
      else if (typeof p.grade === 'number' && p.grade >= 1 && p.grade <= 6)
        patch.grade = p.grade;
      for (const [key, col] of [
        ['studentPhone', 'student_phone'],
        ['parentPhone', 'parent_phone'],
        ['school', 'school'],
        ['startDate', 'start_date'],
        ['address', 'address'],
        ['notes', 'notes'],
      ] as const) {
        const v = p[key];
        if (typeof v === 'string') patch[col] = v.trim() || null;
      }
      if (typeof p.hasPen === 'boolean') patch.has_pen = p.hasPen;
      if (Object.keys(patch).length === 0) {
        res.status(400).json({ error: '수정할 항목이 없습니다.' });
        return;
      }
      const { error } = await admin
        .from('sp_profiles')
        .update(patch)
        .eq('id', studentId);
      if (error) throw new Error(error.message);
      res.status(200).json({ ok: true, action: 'update', name: student.name });
      return;
    }

    if (action === 'trash' || action === 'restore') {
      const { error } = await admin
        .from('sp_profiles')
        .update({ deleted_at: action === 'trash' ? new Date().toISOString() : null })
        .eq('id', studentId);
      if (error) throw new Error(error.message);
      res.status(200).json({ ok: true, action, name: student.name });
      return;
    }

    // purge — 스토리지 정리 후 auth 유저 삭제 (cascade)
    const { data: objects } = await admin.storage
      .from('sp-strokes')
      .list(studentId, { limit: 1000 });
    if (objects && objects.length > 0) {
      const paths = objects.map((o) => `${studentId}/${o.name}`);
      await admin.storage.from('sp-strokes').remove(paths);
    }
    const { error: delErr } = await admin.auth.admin.deleteUser(studentId);
    if (delErr) throw new Error(delErr.message);
    res.status(200).json({ ok: true, action: 'purge', name: student.name });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : '처리에 실패했습니다.',
    });
  }
}
