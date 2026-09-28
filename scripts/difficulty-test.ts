import { formatDuration } from '../src/lib/duration.ts';
import {
  difficultyBand,
  medianActiveMs,
  perceivedDifficulty10,
  problemDifficulty10,
  finalVerdict,
} from '../src/lib/difficulty.ts';
let pass = 0, fail = 0;
const test = (n: string, f: () => void) => {
  try { f(); pass++; console.log(`PASS  ${n}`); }
  catch (e) { fail++; console.log(`FAIL  ${n}\n      ${e instanceof Error ? e.message : e}`); }
};
const eq = (a: unknown, b: unknown, m = '') => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
};

test('구간은 사용자 지정 그대로 (1-2 / 3-5 / 6-7 / 8-10)', () => {
  eq([1,2].map(difficultyBand), ['쉬움','쉬움']); // 라벨 개편 2026-09-02
  eq([3,4,5].map(difficultyBand), ['보통','보통','보통']);
  eq([6,7].map(difficultyBand), ['어려움','어려움']);
  eq([8,9,10].map(difficultyBand), ['매우 어려움','매우 어려움','매우 어려움']);
});

test('문제 난이도 4단계 → 10단계 대표값', () => {
  eq(problemDifficulty10('쉬움'), 2);
  eq(problemDifficulty10('보통'), 4);
  eq(problemDifficulty10('어려움'), 7);
  eq(problemDifficulty10('매우 어려움'), 9);
  eq(problemDifficulty10(undefined), 4);
});

test('체감 난이도 — 맞고 한 번에 끝냈으면 낮다', () => {
  eq(perceivedDifficulty10({ verdict:'correct', attempts:1, revisits:0, activeMs:10000 }, { medianActiveMs:10000 }), 3);
});

test('체감 난이도 — 틀리고 헤매면 높다', () => {
  eq(perceivedDifficulty10({ verdict:'wrong', attempts:5, revisits:2, activeMs:60000 }, { medianActiveMs:10000 }), 10);
});

test('손도 못 댄 문항은 9', () => {
  eq(perceivedDifficulty10({ verdict:'unknown', attempts:0, revisits:0, activeMs:0 }, { medianActiveMs:10000 }), 9);
});

test('중앙값은 활동 시간이 있는 문항만 센다', () => {
  eq(medianActiveMs([{activeMs:0},{activeMs:10},{activeMs:30}]), 20);
  eq(medianActiveMs([{activeMs:0}]), 0);
});

test('정답이 아니면 무조건 틀림 — 판정 불가는 없다', () => {
  eq(finalVerdict('correct'), 'correct');
  eq(finalVerdict('wrong'), 'wrong');
  eq(finalVerdict('unknown'), 'wrong');
  eq(finalVerdict('blank'), 'wrong');
  eq(finalVerdict(undefined), 'wrong');
});

test('시간은 60초부터 분으로 끊는다 (120초 → 2분)', () => {
  eq(formatDuration(120000), '2분');
  eq(formatDuration(132000), '2분 12초');
  eq(formatDuration(59000), '59초');
  eq(formatDuration(3600000), '1시간 0분');
  eq(formatDuration(4021900), '1시간 7분 2초');
});

console.log(`\n=== ${pass}/${pass + fail} ===`);
if (fail > 0) process.exit(1);
