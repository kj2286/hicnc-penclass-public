import { examSetTitle, isCoverPaper, sameExamSet } from '../src/lib/exam-set.ts';
let pass = 0, fail = 0;
const test = (n: string, f: () => void) => {
  try { f(); pass++; console.log(`PASS  ${n}`); }
  catch (e) { fail++; console.log(`FAIL  ${n}\n      ${e instanceof Error ? e.message : e}`); }
};
const eq = (a: unknown, b: unknown, m = '') => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
};

test('표지와 문제지는 같은 세트 이름이 된다', () => {
  const cover = '6-1(A형) 표지_테스트01_b4';
  const body = '6-1(A형) 문제 26-3_테스트01_b4';
  eq(examSetTitle(cover), '6-1(A형)_테스트01_b4');
  eq(examSetTitle(body), '6-1(A형)_테스트01_b4');
  eq(sameExamSet(cover, body), true);
});

test('인쇄본이 다르면 묶이지 않는다', () => {
  eq(sameExamSet('6-1(A형) 표지_테스트01_b4', '6-1(A형) 문제 26-3_테스트02'), false);
});

test('표지·문제 표기가 없는 제목은 그대로다', () => {
  eq(examSetTitle('제4회 JMC.K(4학년)_A4사이즈'), '제4회 JMC.K(4학년)_A4사이즈');
  eq(sameExamSet('제4회 JMC.K(4학년)', '제4회 JMC.K(4학년)'), false, '같은 제목은 세트가 아니다');
});

test('제목이 "표지" 뿐이면 지우지 않는다', () => {
  eq(examSetTitle('표지'), '표지');
});

test('표지 판별', () => {
  eq(isCoverPaper('6-1(A형) 표지_테스트01_b4'), true);
  eq(isCoverPaper('6-1(A형) 문제 26-3'), false);
});

console.log(`\n=== ${pass}/${pass + fail} ===`);
if (fail > 0) process.exit(1);
