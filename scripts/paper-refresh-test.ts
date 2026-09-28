import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { createLatestRequestGate, refreshUntilListed, shouldKeepUploadAttempt } from '../src/lib/paper-refresh';
import { visiblePapers } from '../src/lib/paper-list';
import ngsProxy from '../api/ngs';

const paper = (id: number) => ({ id, status: 'active', extraInfo: { app: 'hicnc-penclass' } });

await test('이미 보이는 교재는 한 번만 조회하고 기다리지 않는다', async () => {
  let reads = 0;
  let sleeps = 0;
  const shown = [paper(157)];
  assert.equal(await refreshUntilListed({
    id: 157,
    load: async () => { reads++; return shown; },
    sleep: async () => { sleeps++; },
  }), shown);
  assert.equal(reads, 1);
  assert.equal(sleeps, 0);
});

await test('소유 기록 저장 뒤 재조회한 목록에 새 ID가 나타나면 성공한다', async () => {
  let active = new Set<number>();
  const rows = [paper(157), paper(999)];
  let reads = 0;
  let sleeps = 0;
  const shown = await refreshUntilListed({
    id: 157,
    load: async () => {
      reads++;
      return visiblePapers(rows, { active: new Set(active), trashed: new Map() });
    },
    sleep: async () => { sleeps++; active = new Set([157]); },
  });
  assert.deepEqual(shown?.map((row) => row.id), [157]);
  assert.equal(reads, 2);
  assert.equal(sleeps, 1);
});

await test('조회 오류나 null은 이전 목록의 성공으로 바꾸지 않고 다시 읽는다', async () => {
  let reads = 0;
  const result = await refreshUntilListed({
    id: 157,
    load: async () => {
      reads++;
      if (reads === 1) throw new Error('fixture read failure');
      if (reads === 2) return null;
      if (reads === 3) return [paper(156)];
      return [paper(157)];
    },
    sleep: async () => {},
  });
  assert.deepEqual(result?.map((row) => row.id), [157]);
  assert.equal(reads, 4);
});

await test('소유 조회가 끝내 실패하면 6회에서 멈추고 마지막에는 기다리지 않는다', async () => {
  let reads = 0;
  const waits: number[] = [];
  assert.equal(await refreshUntilListed({
    id: 157,
    attempts: 100,
    load: async () => { reads++; return null; },
    sleep: async (ms) => { waits.push(ms); },
  }), null);
  assert.equal(reads, 6);
  assert.deepEqual(waits, Array(5).fill(1500));
});

await test('다른 서비스·미소유·휴지통 교재는 재조회 성공으로 세지 않는다', async () => {
  const rows = [
    paper(156),
    { ...paper(157), extraInfo: { app: 'other-service' } },
    paper(158),
  ];
  const shown = visiblePapers(rows, { active: new Set([157, 158]), trashed: new Map([[158, 'fixture']]) });
  assert.deepEqual(shown, []);
  assert.equal(await refreshUntilListed({ id: 157, load: async () => shown, attempts: 1 }), null);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

await test('업로드 전 빈 응답이 늦게 도착해도 새 교재 목록을 덮지 않는다', async () => {
  const gate = createLatestRequestGate();
  const beforeUpload = deferred<ReturnType<typeof paper>[]>();
  const afterClaim = deferred<ReturnType<typeof paper>[]>();
  let displayed: ReturnType<typeof paper>[] = [];
  const load = async (response: Promise<ReturnType<typeof paper>[]>) => {
    const request = gate.begin();
    const shown = await response;
    if (!gate.isLatest(request)) return null;
    displayed = shown;
    return shown;
  };
  const oldRead = load(beforeUpload.promise);
  const confirmedRead = load(afterClaim.promise);
  afterClaim.resolve([paper(157)]);
  assert.deepEqual((await confirmedRead)?.map((row) => row.id), [157]);
  beforeUpload.resolve([]);
  assert.equal(await oldRead, null);
  assert.deepEqual(displayed.map((row) => row.id), [157]);
});

await test('화면을 떠나 무효화한 요청은 이후 상태를 적용할 수 없다', () => {
  const gate = createLatestRequestGate();
  const request = gate.begin();
  assert.equal(gate.isLatest(request), true);
  gate.invalidate();
  assert.equal(gate.isLatest(request), false);
  const next = gate.begin();
  assert.equal(gate.isLatest(next), true);
  assert.equal(gate.isLatest(request), false);
});

await test('발급 단계의 연결·파싱·서버·요청시간초과 오류는 같은 요청을 보관한다', () => {
  for (const httpStatus of [undefined, 200, 408, 500, 502, 504]) {
    assert.equal(shouldKeepUploadAttempt({ phase: 'ncode', httpStatus }), true);
  }
  assert.equal(shouldKeepUploadAttempt({ phase: 'ncode', authRejected: true }), false);
  for (const httpStatus of [400, 401, 403, 422, 429]) {
    assert.equal(shouldKeepUploadAttempt({ phase: 'ncode', httpStatus }), false);
  }
  assert.equal(shouldKeepUploadAttempt({ phase: 'upload' }), false);
  assert.equal(shouldKeepUploadAttempt({ phase: null }), false);
});

// 실제 claimPaper를 실행하되 Supabase 모듈만 로컬 fixture로 교체한다.
const claimSource = readFileSync(new URL('../src/lib/paper-owners.ts', import.meta.url), 'utf8');
const claimJs = ts.transpileModule(claimSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
}).outputText
  .replace("import { requireSupabase } from '@/lib/supabase';", 'const requireSupabase = () => globalThis.__paperClaimFixture;')
  .replace("from './paper-subject'", `from '${new URL('../src/lib/paper-subject.ts', import.meta.url).href}'`)
  .replace("from './paper-list'", `from '${new URL('../src/lib/paper-list.ts', import.meta.url).href}'`);
assert.ok(claimJs.includes('globalThis.__paperClaimFixture'));
const claims = await import(`data:text/javascript;base64,${Buffer.from(claimJs).toString('base64')}`) as typeof import('../src/lib/paper-owners');

await test('업로드 뒤 SDK 계정만 바뀌어도 다른 교사 소유로 기록하지 않는다', async () => {
  let writes = 0;
  const fixtures = globalThis as unknown as Record<string, unknown>;
  fixtures.__paperClaimFixture = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'teacher-new' } } } }) },
    from: () => { writes++; throw new Error('must not write'); },
  };
  try {
    const result = await claims.claimPaper(157, '테스트지', '영어', 'teacher-original');
    assert.equal(result.claimed, false);
    assert.equal(writes, 0);
    assert.ok(result.warning);
  } finally { delete fixtures.__paperClaimFixture; }
});

