import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { loadJobs, markSubmitted, newJob, type PrintJob } from '../src/lib/print-jobs';
import type { DeskJobStatus } from '../src/lib/desk';

/** Run the actual Zustand store; substitute only native/session/storage boundaries. */
const globals = globalThis as unknown as Record<string, unknown>;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const values = new Map<string, string>();
const memoryStorage: Storage = {
  get length() { return values.size; },
  clear: () => values.clear(),
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => { values.set(key, value); },
  removeItem: key => { values.delete(key); },
  key: index => [...values.keys()][index] ?? null,
};
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memoryStorage });
let lookup: (uri: string, id: number) => Promise<DeskJobStatus> = async () => { throw new Error('fixture not configured'); };
globals.__printStoreFixture = {
  status: (uri: string, id: number) => lookup(uri, id),
  session: { getState: () => ({ profile: null }), subscribe: () => () => {} },
};

const source = readFileSync(new URL('../src/store/print-jobs.store.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
}).outputText
  .replace("from 'zustand'", `from '${import.meta.resolve('zustand')}'`)
  .replace("import { deskPrintJobStatus } from '@/lib/desk';", 'const deskPrintJobStatus = (...args) => globalThis.__printStoreFixture.status(...args);')
  .replace("from '@/lib/print-jobs'", `from '${new URL('../src/lib/print-jobs.ts', import.meta.url).href}'`)
  .replace("import { useSessionStore } from './session.store';", 'const useSessionStore = globalThis.__printStoreFixture.session;');
assert.ok(compiled.includes('globalThis.__printStoreFixture.status'));
assert.ok(!compiled.includes("from '@/"));
assert.ok(!compiled.includes("from './session.store'"));

const pendingJob = (pdfId: number): PrintJob => markSubmitted(newJob({
  pdfId, title: `fixture-${pdfId}`, uri: 'ipps://fixture.invalid/ipp/print', printerName: 'fixture', dpi: 600, copies: 1,
}), { jobId: pdfId, jobState: 3, jobStateText: 'fixture pending', verified: true, recordedDpi: 600, note: '' });
const done = (jobId: number): DeskJobStatus => ({ jobId, jobState: 9, jobStateText: 'fixture done', done: true, gone: false, impressionsCompleted: 1, reasons: [] });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

try {
  const { usePrintJobsStore: store } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`) as typeof import('../src/store/print-jobs.store');
  const reset = () => { store.setState({ ownerId: null, jobs: [], open: false }); values.clear(); };

  await test('계정 전환 후 접수 응답은 원래 교사 기록에만 저장한다', () => {
    reset();
    const alice = pendingJob(11), bob = pendingJob(22);
    store.getState().setOwner('bob');
    store.getState().upsert(bob, 'bob');
    store.getState().upsert(alice, 'alice');
    assert.deepEqual(store.getState().jobs.map(job => job.pdfId), [22]);
    assert.deepEqual(loadJobs(memoryStorage, 'alice').map(job => job.pdfId), [11]);
    assert.deepEqual(loadJobs(memoryStorage, 'bob').map(job => job.pdfId), [22]);
    store.getState().setOwner('alice');
    assert.deepEqual(store.getState().jobs.map(job => job.pdfId), [11]);
  });

  await test('이전 계정의 늦은 완료 응답은 현재 계정과 저장 기록을 바꾸지 않는다', async () => {
    reset();
    const delayed = deferred<DeskJobStatus>();
    lookup = () => delayed.promise;
    store.getState().setOwner('alice');
    store.getState().upsert(pendingJob(11), 'alice');
    const polling = store.getState().pollOnce();
    store.getState().setOwner('bob');
    store.getState().upsert(pendingJob(22), 'bob');
    delayed.resolve(done(11));
    await polling;
    assert.deepEqual(store.getState().jobs.map(job => [job.pdfId, job.state]), [[22, 'pending']]);
    assert.equal(loadJobs(memoryStorage, 'alice')[0].state, 'pending');
  });

  await test('이전 계정의 늦은 명령 오류도 다른 계정에 업데이트 안내를 남기지 않는다', async () => {
    reset();
    const delayed = deferred<DeskJobStatus>();
    lookup = () => delayed.promise;
    store.getState().setOwner('alice');
    store.getState().upsert(pendingJob(11), 'alice');
    const polling = store.getState().pollOnce();
    store.getState().setOwner('bob');
    store.getState().upsert(pendingJob(22), 'bob');
    delayed.reject(new Error('Command print_job_status not found'));
    await polling;
    assert.equal(store.getState().jobs[0].state, 'pending');
    assert.equal(store.getState().jobs[0].note, '');
    assert.equal(loadJobs(memoryStorage, 'alice')[0].state, 'pending');
  });

  await test('미지원 명령은 확인 필요, 프린터·네트워크 오류는 다음 조회 대상으로 남긴다', async () => {
    for (const [message, expected] of [
      ['Command print_job_status not found', 'unknown'],
      ['print_job_status not allowed by permissions', 'unknown'],
      ['Unknown command print_job_status', 'unknown'],
      ['printer not found', 'pending'],
      ['network timeout', 'pending'],
      ['print_job_status transport connection failed', 'pending'],
    ] as const) {
      reset();
      lookup = async () => { throw new Error(message); };
      store.getState().setOwner('alice');
      store.getState().upsert(pendingJob(11), 'alice');
      await store.getState().pollOnce();
      const job = store.getState().jobs[0];
      assert.equal(job.state, expected, message);
      assert.equal(job.note.includes('0.1.2'), expected === 'unknown');
      if (expected === 'pending') {
        lookup = async () => done(11);
        await store.getState().pollOnce();
        assert.equal(store.getState().jobs[0].state, 'done');
      }
    }
  });

  await test('느린 조회 도중 다시 poll해도 네이티브 상태 요청을 겹쳐 보내지 않는다', async () => {
    reset();
    const delayed = deferred<DeskJobStatus>();
    let calls = 0;
    lookup = async () => { calls++; return delayed.promise; };
    store.getState().setOwner('alice');
    store.getState().upsert(pendingJob(11), 'alice');
    const first = store.getState().pollOnce();
    await store.getState().pollOnce();
    assert.equal(calls, 1);
    delayed.resolve(done(11));
    await first;
    assert.equal(store.getState().jobs[0].state, 'done');
  });
} finally {
  delete globals.__printStoreFixture;
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else delete globals.localStorage;
}
