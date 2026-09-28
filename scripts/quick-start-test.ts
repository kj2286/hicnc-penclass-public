import assert from 'node:assert/strict';
import test from 'node:test';
import type { createClient } from '@supabase/supabase-js';
import {
  createCreationLimiter, quickStart, quickStartCredentials, quickStartDependencies,
  startQuickClassroom, type QuickProfile, type QuickStartDependencies,
} from '../api/_quick-start.ts';

const SECRET_A = 'a'.repeat(64);
const SECRET_B = 'b'.repeat(64);
type User = { id: string; email: string; app_metadata: Record<string, unknown> };
type ErrorLike = { code?: string; status?: number; message?: string };

class FakeBackend {
  users = new Map<string, { user: User; password: string }>();
  profiles = new Map<string, QuickProfile & Record<string, unknown>>();
  academies = new Map<string, { id: string; name: string }>();
  counts = { signIn: 0, create: 0, profileInsert: 0, academyInsert: 0, reads: 0 };
  signInError: ErrorLike | null = null;
  createError: ErrorLike | null = null;
  readError: ErrorLike | null = null;
  profileInsertError: ErrorLike | null = null;
  academyInsertError: ErrorLike | null = null;
  thrown: Error | null = null;
  creationAllowed = true;
  tamperSessionId = false;
  lastCreation: unknown;
  deps: QuickStartDependencies = {
    allowCreation: () => this.creationAllowed,
    signIn: async ({ email, password }) => {
      this.counts.signIn += 1;
      if (this.thrown) throw this.thrown;
      if (this.signInError) return { user: null, session: null, error: this.signInError };
      const record = this.users.get(email);
      if (!record || record.password !== password) {
        return { user: null, session: null, error: { code: 'invalid_credentials', status: 400 } };
      }
      const user = structuredClone(record.user);
      return { user, error: null, session: {
        user: { ...user, id: this.tamperSessionId ? '00000000-0000-4000-8000-999999999999' : user.id },
        access_token: `access-${user.id}`, refresh_token: `refresh-${user.id}`, expires_at: 4102444800,
      } };
    },
    createUser: async input => {
      this.counts.create += 1;
      this.lastCreation = input;
      if (this.createError) return { data: null, error: this.createError };
      if (this.users.has(input.email)) return { data: null, error: { code: 'email_exists', status: 422 } };
      const user = { id: `00000000-0000-4000-8000-${String(this.users.size + 1).padStart(12, '0')}`,
        email: input.email, app_metadata: input.app_metadata };
      this.users.set(input.email, { user, password: input.password });
      return { data: structuredClone(user), error: null };
    },
    findProfile: async id => {
      this.counts.reads += 1;
      return { data: this.profiles.get(id) ?? null, error: this.readError };
    },
    findAcademy: async id => {
      this.counts.reads += 1;
      return { data: this.academies.get(id) ?? null, error: this.readError };
    },
    insertProfile: async row => {
      this.counts.profileInsert += 1;
      if (this.profileInsertError) return { error: this.profileInsertError };
      if (this.profiles.has(row.id)) return { error: { code: '23505' } };
      this.profiles.set(row.id, { ...row });
      return { error: null };
    },
    insertAcademy: async row => {
      this.counts.academyInsert += 1;
      if (this.academyInsertError) return { error: this.academyInsertError };
      if (this.academies.has(row.id)) return { error: { code: '23505' } };
      this.academies.set(row.id, { ...row });
      return { error: null };
    },
  };
}

async function request(backend: FakeBackend, body: Record<string, unknown>, method = 'POST') {
  let status = 0;
  let payload: unknown;
  const headers: Record<string, string> = {};
  const res = {
    setHeader(name: string, value: string) { headers[name] = value; },
    status(value: number) { status = value; return res; },
    json(value: unknown) { payload = value; },
  };
  await quickStart({ method, body }, res, () => backend.deps);
  return { status, payload, headers };
}

