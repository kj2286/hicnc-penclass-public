import {
  applyStatus, isActive, loadJobs, markSendFailed, markSendUnknown, markSubmitted, newJob, prune, saveJobs, stateFromIpp, upsertJob,
} from '../src/lib/print-jobs';
let pass = 0, fail = 0;
const eq = (g: unknown, w: unknown, n = '') => { if (JSON.stringify(g) === JSON.stringify(w)) pass++; else { fail++; console.log(`  FAIL ${n}\n    got  ${JSON.stringify(g)}\n    want ${JSON.stringify(w)}`); } };
const test = (name: string, fn: () => void) => { const b = fail; fn(); console.log(`${fail === b ? 'PASS' : 'FAIL'}  ${name}`); };
const st = (jobState: number | null, extra: Partial<Parameters<typeof applyStatus>[1]> = {}) => ({ jobId: 7, jobState, jobStateText: '', done: false, gone: false, impressionsCompleted: null, reasons: [], ...extra });

test('IPP job-state 매핑 — 3·4 대기, 5·6 출력 중, 7 취소, 8 실패, 9 완료', () => {
  eq(stateFromIpp(3, false), 'pending'); eq(stateFromIpp(4, false), 'pending');
  eq(stateFromIpp(5, false), 'printing'); eq(stateFromIpp(6, false), 'printing');
  eq(stateFromIpp(7, false), 'canceled'); eq(stateFromIpp(8, false), 'failed'); eq(stateFromIpp(9, false), 'done');
  eq(stateFromIpp(null, true), 'unknown', '기록이 없으면 완료로 단정하지 않음');
  eq(stateFromIpp(42, false), 'pending', '모르는 값은 계속 묻는다');
});
test('보내는 중 → 접수 → 출력 중 → 완료 로 흘러가고, 완료는 되돌아가지 않는다', () => {
  let j = newJob({ pdfId: 103, title: '4-2(B형)', uri: 'ipp://x/ipp/print', printerName: 'P', dpi: 1200, copies: 2, now: 1000 });
  eq(j.state, 'sending'); eq(isActive(j.state), true);
  j = markSubmitted(j, { jobId: 7, jobState: 3, jobStateText: '대기', verified: true, verdict: 'match', recordedDpi: 1200, note: 'ok' }, 2000);
  eq([j.state, j.jobId, j.verified, j.verdict], ['pending', 7, true, 'match']);
  j = applyStatus(j, st(5, { impressionsCompleted: 1 }), 3000);
  eq([j.state, j.impressionsCompleted], ['printing', 1]);
  j = applyStatus(j, st(9), 4000);
  eq(j.state, 'done'); eq(isActive(j.state), false);
  const again = applyStatus(j, st(5), 5000);
  eq(again.state, 'done', '종료 뒤 조회값은 무시');
});
test('ADR 세 갈래 — verdict 가 없으면 verified·recordedDpi 로 유추(구버전 앱)', () => {
  const base = newJob({ pdfId: 1, title: 't', uri: 'ipps://printer/ipp/print', printerName: 'p', dpi: 1200, copies: 1, now: 1 });
  const r = (verified: boolean, recordedDpi: number | null) => ({ jobId: 1, jobState: 3, jobStateText: '', verified, recordedDpi, note: '' });
  eq(markSubmitted(base, r(true, 1200)).verdict, 'match');
  eq(markSubmitted(base, r(false, 600)).verdict, 'mismatch', '기록은 있는데 값이 다르다');
  eq(markSubmitted(base, r(false, null)).verdict, 'unknown', '잡 레코드를 못 받았다 — 폐기 금지');
});
test('보내기 실패는 잡 번호 없이 실패로 남는다 · 프린터 사유는 note 에', () => {
  const j = markSendFailed(newJob({ pdfId: 1, title: 't', uri: 'ipps://printer/ipp/print', printerName: 'p', dpi: 600, copies: 1, now: 1 }), '연결 실패', 2);
  eq([j.state, j.jobId, j.note], ['failed', null, '연결 실패']);
  const k = applyStatus(markSubmitted(newJob({ pdfId: 1, title: 't', uri: 'ipps://printer/ipp/print', printerName: 'p', dpi: 600, copies: 1, now: 1 }), { jobId: 1, jobState: 3, jobStateText: '', verified: false, recordedDpi: null, note: '' }), st(8, { reasons: ['media-empty'] }));
  eq([k.state, k.note], ['failed', '프린터 사유: media-empty']);
});
test('하루 지난 종료 잡만 버리고, 진행 중은 남긴다', () => {
  const day = 24 * 60 * 60 * 1000;
  const old = { ...newJob({ pdfId: 1, title: 't', uri: 'ipps://printer/ipp/print', printerName: 'p', dpi: 600, copies: 1, now: 0 }), state: 'done' as const, updatedAt: 0 };
  const active = { ...newJob({ pdfId: 2, title: 't', uri: 'ipps://printer/ipp/print', printerName: 'p', dpi: 600, copies: 1, now: 0 }), state: 'printing' as const, updatedAt: 0 };
  eq(prune([old, active], day + 1).map((j) => j.pdfId), [2]);
  eq(prune([old], day - 1).length, 1, '하루 안이면 남긴다');
});
test('저장·복원 라운드트립 + 깨진 저장값은 빈 목록', () => {
  const mem = new Map<string, string>();
  const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  const j = newJob({ pdfId: 5, title: 't', uri: 'ipps://printer/ipp/print', printerName: 'p', dpi: 600, copies: 1, now: Date.now() });
  saveJobs(storage, upsertJob([], j), 'teacher-a');
  eq(loadJobs(storage, 'teacher-a').map((x) => x.id), [j.id]);
  eq(loadJobs(storage, 'teacher-b'), [], '계정별 출력 기록 격리');
  eq(loadJobs(storage, 'teacher-a')[0].state, 'unknown', '전송 중 종료는 확인 필요');
  eq(upsertJob([j], { ...j, state: 'done' })[0].state, 'done', '같은 id 는 갱신');
  mem.set('hicnc.penclass.printJobs:teacher-a', '{oops');
  eq(loadJobs(storage, 'teacher-a'), []);
  eq(loadJobs(null, 'teacher-a'), [], '저장소 없음');
});
test('전송 응답 유실은 실패나 완료로 단정하지 않는다', () => {
  const j = markSendUnknown(newJob({ pdfId: 1, title: 't', uri: 'ipps://printer/ipp/print', printerName: 'p', dpi: 600, copies: 1, now: 1 }), 'timeout', 2);
  eq(j.state, 'unknown'); eq(j.note.includes('다시 보내기 전에'), true); eq(isActive(j.state), false);
});
console.log(`\n=== ${pass}/${pass + fail} ===`); if (fail) process.exit(1);
