import assert from 'node:assert/strict';
import { requireCaller } from '../api/_lib';
import { isStaffRole } from '../shared/staff-access';

const priorFetch = globalThis.fetch;
const previousUrl = process.env.SUPABASE_URL;
const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.SUPABASE_URL = 'https://staff-access-test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
let role: unknown = 'student';
let authValid = true;
let calls = 0;
let passed = 0;
async function test(name: string, run: () => Promise<void> | void) {
  await run(); passed++; console.log(`PASS ${name}`);
}
globalThis.fetch = async input => {
  calls++;
  const url = new URL(input instanceof Request ? input.url : String(input));
  assert.equal(url.hostname, 'staff-access-test.invalid');
  if (url.pathname === '/auth/v1/user') {
    return new Response(JSON.stringify(authValid
      ? { id: '00000000-0000-4000-8000-000000000001' }
      : { message: 'Invalid token' }), { status: authValid ? 200 : 401, headers: { 'content-type': 'application/json' } });
  }
  if (url.pathname === '/rest/v1/sp_profiles') {
    return new Response(JSON.stringify({ id: '00000000-0000-4000-8000-000000000001', role, name: '검사 사용자' }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  }
  throw new Error(`Unexpected mocked path ${url.pathname}`);
};
const req = { headers: { authorization: 'Bearer test-access-token' } };
try {
  await test('교사·관리자만 로그인 역할로 인정한다', () => {
    assert.equal(isStaffRole('teacher'), true);
    assert.equal(isStaffRole('admin'), true);
    for (const value of ['student', '', null, undefined, 'owner']) assert.equal(isStaffRole(value), false);
  });
  await test('인증 없이 서버나 DB를 조회하지 않는다', async () => {
    calls = 0;
    const result = await requireCaller({ headers: {} });
    assert.ok('error' in result); assert.equal(result.status, 401); assert.equal(calls, 0);
  });
  await test('기존 학생 JWT도 기본 API 관문에서 거부한다', async () => {
    role = 'student';
    const result = await requireCaller(req);
    assert.ok('error' in result); assert.equal(result.status, 403);
  });
  await test('옛 학생 허용 역할 목록이 남아도 학생을 거부한다', async () => {
    const result = await requireCaller(req, ['teacher', 'student']);
    assert.ok('error' in result); assert.equal(result.status, 403);
  });
  await test('교사·관리자는 기존 역할 제한을 그대로 따른다', async () => {
    for (const allowed of ['teacher', 'admin'] as const) {
      role = allowed;
      const result = await requireCaller(req, ['teacher', 'admin']);
      assert.ok('caller' in result); assert.equal(result.caller.role, allowed);
    }
    role = 'teacher';
    const denied = await requireCaller(req, ['admin']);
    assert.ok('error' in denied); assert.equal(denied.status, 403);
  });
  await test('잘못된 토큰과 알 수 없는 역할은 거부한다', async () => {
    authValid = false;
    let result = await requireCaller(req);
    assert.ok('error' in result); assert.equal(result.status, 401);
    authValid = true; role = 'unknown';
    result = await requireCaller(req);
    assert.ok('error' in result); assert.equal(result.status, 403);
  });
} finally {
  globalThis.fetch = priorFetch;
  if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
  if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
}
console.log(`${passed} PASS / 0 FAIL (가상 인증 응답, 실제 서버·DB 연결 없음)`);