test('device secrets derive separate deterministic reserved emails and strong passwords', () => {
  const a = quickStartCredentials(SECRET_A);
  assert.deepEqual(a, quickStartCredentials(SECRET_A));
  assert.notDeepEqual(a, quickStartCredentials(SECRET_B));
  assert.match(a.email, /^pc-[a-f0-9]{48}@hicnc-penclass\.invalid$/);
  assert.ok(a.email.split('@')[0].length <= 64);
  assert.ok(a.password.length >= 32 && a.password.length <= 72);
  assert.match(a.password, /[A-Z]/); assert.match(a.password, /[a-z]/); assert.match(a.password, /[^a-z0-9]/i);
  assert.notEqual(a.password, SECRET_A);
});

test('invalid secret/method fails with no auth/DB work and no-store', async () => {
  const backend = new FakeBackend();
  for (const invalid of [undefined, '', 'a'.repeat(63), 'A'.repeat(64), 'g'.repeat(64), 1, [], {}]) {
    const result = await request(backend, { deviceSecret: invalid });
    assert.equal(result.status, 400);
    assert.equal(result.headers['Cache-Control'], 'no-store');
  }
  assert.equal((await request(backend, { deviceSecret: SECRET_A }, 'GET')).status, 405);
  assert.deepEqual(backend.counts, { signIn: 0, create: 0, profileInsert: 0, academyInsert: 0, reads: 0 });
});

test('first use creates one private identity/classroom/profile and ignores role/id overrides', async () => {
  const backend = new FakeBackend();
  const result = await request(backend, { deviceSecret: SECRET_A, role: 'admin', userId: 'victim', academyId: 'shared' });
  assert.equal(result.status, 200);
  assert.deepEqual(Object.keys(result.payload as object).sort(), ['access_token', 'expires_at', 'refresh_token']);
  assert.equal(backend.users.size, 1); assert.equal(backend.academies.size, 1); assert.equal(backend.profiles.size, 1);
  const user = [...backend.users.values()][0].user;
  const profile = backend.profiles.get(user.id)!;
  assert.equal(profile.role, 'teacher'); assert.equal(profile.academy_id, user.id);
  assert.equal(profile.is_academy_owner, true); assert.equal(profile.phone, null);
  assert.equal(profile.name, '선생님'); assert.equal(profile.username, user.email);
  assert.equal('temp_password' in profile, false);
  assert.equal(backend.academies.get(user.id)?.name, '하이씨앤씨 교실');
  assert.deepEqual((backend.lastCreation as { app_metadata: unknown }).app_metadata, { hicnc_quick_start: 1 });
  assert.equal((backend.lastCreation as { email_confirm: boolean }).email_confirm, true);
  for (const secret of [SECRET_A, quickStartCredentials(SECRET_A).password, user.email]) {
    assert.equal(JSON.stringify(result.payload).includes(secret), false);
  }
});

test('repeat keeps edited rows unchanged and does not use creation quota', async () => {
  const backend = new FakeBackend();
  await startQuickClassroom(SECRET_A, backend.deps);
  const id = [...backend.profiles.keys()][0];
  backend.profiles.get(id)!.name = '수정한 선생님';
  backend.academies.get(id)!.name = '수정한 교실';
  const rows = JSON.stringify({ profile: [...backend.profiles], academy: [...backend.academies] });
  backend.creationAllowed = false;
  await startQuickClassroom(SECRET_A, backend.deps);
  assert.equal(JSON.stringify({ profile: [...backend.profiles], academy: [...backend.academies] }), rows);
  assert.equal(backend.counts.create, 1); assert.equal(backend.counts.profileInsert, 1); assert.equal(backend.counts.academyInsert, 1);
});

test('two device secrets receive different users and academies', async () => {
  const backend = new FakeBackend();
  const a = await startQuickClassroom(SECRET_A, backend.deps);
  const b = await startQuickClassroom(SECRET_B, backend.deps);
  assert.notEqual(a.access_token, b.access_token);
  assert.equal(backend.users.size, 2); assert.equal(backend.academies.size, 2);
  for (const profile of backend.profiles.values()) assert.equal(profile.id, profile.academy_id);
});

