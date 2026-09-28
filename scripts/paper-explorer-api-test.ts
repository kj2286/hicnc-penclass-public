import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createPaperExplorerHandler, PAPER_EXPLORER_SETTINGS_PREFIX } from '../api/_paper-explorer';
import academyHandler from '../api/academy';
import { addFolder, emptyExplorer, type ExplorerState } from '../src/lib/paper-explorer-model';
import { createPaperExplorerClient } from '../src/lib/paper-explorer-client';
import type { requireCaller } from '../api/_lib';

const key = (uid: string) => `${PAPER_EXPLORER_SETTINGS_PREFIX}${uid}`;
const folderState = () => addFolder(emptyExplorer(), null, '영어', () => 'folder-en');
const clone = <T>(value: T): T => structuredClone(value);

/** In-memory PostgREST behavior, including unique-key INSERT and JSONB CAS. */
function database() {
  const rows = new Map<string, unknown>();
  const accesses: Array<{ operation: string; key: unknown }> = [];
  let beforeWrite: (() => void) | undefined;
  let readBarrier: (() => Promise<void>) | undefined;
  let readError = false;
  let writeError = false;
  const from = (table: string) => {
    assert.equal(table, 'sp_settings');
    return {
      select(columns: string) {
        assert.equal(columns, 'value');
        let selectedKey: string;
        const query = {
          eq(column: string, value: string) { assert.equal(column, 'key'); selectedKey = value; return query; },
          async maybeSingle() {
            accesses.push({ operation: 'select', key: selectedKey });
            const data = rows.has(selectedKey) ? { value: clone(rows.get(selectedKey)) } : null;
            await readBarrier?.();
            return { data, error: readError ? { message: 'fixture-private-read-error' } : null };
          },
        };
        return query;
      },
      update(patch: { value: unknown; updated_at: string }) {
        assert.ok(!Number.isNaN(Date.parse(patch.updated_at)));
        const filters = new Map<string, unknown>();
        const query = {
          eq(column: string, value: unknown) { filters.set(column, value); return query; },
          async select(columns: string) {
            assert.equal(columns, 'key');
            const target = String(filters.get('key'));
            accesses.push({ operation: 'update', key: target });
            beforeWrite?.();
            if (writeError) return { data: null, error: { code: 'XX000', message: 'fixture-private-write-error' } };
            if (!rows.has(target) || JSON.stringify(rows.get(target)) !== filters.get('value')) return { data: [], error: null };
            rows.set(target, clone(patch.value));
            return { data: [{ key: target }], error: null };
          },
        };
        return query;
      },
      insert(input: { key: string; value: unknown }) {
        return {
          async select(columns: string) {
            assert.equal(columns, 'key');
            accesses.push({ operation: 'insert', key: input.key });
            beforeWrite?.();
            if (writeError) return { data: null, error: { code: 'XX000', message: 'fixture-private-write-error' } };
            if (rows.has(input.key)) return { data: null, error: { code: '23505' } };
            rows.set(input.key, clone(input.value));
            return { data: [{ key: input.key }], error: null };
          },
        };
      },
    };
  };
  const admin = { from } as unknown as SupabaseClient;
  return {
    rows, accesses, admin,
    beforeWrite: (callback: () => void) => { beforeWrite = callback; },
    readBarrier: (callback: () => Promise<void>) => { readBarrier = callback; },
    readError: () => { readError = true; },
    writeError: () => { writeError = true; },
    writes: () => accesses.filter(call => call.operation !== 'select'),
  };
}

function recorder() {
  const state = { status: 0, headers: {} as Record<string, string>, body: null as unknown };
  const res = {
    status(code: number) { state.status = code; return res; },
    setHeader(name: string, value: string) { state.headers[name.toLowerCase()] = value; },
    json(body: unknown) { state.body = body; },
    send(body: unknown) { state.body = body; },
  };
  return { state, res };
}

function authorized(db: ReturnType<typeof database>, uid = 'alice'): typeof requireCaller {
  return async (_req, roles) => {
    assert.deepEqual(roles, ['teacher', 'admin']);
    return { caller: { id: uid, role: 'teacher', name: 'fixture' }, admin: db.admin };
  };
}

async function run(handler: ReturnType<typeof createPaperExplorerHandler>, body: Record<string, unknown>, method = 'POST') {
  const { state, res } = recorder();
  await handler({ method, headers: { authorization: 'Bearer fixture-local-only' }, body }, res);
  assert.equal(state.headers['cache-control'], 'no-store');
  return state;
}

await test('실제 academy dispatch는 인증 없는 폴더 요청을 DB 접근 전에 거절한다', async () => {
  const { state, res } = recorder();
  await academyHandler({ method: 'POST', headers: {}, body: { action: 'paper-explorer', operation: 'load' } }, res);
  assert.equal(state.status, 401);
  assert.equal(state.headers['cache-control'], 'no-store');
});

