import assert from 'node:assert/strict';
import {
  QUICK_START_STORAGE_KEY, QuickStartError, requestQuickStartSession,
  type QuickStartDependencies,
} from '../src/lib/quick-start';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
const tokens = { access_token: 'test-access-token', refresh_token: 'test-refresh-token', expires_at: 1234567890 };
const response = (payload: unknown = tokens, status = 200) => ({
  ok: status >= 200 && status < 300, status, json: async () => payload,
});
function sharedLocks(): NonNullable<QuickStartDependencies['locks']> {
  let previous: Promise<unknown> = Promise.resolve();
  return {
    request<T>(_name: string, callback: () => T | Promise<T>): Promise<T> {
      const current = previous.then(callback);
      previous = current.catch(() => undefined);
      return current;
    },
  };
}
function runtime(storage = new MemoryStorage()) {
  const calls: { url: string; init: RequestInit }[] = [];
  let randomCalls = 0;
  const dependencies: QuickStartDependencies = {
    storage,
    crypto: { getRandomValues(bytes) {
      randomCalls++;
      assert.equal(bytes.length, 32);
      bytes.forEach((_, index) => { bytes[index] = index; });
      return bytes;
    } },
    locks: sharedLocks(),
    fetch: async (url, init) => {
      calls.push({ url, init });
      const body = JSON.parse(String(init.body));
      assert.equal(storage.getItem(QUICK_START_STORAGE_KEY), body.deviceSecret, 'secret must be saved before any request');
      return response();
    },
  };
  return { dependencies, storage, calls, randomCalls: () => randomCalls };
}
async function rejectsCode(run: () => Promise<unknown>, code: QuickStartError['code']) {
  await assert.rejects(run, (error: unknown) => error instanceof QuickStartError && error.code === code);
}
let passed = 0;
async function test(name: string, check: () => unknown) { await check(); passed++; console.log(`PASS ${name}`); }