await test('업로드 교사와 SDK 계정이 같으면 기존 소유 저장 본문을 유지한다', async () => {
  const writes: unknown[] = [];
  const fixtures = globalThis as unknown as Record<string, unknown>;
  fixtures.__paperClaimFixture = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'teacher-original' } } } }) },
    from: (table: string) => {
      assert.equal(table, 'sp_paper_owners');
      return { upsert: async (body: unknown) => { writes.push(body); return { error: null }; } };
    },
  };
  try {
    const result = await claims.claimPaper(157, '테스트지', '영어', 'teacher-original');
    assert.equal(result.claimed, true);
    assert.deepEqual(writes, [{ pdf_id: 157, teacher_id: 'teacher-original', kind: '테스트지', subject: '영어' }]);
  } finally { delete fixtures.__paperClaimFixture; }
});

// Vite가 치환하는 공개 DEV 플래그만 고정한다. 실제 환경값·서버는 읽지 않는다.
const clientSource = readFileSync(new URL('../src/lib/ngs-client.ts', import.meta.url), 'utf8');
const clientJs = ts.transpileModule(clientSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
}).outputText.replaceAll('import.meta.env', '({ DEV: false })');
const client = await import(`data:text/javascript;base64,${Buffer.from(clientJs).toString('base64')}`) as typeof import('../src/lib/ngs-client');
const originalFetch = globalThis.fetch;

await test('NGS 목록은 다음 커서를 유지하고 모든 페이지를 캐시 없이 읽는다', async () => {
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), 'https://fixture.invalid');
    calls.push({ url, init });
    return Response.json({ data: calls.length === 1
      ? { items: Array.from({ length: 100 }, (_, index) => paper(index + 1)), nextCursor: 'cursor +/next' }
      : { items: [paper(156), paper(157)] } });
  };
  try {
    const rows = await client.listAllPdfs();
    assert.equal(rows.length, 102);
    assert.deepEqual(rows.slice(-2).map((row) => row.id), [156, 157]);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url.searchParams.get('limit'), '100');
    assert.equal(calls[0].url.searchParams.get('order'), 'asc');
    assert.equal(calls[1].url.searchParams.get('cursor'), 'cursor +/next');
    for (const call of calls) {
      assert.equal(call.init?.cache, 'no-store');
      assert.equal(call.init?.credentials, 'include');
    }
  } finally { globalThis.fetch = originalFetch; }
});

await test('NGS 상세 조회도 캐시를 쓰지 않으며 404는 null로 유지한다', async () => {
  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.cache, 'no-store');
    return new Response(null, { status: 404 });
  };
  try { assert.equal(await client.getPdfWithPages(157), null); }
  finally { globalThis.fetch = originalFetch; }
});

