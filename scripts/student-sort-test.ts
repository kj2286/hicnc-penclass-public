/**
 * 학생 목록 정렬 회귀 테스트 — 최근 업로드순이 핵심(크래들로 받은 학생 찾기).
 */
import { sortStudents, uploadAgoLabel } from '../src/lib/student-sort';

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

const S = (id: string, name: string, createdAt: string) => ({ id, name, createdAt });
const list = [
  S('a', '김하나', '2026-01-01T00:00:00Z'),
  S('b', '박두리', '2026-03-01T00:00:00Z'),
  S('c', '이세찌', '2026-02-01T00:00:00Z'),
];
const ids = (l: Array<{ id: string }>) => l.map((x) => x.id);

test('이름순 — 한글 가나다', () => {
  eq(ids(sortStudents(list, 'name')), ['a', 'b', 'c']);
});

test('최신 등록순 — createdAt 내림차순', () => {
  eq(ids(sortStudents(list, 'recent')), ['b', 'c', 'a']);
});

test('최근 업로드순 — 최근에 올린 학생이 맨 위', () => {
  const last = {
    a: '2026-09-01T10:00:00Z',
    b: '2026-09-05T09:00:00Z',
    c: '2026-09-03T08:00:00Z',
  };
  eq(ids(sortStudents(list, 'upload', last)), ['b', 'c', 'a']);
});

test('최근 업로드순 — 한 번도 안 올린 학생은 아래에 이름순으로', () => {
  const last = { c: '2026-09-03T08:00:00Z' };
  eq(ids(sortStudents(list, 'upload', last)), ['c', 'a', 'b']);
});

test('최근 업로드순 — 업로드 자료가 아직 없으면 이름순으로 안정', () => {
  eq(ids(sortStudents(list, 'upload', {})), ['a', 'b', 'c']);
});

test('원본 배열을 건드리지 않는다', () => {
  const copy = [...list];
  sortStudents(list, 'name');
  eq(ids(list), ids(copy));
});

test('업로드 시각 라벨 — 오늘·어제·n일 전', () => {
  // 기준: 2026-09-05 15:00 KST = 06:00Z
  const now = Date.parse('2026-09-05T06:00:00Z');
  eq(uploadAgoLabel('2026-09-05T01:00:00Z', now), '오늘');
  eq(uploadAgoLabel('2026-09-04T01:00:00Z', now), '어제');
  eq(uploadAgoLabel('2026-09-02T01:00:00Z', now), '3일 전');
});

test('업로드 시각 라벨 — 한국 자정 경계(UTC 로 자르면 하루 어긋난다)', () => {
  const now = Date.parse('2026-09-05T06:00:00Z'); // 9/5 15시 KST
  // 9/5 00:30 KST = 9/4 15:30Z — UTC 로 자르면 "어제" 로 잘못 읽는다
  eq(uploadAgoLabel('2026-09-04T15:30:00Z', now), '오늘');
});

test('업로드 시각 라벨 — 일주일 넘으면 날짜, 없으면 null', () => {
  const now = Date.parse('2026-09-05T06:00:00Z');
  const old = uploadAgoLabel('2026-08-01T01:00:00Z', now);
  if (!old || !/8/.test(old)) throw new Error(`날짜 표기가 아니다: ${old}`);
  eq(uploadAgoLabel(null, now), null);
  eq(uploadAgoLabel('이상한값', now), null);
});

console.log(fail === 0 ? '\n=== 9/9 ===' : `\n=== 실패 ${fail} ===`);
if (fail > 0) process.exit(1);