await test('32바이트 CSPRNG 값의 저장 확인 뒤 고정 같은 출처로만 요청한다', async () => {
  const r = runtime();
  assert.deepEqual(await requestQuickStartSession(r.dependencies), tokens);
  assert.equal(r.randomCalls(), 1);
  const { url, init } = r.calls[0];
  assert.equal(url, '/api/academy');
  assert.equal(init.method, 'POST');
  assert.equal(init.redirect, 'error');
  assert.equal(init.cache, 'no-store');
  assert.equal(init.referrerPolicy, 'no-referrer');
  assert.deepEqual(init.headers, { 'Content-Type': 'application/json' });
  const body = JSON.parse(String(init.body));
  assert.deepEqual(Object.keys(body).sort(), ['action', 'deviceSecret']);
  assert.equal(body.action, 'quick-start');
  assert.match(body.deviceSecret, /^[0-9a-f]{64}$/);
  assert.equal(body.deviceSecret, '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
  assert.ok(!url.includes(body.deviceSecret));
  assert.ok(!JSON.stringify(init.headers).includes(body.deviceSecret));
  assert.deepEqual([...r.storage.values.keys()], [QUICK_START_STORAGE_KEY], 'probe is removed');
});

await test('같은 저장소를 다시 열면 접속 정보를 새로 만들지 않는다', async () => {
  const r = runtime();
  await requestQuickStartSession(r.dependencies);
  const reopened = runtime(r.storage);
  await requestQuickStartSession(reopened.dependencies);
  assert.equal(reopened.randomCalls(), 0);
  assert.equal(r.calls[0].init.body, reopened.calls[0].init.body);
});

await test('처음 연 두 창은 같은 Web Lock 아래에서 하나의 교실 접속 정보를 사용한다', async () => {
  const storage = new MemoryStorage();
  const locks = sharedLocks();
  const first = runtime(storage);
  const second = runtime(storage);
  first.dependencies.locks = locks;
  second.dependencies.locks = locks;
  second.dependencies.crypto = { getRandomValues(bytes) { bytes.fill(255); return bytes; } };
  await Promise.all([requestQuickStartSession(first.dependencies), requestQuickStartSession(second.dependencies)]);
  assert.equal(first.randomCalls(), 1);
  assert.equal(first.calls[0].init.body, second.calls[0].init.body);
  assert.equal(JSON.parse(String(first.calls[0].init.body)).deviceSecret, storage.getItem(QUICK_START_STORAGE_KEY));
});

await test('Web Locks가 없으면 최초 생성은 멈추고 기존 정보만 재사용한다', async () => {
  const r = runtime();
  r.dependencies.locks = null;
  await rejectsCode(() => requestQuickStartSession(r.dependencies), 'storage');
  assert.equal(r.calls.length, 0);
  assert.equal(r.randomCalls(), 0);
  r.storage.setItem(QUICK_START_STORAGE_KEY, 'a'.repeat(64));
  assert.deepEqual(await requestQuickStartSession(r.dependencies), tokens);
  assert.equal(r.randomCalls(), 0);
});

await test('응답을 기다리는 동안 다른 창이 저장값을 바꾸면 세션을 넘기지 않는다', async () => {
  const r = runtime();
  const replacement = 'b'.repeat(64);
  r.dependencies.fetch = async () => {
    r.storage.setItem(QUICK_START_STORAGE_KEY, replacement);
    return response();
  };
  await rejectsCode(() => requestQuickStartSession(r.dependencies), 'storage');
  assert.equal(r.storage.getItem(QUICK_START_STORAGE_KEY), replacement);
});

await test('네트워크 실패 뒤에도 같은 키로 재시도하며 오류에 비밀값을 노출하지 않는다', async () => {
  const r = runtime();
  const originalFetch = r.dependencies.fetch;
  r.dependencies.fetch = async () => { throw new Error(r.storage.getItem(QUICK_START_STORAGE_KEY) ?? 'secret'); };
  let failure = '';
  try { await requestQuickStartSession(r.dependencies); } catch (error) { failure = String(error); }
  const secret = r.storage.getItem(QUICK_START_STORAGE_KEY)!;
  assert.match(secret, /^[0-9a-f]{64}$/);
  assert.ok(!failure.includes(secret));
  assert.match(failure, /연결 상태/);
  r.dependencies.fetch = originalFetch;
  await requestQuickStartSession(r.dependencies);
  assert.equal(JSON.parse(String(r.calls[0].init.body)).deviceSecret, secret);
  assert.equal(r.randomCalls(), 1);
});

await test('읽기만 가능한 저장소에서는 새 교실 생성 요청을 보내지 않는다', async () => {
  const r = runtime();
  r.dependencies.storage = { getItem: () => null, setItem() { throw new Error('quota'); }, removeItem() {} };
  await rejectsCode(() => requestQuickStartSession(r.dependencies), 'storage');
  assert.equal(r.calls.length, 0);
  assert.equal(r.randomCalls(), 0);
});

await test('저장을 조용히 무시하는 브라우저도 probe에서 중단한다', async () => {
  const r = runtime();
  r.dependencies.storage = { getItem: () => null, setItem() {}, removeItem() {} };
  await rejectsCode(() => requestQuickStartSession(r.dependencies), 'storage');
  assert.equal(r.calls.length, 0);
  assert.equal(r.randomCalls(), 0);
});

await test('probe만 성공하고 비밀값 저장이 실패하면 네트워크 요청을 하지 않는다', async () => {
  const r = runtime();
  const storage = r.storage;
  r.dependencies.storage = {
    getItem: (key) => storage.getItem(key),
    removeItem: (key) => storage.removeItem(key),
    setItem(key, value) { if (key !== QUICK_START_STORAGE_KEY) storage.setItem(key, value); },
  };
  await rejectsCode(() => requestQuickStartSession(r.dependencies), 'storage');
  assert.equal(r.calls.length, 0);
  assert.equal(storage.getItem(QUICK_START_STORAGE_KEY), null);
});

await test('손상된 기존 접속 정보는 덮어쓰거나 네트워크로 보내지 않는다', async () => {
  for (const value of ['', 'a'.repeat(63), 'A'.repeat(64), 'not-a-secret']) {
    const r = runtime();
    r.storage.setItem(QUICK_START_STORAGE_KEY, value);
    await rejectsCode(() => requestQuickStartSession(r.dependencies), 'storage');
    assert.equal(r.storage.getItem(QUICK_START_STORAGE_KEY), value);
    assert.equal(r.calls.length, 0);
    assert.equal(r.randomCalls(), 0);
  }
});

await test('CSPRNG가 없거나 실패하면 대체 난수를 쓰지 않고 중단한다', async () => {
  for (const crypto of [null, { getRandomValues() { throw new Error('unavailable'); } }]) {
    const r = runtime();
    r.dependencies.crypto = crypto;
    await rejectsCode(() => requestQuickStartSession(r.dependencies), 'crypto');
    assert.equal(r.calls.length, 0);
    assert.equal(r.storage.getItem(QUICK_START_STORAGE_KEY), null);
  }
});

await test('서버 실패 응답을 접속 성공으로 취급하지 않고 비밀값도 유지한다', async () => {
  const r = runtime();
  r.dependencies.fetch = async () => response({ error: r.storage.getItem(QUICK_START_STORAGE_KEY) }, 503);
  await rejectsCode(() => requestQuickStartSession(r.dependencies), 'server');
  const secret = r.storage.getItem(QUICK_START_STORAGE_KEY);
  r.dependencies.fetch = async () => response();
  assert.deepEqual(await requestQuickStartSession(r.dependencies), tokens);
  assert.equal(r.storage.getItem(QUICK_START_STORAGE_KEY), secret);
  assert.equal(r.randomCalls(), 1);
});

await test('누락·빈 토큰·잘못된 JSON은 실제 세션 설정으로 넘기지 않는다', async () => {
  for (const payload of [null, [], {}, { access_token: 'x' }, { ...tokens, refresh_token: ' ' }, { ...tokens, expires_at: 'later' }]) {
    const r = runtime();
    r.dependencies.fetch = async () => response(payload);
    await rejectsCode(() => requestQuickStartSession(r.dependencies), 'session');
  }
  const r = runtime();
  r.dependencies.fetch = async () => ({ ok: true, status: 200, json: async () => { throw new Error('HTML response'); } });
  await rejectsCode(() => requestQuickStartSession(r.dependencies), 'session');
});

console.log(`${passed} PASS / 0 FAIL (주입한 저장소·난수·fetch만 사용, 서버·계정 생성 없음)`);
