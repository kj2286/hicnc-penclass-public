/**
 * 다른 서비스 교재 필기 걸러내기 회귀 테스트.
 * 실사고 2026-09-07: 펜에 남아 있던 지트 교재 필기가 하이씨앤씨 펜클래스로 딸려 들어왔다.
 */
import { pageKeyOf, splitForeignStrokes } from '../src/lib/foreign-paper';

let fail = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    fail += 1;
    console.error(`FAIL  ${name}\n      ${e instanceof Error ? e.message : e}`);
  }
}
function eq(actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${a} !== ${b}`);
}

const S = (id: string, page: number) => ({
  id,
  section: 3,
  owner: 54,
  noteId: 100,
  pageNumber: page,
});

// 1쪽=내 교재(126), 2쪽=남의 교재(93), 3쪽=미등록 연습장
const MAP = new Map<string, number | null>([
  [pageKeyOf(S('', 1)), 126],
  [pageKeyOf(S('', 2)), 93],
  [pageKeyOf(S('', 3)), null],
]);
const MINE = new Set([125, 126]);

test('내 교재 획은 남긴다', () => {
  const r = splitForeignStrokes([S('a', 1)], MAP, MINE);
  eq([r.keep.map((s) => s.id), r.dropped.length], [['a'], 0]);
});

test('남의 교재 획은 버리고 교재 id 를 알려준다', () => {
  const r = splitForeignStrokes([S('a', 1), S('b', 2)], MAP, MINE);
  eq(r.keep.map((s) => s.id), ['a']);
  eq(r.dropped.map((s) => s.id), ['b']);
  eq(r.foreignPdfIds, [93]);
});

test('미등록 페이지(연습장)는 남긴다 — 학생이 그냥 쓴 필기다', () => {
  const r = splitForeignStrokes([S('c', 3)], MAP, MINE);
  eq([r.keep.map((s) => s.id), r.dropped.length], [['c'], 0]);
});

test('지도에 없는 페이지도 남긴다', () => {
  const r = splitForeignStrokes([S('z', 9)], MAP, MINE);
  eq(r.keep.map((s) => s.id), ['z']);
});

test('소유 목록을 못 읽으면(null) 전부 남긴다 — fail-open', () => {
  // 조회 한 번 실패로 학생 필기를 버리면 복구가 어렵다
  const r = splitForeignStrokes([S('a', 1), S('b', 2), S('c', 3)], MAP, null);
  eq(r.keep.length, 3);
  eq(r.dropped.length, 0);
  eq(r.foreignPdfIds, []);
});

test('내 교재가 하나도 없으면 등록 교재 획은 전부 버린다', () => {
  const r = splitForeignStrokes([S('a', 1), S('b', 2), S('c', 3)], MAP, new Set());
  eq(r.keep.map((s) => s.id), ['c']); // 연습장만 남는다
  eq(r.foreignPdfIds, [93, 126]);
});

test('빈 입력', () => {
  const r = splitForeignStrokes([], MAP, MINE);
  eq([r.keep.length, r.dropped.length, r.foreignPdfIds], [0, 0, []]);
});

console.log(fail === 0 ? '\n=== 7/7 ===' : `\n=== 실패 ${fail} ===`);
if (fail > 0) process.exit(1);
