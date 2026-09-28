import { formatDuration, formatTimecode, humanizeSeconds } from '../src/lib/duration.ts';
let pass = 0, fail = 0;
const test = (n: string, f: () => void) => {
  try { f(); pass++; console.log(`PASS  ${n}`); }
  catch (e) { fail++; console.log(`FAIL  ${n}\n      ${e instanceof Error ? e.message : e}`); }
};
const eq = (a: unknown, b: unknown, m = '') => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
};

test('길이 표기 — 사용자 지정 그대로', () => {
  eq(formatDuration(120000), '2분');
  eq(formatDuration(122000), '2분 2초');
  eq(formatDuration(59000), '59초');
  eq(formatDuration(4021900), '1시간 7분 2초');
});

test('재생 위치 표기', () => {
  eq(formatTimecode(34000), '0:34');
  eq(formatTimecode(3920000), '1:05:20');
});

test('글 속의 초를 시·분·초로 바꾼다', () => {
  eq(humanizeSeconds('333.8초 지점에서 2601.9초 멈춤'), '5분 34초 지점에서 43분 22초 멈춤');
  eq(humanizeSeconds('학생풀이시간 180초'), '학생풀이시간 3분');
  eq(humanizeSeconds('122초 걸렸다'), '2분 2초 걸렸다');
});

test('60초 미만은 건드리지 않는다 (설명 문구 보호)', () => {
  eq(humanizeSeconds('8초 이상 손을 뗀 것을 경계로'), '8초 이상 손을 뗀 것을 경계로');
  eq(humanizeSeconds('26초 필기'), '26초 필기');
});

test('수식 안은 손대지 않는다', () => {
  eq(humanizeSeconds('$120초$ 는 수식'), '$120초$ 는 수식');
});

test('시간 단위가 없는 숫자는 그대로', () => {
  eq(humanizeSeconds('문항 320개'), '문항 320개');
  eq(humanizeSeconds('시도 11회'), '시도 11회');
});

console.log(`\n=== ${pass}/${pass + fail} ===`);
if (fail > 0) process.exit(1);
