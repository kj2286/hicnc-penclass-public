/**
 * 교재 목록 필터 회귀 테스트.
 *
 * 실사고(2026-09-04): 삭제해도 5초 뒤 되살아났다. 원인은 합성 대기 폴링이
 * 소유·휴지통 필터를 건너뛰고 NGS 원본 목록을 그대로 그린 것. 목록을 만드는
 * 경로가 하나(visiblePapers)로 모였는지, 그 함수가 휴지통을 제대로 빼는지 본다.
 */
import { visiblePapers } from '../src/lib/paper-list';
import type { PaperOwnership } from '../src/lib/paper-owners';

let pass = 0;
let fail = 0;
const eq = (got: unknown, want: unknown, note = '') => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) pass++;
  else {
    fail++;
    console.log(`  FAIL ${note}\n    got  ${g}\n    want ${w}`);
  }
};
const test = (name: string, fn: () => void) => {
  const before = fail;
  fn();
  console.log(`${fail === before ? 'PASS' : 'FAIL'}  ${name}`);
};

const paper = (id: number, status: string | null = 'ready') => ({
  id,
  status,
  extraInfo: { app: 'hicnc-penclass' } as Record<string, unknown>,
});
const own = (active: number[] | null, trashed: number[] = []): PaperOwnership => ({
  active: active == null ? null : new Set(active),
  trashed: new Map(trashed.map((id) => [id, '2026-09-04T00:00:00Z'])),
});

test('휴지통에 넣은 교재는 목록에서 빠진다', () => {
  const list = [paper(1), paper(2), paper(3)];
  eq(visiblePapers(list, own([1, 2, 3], [2])).map((p) => p.id), [1, 3]);
});

test('소유 기록이 없는 교재는 안 보인다 (다른 계정이 올린 것·claim 실패분)', () => {
  const list = [paper(1), paper(100), paper(101)];
  eq(visiblePapers(list, own([1])).map((p) => p.id), [1]);
});

test('소유 기록을 못 읽으면(active=null) 아무것도 보여주지 않는다 — 다른 서비스 교재 유입 차단', () => {
  const list = [paper(1), paper(2)];
  eq(visiblePapers(list, own(null)).map((p) => p.id), []);
  eq(visiblePapers(list, own(null, [2])).map((p) => p.id), []);
});

test('앱 태그가 없거나 다른 서비스면 소유 기록이 있어도 뺀다', () => {
  const list = [
    { id: 1, status: 'ready', extraInfo: { app: 'hicnc-penclass' } },
    { id: 2, status: 'ready', extraInfo: { app: 'penclass' } },
    { id: 3, status: 'ready' },
    { id: 4, status: 'ready', extraInfo: {} },
  ];
  eq(visiblePapers(list, own([1, 2, 3, 4])).map((p) => p.id), [1]);
});

test('NGS 가 removed 로 표시한 교재는 어떤 경우에도 빠진다', () => {
  const list = [paper(1), paper(2, 'removed')];
  eq(visiblePapers(list, own(null)).map((p) => p.id), []);
  eq(visiblePapers(list, own([1, 2])).map((p) => p.id), [1]);
});

test('되살아남 재현 — 원본 목록을 그대로 쓰면 휴지통이 돌아온다', () => {
  // 폴링이 하던 옛 동작: status 만 걸러 그대로 그림 → 2번이 되살아난다
  const list = [paper(1), paper(2), paper(3)];
  const 옛방식 = list.filter((p) => p.status !== 'removed').map((p) => p.id);
  eq(옛방식.includes(2), true, '옛 경로는 휴지통을 되살렸다(사고 재현)');
  eq(visiblePapers(list, own([1, 2, 3], [2])).map((p) => p.id).includes(2), false);
});

console.log(`\n=== ${pass}/${pass + fail} ===`);
if (fail > 0) process.exit(1);