test('simultaneous same-device creation converges without overwrite or duplicate rows', async () => {
  const backend = new FakeBackend();
  const [a, b] = await Promise.all([
    startQuickClassroom(SECRET_A, backend.deps), startQuickClassroom(SECRET_A, backend.deps),
  ]);
  assert.deepEqual(a, b);
  assert.equal(backend.users.size, 1); assert.equal(backend.profiles.size, 1); assert.equal(backend.academies.size, 1);
  assert.equal(backend.counts.create, 2); assert.equal(backend.counts.signIn, 4);
});

test('network, server and rate-limit auth errors never create a user', async () => {
  for (const error of [{ code: 'unexpected_failure', status: 500 }, { code: 'over_request_rate_limit', status: 429 }, { code: 'invalid_credentials', status: 429 }, { status: 0 }]) {
    const backend = new FakeBackend(); backend.signInError = error;
    const result = await request(backend, { deviceSecret: SECRET_A });
    assert.equal(result.status, error.status === 429 ? 429 : 503);
    assert.equal(backend.counts.create, 0); assert.equal(backend.counts.reads, 0);
  }
});

test('duplicate retry is limited to one and unrelated creation errors do not retry', async () => {
  const backend = new FakeBackend(); backend.createError = { code: 'email_exists', status: 422 };
  assert.equal((await request(backend, { deviceSecret: SECRET_A })).status, 503);
  assert.equal(backend.counts.signIn, 2); assert.equal(backend.counts.create, 1);
  for (const error of [{ code: 'unexpected_failure', status: 500 }, { code: 'email_exists', status: 429 }]) {
    const bad = new FakeBackend(); bad.createError = error;
    assert.equal((await request(bad, { deviceSecret: SECRET_A })).status, error.status === 429 ? 429 : 503);
    assert.equal(bad.counts.signIn, 1); assert.equal(bad.counts.create, 1);
  }
});

test('marker, email, or session-user mismatch prevents any profile/academy read or write', async () => {
  for (const variant of ['marker', 'email', 'session'] as const) {
    const backend = new FakeBackend(); await startQuickClassroom(SECRET_A, backend.deps);
    const record = [...backend.users.values()][0];
    if (variant === 'marker') record.user.app_metadata = {};
    if (variant === 'email') record.user.email = 'someone@example.test';
    if (variant === 'session') backend.tamperSessionId = true;
    const before = { ...backend.counts };
    assert.equal((await request(backend, { deviceSecret: SECRET_A })).status, 409);
    assert.equal(backend.counts.reads, before.reads);
    assert.equal(backend.counts.profileInsert, before.profileInsert);
    assert.equal(backend.counts.academyInsert, before.academyInsert);
  }
});

test('existing foreign-role, foreign-academy, deleted, or non-owner profile is never overwritten', async () => {
  for (const patch of [{ role: 'admin' }, { academy_id: 'other' }, { is_academy_owner: false }, { deleted_at: '2026-09-18' }, { teacher_id: 'other' }]) {
    const backend = new FakeBackend(); await startQuickClassroom(SECRET_A, backend.deps);
    const profile = [...backend.profiles.values()][0]; Object.assign(profile, patch);
    const snapshot = JSON.stringify(profile); const writes = backend.counts.academyInsert + backend.counts.profileInsert;
    const result = await request(backend, { deviceSecret: SECRET_A });
    assert.equal(result.status, 409); assert.equal('access_token' in (result.payload as object), false);
    assert.equal(JSON.stringify(profile), snapshot);
    assert.equal(backend.counts.academyInsert + backend.counts.profileInsert, writes);
  }
});

