import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createStudent } from '../api/create-student.ts';
import { studentTrash } from '../api/student-trash.ts';
import { resetStudentPassword } from '../api/reset-student-password.ts';
import type { requireCaller } from '../api/_lib.ts';

const TEACHER = '11111111-1111-4111-8111-111111111111';
const STUDENT = '22222222-2222-4222-8222-222222222222';
class Backend {
  caller = { id: TEACHER, role: 'teacher' as 'teacher' | 'admin', name: '선생님' };
  student: Record<string, unknown> | null = { id: STUDENT, name: '학생', role: 'student', teacher_id: TEACHER, auth_user_id: null };
  gateError: { status: number; error: string } | null = null;
  insertError: { message: string; code: string } | null = null;
  readError: { message: string } | null = null;
  deleteError: { message: string } | null = null;
  storageError: 'list' | 'remove' | null = null;
  inserts: Record<string, unknown>[] = [];
  deletions: string[] = [];
  updates: Record<string, unknown>[] = [];
  updateIds: string[] = [];
  removed: string[] = [];
  rows = new Map<string, { id: string | null; name: string }[]>();
  authMutations = 0;
  gateCalls = 0;
  async failAuth() { this.authMutations += 1; throw new Error('Auth mutations must never run'); }
  client = {
    auth: { admin: {
      createUser: () => this.failAuth(), deleteUser: () => this.failAuth(), updateUserById: () => this.failAuth(),
    } },
    from: (table: string) => {
      assert.equal(table, 'sp_profiles');
      return {
        insert: async (row: Record<string, unknown>) => { this.inserts.push(row); return { error: this.insertError }; },
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: this.student, error: this.readError }) }) }),
        delete: () => ({ eq: async (column: string, id: string) => {
          assert.equal(column, 'id'); this.deletions.push(id); return { error: this.deleteError };
        } }),
        update: (row: Record<string, unknown>) => ({ eq: async (column: string, id: string) => {
          assert.equal(column, 'id'); this.updateIds.push(id); this.updates.push(row); return { error: null };
        } }),
      };
    },
    storage: { from: (bucket: string) => {
      assert.equal(bucket, 'sp-strokes');
      return {
        list: async (prefix: string, options: { offset: number; limit: number }) => ({
          data: (this.rows.get(prefix) ?? []).slice(options.offset, options.offset + options.limit),
          error: this.storageError === 'list' ? { message: 'list failure' } : null,
        }),
        remove: async (paths: string[]) => {
          this.removed.push(...paths);
          return { error: this.storageError === 'remove' ? { message: 'remove failure' } : null };
        },
      };
    } },
  };
  gate: typeof requireCaller = async (_req, roles) => {
    this.gateCalls += 1;
    assert.deepEqual(roles, ['teacher', 'admin']);
    return this.gateError ?? { caller: this.caller, admin: this.client as unknown as SupabaseClient };
  };
}

type Endpoint = typeof createStudent;
async function request(endpoint: Endpoint, backend: Backend, body: unknown, method = 'POST') {
  let status = 0; let payload: unknown;
  const response = {
    status(code: number) { status = code; return response; },
    json(value: unknown) { payload = value; },
  };
  await endpoint({ method, body, headers: {} }, response, backend.gate);
  return { status, payload };
}

