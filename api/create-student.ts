import { randomUUID } from 'node:crypto';
import { requireCaller } from './_lib.js';

/** 학생 기록에 저장할 선택 정보. 로그인 계정은 만들지 않는다. */
export type StudentProfileInput = {
  schoolLevel?: string;
  grade?: number;
  studentPhone?: string;
  parentPhone?: string;
  school?: string;
  startDate?: string;
  address?: string;
  notes?: string;
  hasPen?: boolean;
};

type Req = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};
type Res = {
  status: (code: number) => Res;
  json: (body: unknown) => void;
};

function studentInput(body: unknown): { name: string; optional: Record<string, unknown> } {
  const value = typeof body === 'string' ? JSON.parse(body) : body;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('학생 정보를 확인해주세요.');
  }
  const { name, profile } = value as Record<string, unknown>;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) {
    throw new Error('학생 이름을 1~100자로 입력해주세요.');
  }
  if (profile != null && (typeof profile !== 'object' || Array.isArray(profile))) {
    throw new Error('학생 정보를 확인해주세요.');
  }
  const p = (profile ?? {}) as Record<string, unknown>;
  const optional: Record<string, unknown> = {};
  if (p.schoolLevel != null && p.schoolLevel !== '') {
    if (typeof p.schoolLevel !== 'string' || !['초', '중', '고'].includes(p.schoolLevel)) {
      throw new Error('학교급을 확인해주세요.');
    }
    optional.school_level = p.schoolLevel;
  }
  if (p.grade != null) {
    if (typeof p.grade !== 'number' || !Number.isInteger(p.grade) || p.grade < 1 || p.grade > 6) {
      throw new Error('학년을 확인해주세요.');
    }
    optional.grade = p.grade;
  }
  for (const [key, column, limit] of [
    ['studentPhone', 'student_phone', 50],
    ['parentPhone', 'parent_phone', 50],
    ['school', 'school', 200],
    ['startDate', 'start_date', 10],
    ['address', 'address', 500],
    ['notes', 'notes', 5000],
  ] as const) {
    const input = p[key];
    if (input == null || input === '') continue;
    if (typeof input !== 'string' || input.trim().length > limit) {
      throw new Error('학생 정보의 입력 형식과 길이를 확인해주세요.');
    }
    const text = input.trim();
    if (!text) continue;
    if (key === 'startDate' && (!/^\d{4}-\d{2}-\d{2}$/.test(text)
      || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString() !== `${text}T00:00:00.000Z`)) {
      throw new Error('수업 시작일을 확인해주세요.');
    }
    optional[column] = text;
  }
  if (p.hasPen != null) {
    if (typeof p.hasPen !== 'boolean') throw new Error('펜 보유 여부를 확인해주세요.');
    optional.has_pen = p.hasPen;
  }
  return { name: name.trim(), optional };
}

export async function createStudent(req: Req, res: Res, gateCaller = requireCaller) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  const gate = await gateCaller(req, ['teacher', 'admin']);
  if ('error' in gate) {
    res.status(gate.status).json({ error: gate.error });
    return;
  }

  let input: ReturnType<typeof studentInput>;
  try {
    input = studentInput(req.body);
  } catch (error) {
    res.status(400).json({ error: error instanceof SyntaxError
      ? '학생 정보를 확인해주세요.'
      : error instanceof Error ? error.message : '학생 정보를 확인해주세요.' });
    return;
  }

  const { caller, admin } = gate;
  const id = randomUUID();
  const { name, optional } = input;
  // 029 마이그레이션이 먼저 필요하다. 적용 전 실패해도 Auth 계정 생성으로 우회하지 않는다.
  const { error } = await admin.from('sp_profiles').insert({
    id,
    auth_user_id: null,
    role: 'student',
    name,
    username: null,
    teacher_id: caller.role === 'teacher' ? caller.id : null,
    must_change_password: false,
    temp_password: null,
    ...optional,
  });
  if (error) {
    const schemaNotReady = ['PGRST204', '42703', '23503'].includes(error.code);
    res.status(500).json(schemaNotReady
      ? { code: 'STUDENT_SCHEMA_NOT_READY', error: '학생 등록에 필요한 DB 업데이트가 아직 적용되지 않았습니다. 관리자에게 문의해주세요.' }
      : { error: '학생 정보를 저장하지 못했습니다. 다시 시도해주세요.' });
    return;
  }
  res.status(200).json({ id, name });
}

export default function handler(req: Req, res: Res) {
  return createStudent(req, res);
}