test('partial profile failure retains only own created resources and a retry completes once', async () => {
  const backend = new FakeBackend(); backend.profileInsertError = { code: 'XX000', message: SECRET_A };
  assert.equal((await request(backend, { deviceSecret: SECRET_A })).status, 503);
  assert.equal(backend.users.size, 1); assert.equal(backend.academies.size, 1); assert.equal(backend.profiles.size, 0);
  backend.profileInsertError = null;
  assert.equal((await request(backend, { deviceSecret: SECRET_A })).status, 200);
  assert.equal(backend.counts.create, 1); assert.equal(backend.counts.academyInsert, 1); assert.equal(backend.profiles.size, 1);
});

test('DB read error or falsely reported insert conflict cannot return tokens', async () => {
  for (const mode of ['read', 'academy-conflict', 'profile-conflict'] as const) {
    const backend = new FakeBackend();
    if (mode === 'read') backend.readError = { code: 'XX000' };
    if (mode === 'academy-conflict') backend.academyInsertError = { code: '23505' };
    if (mode === 'profile-conflict') backend.profileInsertError = { code: '23505' };
    const result = await request(backend, { deviceSecret: SECRET_A });
    assert.notEqual(result.status, 200);
    assert.equal('access_token' in (result.payload as object), false);
    assert.equal(backend.profiles.size, 0);
  }
});

test('in-process creation limiter stops new identity work and recovers after refill', async () => {
  let now = 0; const allow = createCreationLimiter(() => now);
  for (let i = 0; i < 5; i += 1) assert.equal(allow(), true);
  assert.equal(allow(), false);
  const backend = new FakeBackend(); backend.deps.allowCreation = allow;
  assert.equal((await request(backend, { deviceSecret: SECRET_A })).status, 429);
  assert.equal(backend.counts.create, 0);
  now = 12_000;
  assert.equal((await request(backend, { deviceSecret: SECRET_A })).status, 200);
  assert.equal(backend.counts.create, 1);
});

test('all unexpected errors are redacted and error responses are not cacheable', async () => {
  const backend = new FakeBackend();
  backend.thrown = new Error(`service-role-secret ${SECRET_A} ${quickStartCredentials(SECRET_A).password}`);
  const result = await request(backend, { deviceSecret: SECRET_A });
  assert.equal(result.status, 503); assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.deepEqual(Object.keys(result.payload as object), ['error']);
  assert.equal(JSON.stringify(result.payload).includes(SECRET_A), false);
  assert.equal(JSON.stringify(result.payload).includes('service-role-secret'), false);
});

test('SDK adapter uses separate anon/service clients with persistence and refresh disabled', async () => {
  const keys = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_ANON_KEY'] as const;
  const old = keys.map(key => process.env[key]);
  const calls: Array<{ key: string; options: unknown }> = [];
  const events: string[] = [];
  try {
    process.env.SUPABASE_URL = 'https://fixture.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-fixture';
    process.env.VITE_SUPABASE_ANON_KEY = 'anon-fixture';
    const factory = ((_url: string, key: string, options: unknown) => {
      calls.push({ key, options });
      return { auth: {
        signInWithPassword: async () => { events.push(`signin:${key}`); return { data: { user: null, session: null }, error: null }; },
        admin: { createUser: async () => { events.push(`create:${key}`); return { data: { user: null }, error: null }; } },
      } };
    }) as unknown as typeof createClient;
    const deps = quickStartDependencies(factory);
    await deps.signIn(quickStartCredentials(SECRET_A));
    await deps.createUser({ ...quickStartCredentials(SECRET_A), email_confirm: true,
      app_metadata: { hicnc_quick_start: 1 }, user_metadata: { name: '선생님' } });
    assert.deepEqual(events, ['signin:anon-fixture', 'create:service-fixture']);
    assert.equal(calls.length, 2);
    for (const call of calls) assert.deepEqual(call.options, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  } finally {
    keys.forEach((key, i) => { if (old[i] == null) delete process.env[key]; else process.env[key] = old[i]; });
  }
});