test('student registration saves only a profile and never creates credentials or Auth users', async () => {
  const backend = new Backend();
  const result = await request(createStudent, backend, {
    name: '  학생  ', role: 'admin', id: TEACHER, auth_user_id: TEACHER, username: 'supplied', password: 'supplied',
    profile: { schoolLevel: '중', grade: 2, studentPhone: ' 010-0000-0000 ', notes: ' 학습 메모 ', hasPen: true, teacher_id: STUDENT },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(Object.keys(result.payload as object).sort(), ['id', 'name']);
  const row = backend.inserts[0];
  assert.match(String(row.id), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(row.id, TEACHER);
  assert.deepEqual(row, {
    id: row.id, auth_user_id: null, role: 'student', name: '학생', username: null, teacher_id: TEACHER,
    must_change_password: false, temp_password: null,
    school_level: '중', grade: 2, student_phone: '010-0000-0000', notes: '학습 메모', has_pen: true,
  });
  assert.deepEqual(result.payload, { id: row.id, name: '학생' });
  assert.equal(backend.authMutations, 0);
});

test('same-name students are separate records, including administrator-created students', async () => {
  const backend = new Backend(); backend.caller.role = 'admin';
  await request(createStudent, backend, { name: '동명이인' });
  await request(createStudent, backend, JSON.stringify({ name: '동명이인' }));
  assert.equal(backend.inserts.length, 2);
  assert.notEqual(backend.inserts[0].id, backend.inserts[1].id);
  assert.equal(backend.inserts[0].teacher_id, null);
  assert.equal(backend.authMutations, 0);
});

test('malformed input, unauthorized callers, and unsupported methods never write', async () => {
  const badBodies = [null, [], '{', {}, { name: 5 }, { name: ' ' }, { name: 'a'.repeat(101) },
    { name: '학생', profile: [] }, { name: '학생', profile: { grade: 1.5 } },
    { name: '학생', profile: { schoolLevel: '대학' } }, { name: '학생', profile: { studentPhone: 123 } },
    { name: '학생', profile: { startDate: '2026-02-30' } }, { name: '학생', profile: { hasPen: 'yes' } }];
  for (const body of badBodies) {
    const backend = new Backend();
    assert.equal((await request(createStudent, backend, body)).status, 400);
    assert.equal(backend.inserts.length, 0); assert.equal(backend.authMutations, 0);
  }
  for (const endpoint of [createStudent, studentTrash, resetStudentPassword]) {
    const backend = new Backend();
    assert.equal((await request(endpoint, backend, {}, 'GET')).status, 405);
    assert.equal(backend.gateCalls, 0);
    for (const status of [401, 403]) {
      backend.gateError = { status, error: 'denied' };
      assert.equal((await request(endpoint, backend, { name: '학생', action: 'purge', studentId: STUDENT })).status, status);
    }
    assert.equal(backend.inserts.length + backend.deletions.length + backend.removed.length, 0);
    assert.equal(backend.authMutations, 0);
  }
});

test('schema or database failure is reported without Auth fallback or raw server details', async () => {
  const backend = new Backend(); backend.insertError = { code: '23503', message: 'private database detail' };
  const result = await request(createStudent, backend, { name: '학생' });
  assert.equal(result.status, 500);
  assert.equal(JSON.stringify(result).includes('private database detail'), false);
  assert.equal(backend.inserts.length, 1); assert.equal(backend.authMutations, 0);
});

test('retired password endpoint returns 410 without changing old credentials or Auth', async () => {
  const backend = new Backend();
  assert.equal((await request(resetStudentPassword, backend, { studentId: STUDENT })).status, 410);
  assert.equal(backend.updates.length + backend.inserts.length + backend.deletions.length, 0);
  assert.equal(backend.authMutations, 0);
});

test('profile update, trash, and restore keep the original student ID without touching Auth', async () => {
  const backend = new Backend(); backend.student!.auth_user_id = STUDENT;
  for (const action of ['update', 'trash', 'restore']) {
    const result = await request(studentTrash, backend, { action, studentId: STUDENT,
      profile: { name: '수정한 학생', grade: 3, username: 'ignore', auth_user_id: TEACHER } });
    assert.equal(result.status, 200);
  }
  assert.deepEqual(backend.updateIds, [STUDENT, STUDENT, STUDENT]);
  assert.deepEqual(backend.updates[0], { name: '수정한 학생', grade: 3 });
  assert.ok(typeof backend.updates[1].deleted_at === 'string');
  assert.deepEqual(backend.updates[2], { deleted_at: null });
  assert.equal(backend.authMutations + backend.deletions.length + backend.removed.length, 0);
});

test('purge deletes new and legacy student records while preserving every Auth account', async () => {
  for (const authId of [null, STUDENT]) {
    const backend = new Backend(); backend.student!.auth_user_id = authId;
    backend.rows.set(STUDENT, [{ id: 'file', name: 'writing.json.gz' }, { id: null, name: 'thumbs' }]);
    backend.rows.set(`${STUDENT}/thumbs`, [{ id: 'nested', name: 'page.png' }]);
    const result = await request(studentTrash, backend, { action: 'purge', studentId: STUDENT });
    assert.equal(result.status, 200);
    assert.deepEqual(backend.deletions, [STUDENT]);
    assert.deepEqual(backend.removed.sort(), [`${STUDENT}/writing.json.gz`, `${STUDENT}/thumbs/page.png`].sort());
    assert.equal(backend.authMutations, 0);
  }
});

test('purge removes all pages of storage files and does not stop at 1000 files', async () => {
  const backend = new Backend();
  backend.rows.set(STUDENT, Array.from({ length: 1001 }, (_, index) => ({ id: String(index), name: `${index}.json.gz` })));
  assert.equal((await request(studentTrash, backend, { action: 'purge', studentId: STUDENT })).status, 200);
  assert.equal(new Set(backend.removed).size, 1001); assert.deepEqual(backend.deletions, [STUDENT]);
});

test('purge refuses another teacher and preserves records when storage or DB lookup fails', async () => {
  for (const scenario of ['foreign', 'not-student', 'read', 'list', 'remove', 'delete'] as const) {
    const backend = new Backend();
    if (scenario === 'foreign') backend.student!.teacher_id = STUDENT;
    if (scenario === 'not-student') backend.student!.role = 'teacher';
    if (scenario === 'read') backend.readError = { message: 'failed' };
    if (scenario === 'list' || scenario === 'remove') backend.storageError = scenario;
    if (scenario === 'delete') backend.deleteError = { message: 'failed' };
    backend.rows.set(STUDENT, [{ id: 'file', name: 'writing.json.gz' }]);
    const result = await request(studentTrash, backend, { action: 'purge', studentId: STUDENT });
    assert.equal(result.status, scenario === 'foreign' ? 403 : scenario === 'not-student' ? 404 : 500);
    assert.equal(backend.authMutations, 0);
    if (scenario !== 'delete') assert.equal(backend.deletions.length, 0);
    if (scenario === 'foreign' || scenario === 'not-student' || scenario === 'read') assert.equal(backend.removed.length, 0);
  }
});

test('migration preserves existing IDs and credentials while restricting student sessions to this app', () => {
  const sql = readFileSync(new URL('../supabase/029_student_records_without_auth.sql', import.meta.url), 'utf8');
  const statements = sql.replace(/--[^\n]*/g, '');
  assert.match(statements, /^\s*begin;/); assert.match(statements, /commit;\s*$/);
  assert.doesNotMatch(statements, /(?:delete\s+from|update|alter\s+table)\s+auth\./i);
  assert.doesNotMatch(statements, /update\s+public\.sp_profiles\s+set\s+(?:id|username|temp_password)\s*=/i);
  assert.match(statements, /update public\.sp_profiles set auth_user_id = id where auth_user_id is null/);
  assert.match(statements, /foreign key \(auth_user_id\) references auth\.users\(id\) on delete cascade/);
  assert.match(statements, /new\.role in \('teacher', 'admin'\)/);
  assert.match(statements, /new\.auth_user_id := new\.id/);
  assert.match(statements, /username is null and temp_password is null and must_change_password = false/);
  assert.match(statements, /as restrictive for all to authenticated/);
  assert.doesNotMatch(statements, /is distinct from ''student''/);
  assert.match(statements, /using \(coalesce\(public\.sp_role\(\) in \(''teacher'', ''admin''\), false\)\)/);
  assert.match(statements, /bucket_id not in \('sp-strokes', 'sp-brand'\)/);
  assert.match(statements, /coalesce\(public\.sp_role\(\) in \('teacher', 'admin'\), false\)/);
  const tables = new Set([...readFileSync(new URL('../supabase/ALL_IN_ONE.sql', import.meta.url), 'utf8')
    .matchAll(/create table if not exists public\.(sp_[a-z_]+)/g)].map(match => match[1]));
  const policyBlock = statements.split('do $sp_disable_student_access$')[1].split('$sp_disable_student_access$;')[0];
  for (const table of tables) assert.ok(policyBlock.includes(`'${table}'`), `Student RLS guard missing: ${table}`);
  const updateGrant = statements.match(/grant update \(([^)]+)\) on table public\.sp_profiles to authenticated/s)![1];
  assert.doesNotMatch(updateGrant, /\bauth_user_id\b|\brole\b|\bteacher_id\b/);
});
