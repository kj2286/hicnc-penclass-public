import { carryStages, labelFor, pageNoOfKey } from '../src/lib/stage-carry.ts';
let pass = 0, fail = 0;
const test = (n: string, f: () => void) => {
  try { f(); pass++; console.log(`PASS  ${n}`); }
  catch (e) { fail++; console.log(`FAIL  ${n}\n      ${e instanceof Error ? e.message : e}`); }
};
const eq = (a: unknown, b: unknown, m = '') => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
};
const c = (no: number, group?: string) => ({
  id: `x#${no}${group ?? ''}`,
  label: labelFor(group, no),
  strokeIds: [],
  bbox: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
  meta: { no, type: '주관식', points: 0, question: '', choices: [], hasAnswerLine: false, numberX: 0, numberY: 0, ...(group ? { group } : {}) },
});

test('둘째 쪽 5~8번이 앞 쪽의 단계를 물려받는다 (박다민A 실구조)', () => {
  const out = carryStages([
    ['314', [c(1, '1단계'), c(2, '1단계'), c(3, '1단계'), c(4, '1단계')]],
    ['315', [c(5), c(6), c(7), c(8)]],
    ['316', [c(1, '2단계'), c(2, '2단계'), c(3, '2단계'), c(4, '2단계')]],
    ['317', [c(5), c(6), c(7), c(8)]],
  ]);
  eq(out[1][1].map((x) => x.label), ['1단계-5번', '1단계-6번', '1단계-7번', '1단계-8번']);
  eq(out[3][1].map((x) => x.label), ['2단계-5번', '2단계-6번', '2단계-7번', '2단계-8번']);
  // 라벨이 전부 유일해야 한다 — 중복이면 리포트에서 코멘트가 복제된다
  const labels = out.flatMap(([, cs]) => cs.map((x) => x.label));
  eq(labels.length, new Set(labels).size, '라벨 중복');
});

test('단계 표기가 없는 교재(표지 계산력)는 그대로 둔다', () => {
  const out = carryStages([['321', [c(1), c(2), c(3)]]]);
  eq(out[0][1].map((x) => x.label), ['1번', '2번', '3번']);
});

test('새 단계 제목이 나오면 거기서 갈아탄다', () => {
  const out = carryStages([
    ['a', [c(1, '1단계')]],
    ['b', [c(5)]],
    ['c', [c(1, '3단계')]],
    ['d', [c(5)]],
  ]);
  eq(out[1][1][0].label, '1단계-5번');
  eq(out[3][1][0].label, '3단계-5번');
});

test('교재를 섞어 넘기면 표지가 앞 교재의 단계를 물려받는다 — 호출부가 갈라야 한다', () => {
  // 이 테스트는 **경고**다: carryStages 는 한 교재 안에서만 부르라는 계약이다.
  const mixed = carryStages([
    ['319', [c(5)]],           // 문제지 마지막 쪽 (앞에서 3단계였다고 가정)
    ['321', [c(1), c(2)]],     // 표지 — 물려받으면 안 된다
  ]);
  eq(mixed[1][1].map((x) => x.label), ['1번', '2번'], '단계 없는 첫 페이지는 그대로');
  const wrong = carryStages([
    ['318', [c(1, '3단계')]],
    ['321', [c(1), c(2)]],
  ]);
  eq(wrong[1][1][0].label, '3단계-1번', '교재를 섞으면 이렇게 오염된다');
});

test('pageKey 에서 쪽 번호를 뽑아 정렬한다 (실사고 재현 방지)', () => {
  // 실제로 저장된 키 순서는 319,318,317,314,315,316 이었다 — 그대로 이어받으면
  // 317 의 5~8번이 3단계로 붙는다. 쪽 번호로 정렬하면 314부터 시작한다.
  const keys = ['3_54_0_319','3_54_0_318','3_54_0_317','3_54_0_314','3_54_0_315','3_54_0_316'];
  const sorted = [...keys].sort((a, b) => pageNoOfKey(a) - pageNoOfKey(b));
  eq(sorted, ['3_54_0_314','3_54_0_315','3_54_0_316','3_54_0_317','3_54_0_318','3_54_0_319']);

  const byKey: Record<string, ReturnType<typeof c>[]> = {
    '3_54_0_314': [c(1,'1단계'), c(2,'1단계'), c(3,'1단계'), c(4,'1단계')],
    '3_54_0_315': [c(5), c(6), c(7), c(8)],
    '3_54_0_316': [c(1,'2단계'), c(2,'2단계'), c(3,'2단계'), c(4,'2단계')],
    '3_54_0_317': [c(5), c(6), c(7), c(8)],
    '3_54_0_318': [c(1,'3단계'), c(2,'3단계'), c(3,'3단계'), c(4,'3단계')],
    '3_54_0_319': [c(5), c(6), c(7), c(8)],
  };
  const out = carryStages(sorted.map((k) => [k, byKey[k]] as const));
  const labels = out.flatMap(([, cs]) => cs.map((x) => x.label));
  eq(labels.length, new Set(labels).size, '라벨 중복');
  eq(out[3][1].map((x) => x.label), ['2단계-5번','2단계-6번','2단계-7번','2단계-8번'], '317 은 2단계여야 한다');
  eq(out[5][1].map((x) => x.label), ['3단계-5번','3단계-6번','3단계-7번','3단계-8번']);
});

console.log(`\n=== ${pass}/${pass + fail} ===`);
if (fail > 0) process.exit(1);