await test('타임아웃 복구는 같은 제목이라도 해당 업로드 식별자가 맞는 교재만 고른다', async () => {
  let reads = 0;
  const now = new Date();
  const row = (id: number, app: string, uploadAttemptId: string) => ({
    ...paper(id), title: 'fixture title', createdAt: now.toISOString(), extraInfo: { app, uploadAttemptId },
  });
  const wanted = row(157, 'hicnc-penclass', 'own-attempt');
  globalThis.fetch = async () => {
    reads++;
    return Response.json({ data: { items: reads === 1 ? [
      row(150, 'other-service', 'own-attempt'),
      row(151, 'hicnc-penclass', 'another-attempt'),
      { ...row(152, 'hicnc-penclass', 'own-attempt'), status: 'removed' },
      row(-1, 'hicnc-penclass', 'own-attempt'),
    ] : [wanted] } });
  };
  try {
    const found = await client.waitForRegisteredPdf({
      title: 'fixture title', notBefore: now, intervalMs: 0, timeoutMs: 1000,
      matches: (pdf) => pdf.extraInfo?.app === 'hicnc-penclass' && pdf.extraInfo?.uploadAttemptId === 'own-attempt',
    });
    assert.equal(found?.id, 157);
    assert.equal(reads, 2);
  } finally { globalThis.fetch = originalFetch; }
});

function responseRecorder() {
  const state = { status: 0, headers: new Map<string, string>(), body: undefined as unknown };
  const response = {
    status: (code: number) => { state.status = code; return response; },
    setHeader: (key: string, value: string) => { state.headers.set(key.toLowerCase(), value); },
    json: (body: unknown) => { state.body = body; },
    send: (body: unknown) => { state.body = body; },
  };
  return { state, response };
}

const savedBase = process.env.NGS_BASE_URL;
const savedAuth = process.env.NGS_AUTH;
process.env.NGS_BASE_URL = 'https://fixture.invalid/ngs';
process.env.NGS_AUTH = 'Basic fixture-only';
try {
  await test('프록시는 GET 커서·인증 계약을 유지하고 양쪽 캐시를 끈다', async () => {
    const body = { data: { items: [paper(157)] } };
    let reads = 0;
    globalThis.fetch = async (input, init) => {
      reads++;
      const url = new URL(String(input));
      assert.equal(url.origin, 'https://fixture.invalid');
      assert.equal(url.pathname, '/ngs/api/v1/pdfs');
      assert.equal(url.searchParams.get('cursor'), 'cursor +/next');
      assert.equal(url.searchParams.get('suffix'), null);
      assert.equal(init?.method, 'GET');
      assert.equal(init?.cache, 'no-store');
      assert.equal(new Headers(init?.headers).get('authorization'), 'Basic fixture-only');
      return Response.json(body);
    };
    const { state, response } = responseRecorder();
    await ngsProxy({ method: 'GET', url: '/api/ngs?suffix=api/v1/pdfs&cursor=cursor+%2B%2Fnext', headers: {} }, response);
    assert.equal(reads, 1);
    assert.equal(state.status, 200);
    assert.equal(state.headers.get('cache-control'), 'no-store');
    assert.deepEqual(state.body, body);
  });

  await test('프록시의 발급 POST 본문·응답·요청 횟수는 바뀌지 않는다', async () => {
    const body = { fileHash: 'fixture-hash', title: 'fixture title', extraInfo: { app: 'hicnc-penclass', uploadAttemptId: 'fixture-attempt' } };
    let writes = 0;
    globalThis.fetch = async (_input, init) => {
      writes++;
      assert.equal(init?.method, 'POST');
      assert.equal(init?.body, JSON.stringify(body));
      return Response.json({ data: paper(157) }, { status: 201 });
    };
    const { state, response } = responseRecorder();
    await ngsProxy({ method: 'POST', url: '/api/ngs?suffix=api/v1/pdfs', headers: { 'content-type': 'application/json' }, body }, response);
    assert.equal(writes, 1);
    assert.equal(state.status, 201);
    assert.equal(state.headers.get('cache-control'), 'no-store');
    assert.deepEqual(state.body, { data: paper(157) });
  });

  await test('연결 미설정 오류도 캐시하지 않으며 서버 요청을 보내지 않는다', async () => {
    delete process.env.NGS_BASE_URL;
    globalThis.fetch = async () => { throw new Error('must not fetch'); };
    const { state, response } = responseRecorder();
    await ngsProxy({ method: 'GET', url: '/api/ngs?suffix=api/v1/pdfs', headers: {} }, response);
    assert.equal(state.status, 503);
    assert.equal(state.headers.get('cache-control'), 'no-store');
  });
} finally {
  globalThis.fetch = originalFetch;
  if (savedBase === undefined) delete process.env.NGS_BASE_URL;
  else process.env.NGS_BASE_URL = savedBase;
  if (savedAuth === undefined) delete process.env.NGS_AUTH;
  else process.env.NGS_AUTH = savedAuth;
}