await test('학생·미인증 요청은 저장할 수 없고 GET도 허용하지 않는다', async () => {
  for (const status of [401, 403]) {
    const denied = createPaperExplorerHandler(async () => ({ status, error: 'fixture access denied' }));
    assert.equal((await run(denied, { operation: 'save', state: folderState(), expectedRevision: 0 })).status, status);
  }
  let checks = 0;
  const neverAuthorize = createPaperExplorerHandler(async () => { checks++; throw new Error('must not authorize'); });
  assert.equal((await run(neverAuthorize, {}, 'GET')).status, 405);
  assert.equal(checks, 0);
});

await test('최초 load는 빈 폴더를 반환하고 행을 만들지 않는다', async () => {
  const db = database();
  const loaded = await run(createPaperExplorerHandler(authorized(db)), { operation: 'load' });
  assert.equal(loaded.status, 200);
  assert.deepEqual(loaded.body, { userId: 'alice', state: emptyExplorer() });
  assert.deepEqual(db.writes(), []);
  assert.equal(db.rows.size, 0);
});

await test('최초 save는 본인 prefix 행 하나만 만들고 다른 설정·계정을 보존한다', async () => {
  const db = database();
  db.rows.set('ocr-engine', { value: 'keep' });
  db.rows.set(key('bob'), { ...emptyExplorer(), revision: 9 });
  const saved = await run(createPaperExplorerHandler(authorized(db)), {
    operation: 'save', state: folderState(), expectedRevision: 0,
    userId: 'bob', key: key('bob'), role: 'admin', academyId: 'foreign',
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body, { userId: 'alice', state: { ...folderState(), revision: 1 } });
  assert.deepEqual(db.writes(), [{ operation: 'insert', key: key('alice') }]);
  assert.deepEqual(db.rows.get('ocr-engine'), { value: 'keep' });
  assert.deepEqual(db.rows.get(key('bob')), { ...emptyExplorer(), revision: 9 });
});

await test('서버 정본을 읽은 뒤 같은 value일 때만 revision을 증가시킨다', async () => {
  const db = database();
  db.rows.set(key('alice'), { ...emptyExplorer(), revision: 3 });
  const handler = createPaperExplorerHandler(authorized(db));
  const saved = await run(handler, { operation: 'save', state: { ...folderState(), revision: 3 }, expectedRevision: 3 });
  assert.equal(saved.status, 200);
  assert.deepEqual(db.rows.get(key('alice')), { ...folderState(), revision: 4 });
  const stale = await run(handler, { operation: 'save', state: folderState(), expectedRevision: 0 });
  assert.equal(stale.status, 409);
  assert.equal(db.writes().length, 1);
});

await test('읽기와 UPDATE 사이에 같은 revision의 값이 바뀌어도 덮어쓰지 않는다', async () => {
  const db = database();
  db.rows.set(key('alice'), emptyExplorer());
  const winner = addFolder(emptyExplorer(), null, '다른 창', () => 'winner');
  db.beforeWrite(() => { db.rows.set(key('alice'), clone(winner)); });
  const result = await run(createPaperExplorerHandler(authorized(db)), { operation: 'save', state: folderState(), expectedRevision: 0 });
  assert.equal(result.status, 409);
  assert.deepEqual(db.rows.get(key('alice')), winner);
});

await test('동시 최초 INSERT는 한 건만 저장하고 다른 요청은 409로 끝난다', async () => {
  const db = database();
  let release!: () => void;
  const bothRead = new Promise<void>((resolve) => { release = resolve; });
  let reads = 0;
  db.readBarrier(async () => { if (++reads === 2) release(); await bothRead; });
  const handler = createPaperExplorerHandler(authorized(db));
  const requests = await Promise.all([
    run(handler, { operation: 'save', state: folderState(), expectedRevision: 0 }),
    run(handler, { operation: 'save', state: emptyExplorer(), expectedRevision: 0 }),
  ]);
  assert.deepEqual(requests.map(result => result.status).sort(), [200, 409]);
  assert.equal(db.rows.size, 1);
  assert.equal((db.rows.get(key('alice')) as ExplorerState).revision, 1);
});

await test('손상된 기존 폴더는 빈 상태로 바꾸거나 덮어쓰지 않는다', async () => {
  for (const broken of [null, { version: 2 }, { ...emptyExplorer(), folders: [{ id: 'cycle', parentId: 'cycle', name: 'bad' }] }]) {
    const db = database();
    db.rows.set(key('alice'), broken);
    const response = await run(createPaperExplorerHandler(authorized(db)), { operation: 'save', state: folderState(), expectedRevision: 0 });
    assert.equal(response.status, 500);
    assert.deepEqual(db.writes(), []);
    assert.deepEqual(db.rows.get(key('alice')), broken);
  }
});

await test('누락·손상·200kB 초과 입력은 쓰기 전에 거절한다', async () => {
  for (const state of [undefined, null, { ...emptyExplorer(), folders: [{ id: 'a', parentId: 'a', name: 'cycle' }] }, { ...emptyExplorer(), padding: '한'.repeat(70_000) }]) {
    const db = database();
    const response = await run(createPaperExplorerHandler(authorized(db)), { operation: 'save', state, expectedRevision: 0 });
    assert.equal(response.status, 400);
    assert.deepEqual(db.accesses, []);
  }
});

await test('잘못된 revision·작업은 기존 행을 바꾸지 않는다', async () => {
  for (const expectedRevision of [-1, 0.5, '0', Number.MAX_SAFE_INTEGER + 1]) {
    const db = database();
    assert.equal((await run(createPaperExplorerHandler(authorized(db)), { operation: 'save', state: folderState(), expectedRevision })).status, 409);
    assert.deepEqual(db.writes(), []);
  }
  const db = database();
  assert.equal((await run(createPaperExplorerHandler(authorized(db)), { operation: 'delete' })).status, 400);
  assert.deepEqual(db.accesses, []);
});

await test('DB 실패 응답은 내부 오류 내용을 노출하지 않는다', async () => {
  for (const stage of ['read', 'write']) {
    const db = database();
    if (stage === 'read') db.readError(); else db.writeError();
    const response = await run(createPaperExplorerHandler(authorized(db)), { operation: 'save', state: folderState(), expectedRevision: 0 });
    assert.equal(response.status, 500);
    assert.ok(!JSON.stringify(response.body).includes('fixture-private'));
    assert.equal(db.rows.size, 0);
  }
});

function clientSession(uid: string | null) {
  return { data: { session: uid ? { user: { id: uid }, access_token: `fixture-${uid}` } : null }, error: null };
}

await test('실제 클라이언트→API 모의 연결은 저장 뒤 재조회한 정본과 같다', async () => {
  const db = database();
  const handler = createPaperExplorerHandler(authorized(db));
  const client = createPaperExplorerClient({
    getSession: async () => clientSession('alice'),
    fetch: async (url, init) => {
      assert.equal(url, '/api/academy');
      assert.equal(init?.method, 'POST');
      assert.equal(init?.cache, 'no-store');
      assert.equal(init?.redirect, 'error');
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer fixture-alice');
      const body = JSON.parse(String(init?.body));
      assert.equal(body.action, 'paper-explorer');
      const response = await run(handler, body);
      return Response.json(response.body, { status: response.status });
    },
  });
  const saved = await client.save('alice', folderState(), 0);
  assert.equal(saved.revision, 1);
  assert.deepEqual(await client.load(), { userId: 'alice', state: saved });
  await assert.rejects(client.save('alice', emptyExplorer(), 0), /다른 창/);
  assert.equal(db.writes().length, 1);
});

await test('클라이언트는 저장 시작 전 계정이 다르면 요청하지 않는다', async () => {
  let calls = 0;
  const client = createPaperExplorerClient({
    getSession: async () => clientSession('bob'),
    fetch: async () => { calls++; throw new Error('must not fetch'); },
  });
  await assert.rejects(client.save('alice', folderState(), 0), /로그인이 바뀌/);
  assert.equal(calls, 0);
});

await test('응답 중 계정이 바뀌거나 다른 UID가 돌아오면 표시하지 않는다', async () => {
  for (const switchSession of [false, true]) {
    let uid = 'alice';
    const client = createPaperExplorerClient({
      getSession: async () => clientSession(uid),
      fetch: async () => {
        if (switchSession) uid = 'bob';
        return Response.json({ userId: switchSession ? 'alice' : 'bob', state: emptyExplorer() });
      },
    });
    await assert.rejects(client.load());
  }
});

await test('성공 응답이라도 저장 내용·revision이 다르면 성공으로 처리하지 않는다', async () => {
  const client = createPaperExplorerClient({
    getSession: async () => clientSession('alice'),
    fetch: async () => Response.json({ userId: 'alice', state: { ...emptyExplorer(), revision: 1 } }),
  });
  await assert.rejects(client.save('alice', folderState(), 0), /일치하지/);
});

await test('클라이언트 저장은 호출 시점 복사본을 보내고 이후 입력 변경에 영향받지 않는다', async () => {
  const input = folderState();
  let submitted: ExplorerState | undefined;
  const client = createPaperExplorerClient({
    getSession: async () => clientSession('alice'),
    fetch: async (_url, init) => {
      submitted = JSON.parse(String(init?.body)).state;
      return Response.json({ userId: 'alice', state: { ...submitted, revision: 1 } });
    },
  });
  const saving = client.save('alice', input, 0);
  input.folders[0].name = 'later edit';
  await saving;
  assert.equal(submitted?.folders[0].name, '영어');
});
