/**
 * 국어 5-Depth · 행동 심리 계산 회귀 테스트.
 * 마스터 프롬프트(2026-09-05)의 Output 2·3 이 이 계산에 기댄다.
 */
import {
  buildScatter,
  depthName,
  depthScoreRate,
  hesitationMs,
  hiddenKillers,
  instabilityIndex,
  isKoreanArea,
  revisionCounts,
  type KoreanDepthScore,
  type KoreanProblemStat,
} from '../src/lib/korean-analysis';

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

const D = (depth: 1 | 2 | 3 | 4 | 5, verdict: KoreanDepthScore['verdict']): KoreanDepthScore => ({
  depth,
  verdict,
  note: '',
});

test('Depth 이름', () => {
  eq(depthName(1), '조건·형식');
  eq(depthName(5), '영역 성취');
});

test('영역 판별', () => {
  eq(isKoreanArea('문학'), true);
  eq(isKoreanArea('기하'), false);
});

test('5-Depth 득점 — 충족 1, 부분 0.5', () => {
  eq(depthScoreRate([D(1, 'met'), D(2, 'met'), D(3, 'partial'), D(4, 'met'), D(5, 'met')]), 90);
  eq(depthScoreRate([D(1, 'missed'), D(2, 'missed')]), 0);
});

test('5-Depth 득점 — 해당 없음은 분모에서 뺀다', () => {
  eq(depthScoreRate([D(1, 'na'), D(2, 'met'), D(3, 'na')]), 100);
  eq(depthScoreRate([D(1, 'na')]), null);
  eq(depthScoreRate([]), null);
});

test('멈칫 시간 — 체류에서 실제 필기를 뺀 값', () => {
  eq(hesitationMs({ activeMs: 20_000, spanMs: 95_000 }), 75_000);
  eq(hesitationMs({ activeMs: 30_000, spanMs: 10_000 }), 0);
});

test('불안정도 — 매끄럽게 한 번에 쓰면 낮다', () => {
  const v = instabilityIndex({ activeMs: 50_000, spanMs: 52_000, attempts: 1, revisits: 0 });
  if (v > 10) throw new Error(`너무 높다: ${v}`);
});

test('불안정도 — 오래 멈추고 여러 번 시도하면 높다', () => {
  const v = instabilityIndex({
    activeMs: 20_000,
    spanMs: 200_000,
    attempts: 5,
    revisits: 3,
    revision: 'right_to_wrong',
  });
  if (v < 70) throw new Error(`너무 낮다: ${v}`);
});

test('불안정도 — 정답에서 오답으로 고친 쪽이 더 불안정하다', () => {
  const base = { activeMs: 30_000, spanMs: 60_000, attempts: 2, revisits: 1 } as const;
  const a = instabilityIndex({ ...base, revision: 'right_to_wrong' });
  const b = instabilityIndex({ ...base, revision: 'wrong_to_right' });
  if (!(a > b)) throw new Error(`${a} <= ${b}`);
});

const P = (
  label: string,
  correct: boolean,
  activeMs: number,
  spanMs: number,
  extra: Partial<KoreanProblemStat> = {},
): KoreanProblemStat => ({
  label,
  correct,
  activeMs,
  spanMs,
  attempts: 1,
  revisits: 0,
  ...extra,
});

test('숨은 킬러 — 맞혔는데 유난히 오래 멈칫한 문항만', () => {
  const stats = [
    P('1번', true, 10_000, 20_000), // 멈칫 10초
    P('2번', true, 10_000, 22_000), // 12초
    P('3번', true, 10_000, 120_000), // 110초 — 킬러
    P('4번', false, 10_000, 200_000), // 오답이라 제외
  ];
  eq(hiddenKillers(stats).map((s) => s.label), ['3번']);
});

test('숨은 킬러 — 다들 짧으면 아무도 안 걸린다', () => {
  const stats = [P('1번', true, 5_000, 8_000), P('2번', true, 5_000, 9_000)];
  eq(hiddenKillers(stats).length, 0);
});

test('산점도 — 반 평균이 있으면 X 에 그 값을, 없으면 본인 정오를', () => {
  const stats = [
    P('1번', true, 10_000, 40_000, { classCorrectRate: 62 }),
    P('2번', false, 10_000, 20_000),
  ];
  const pts = buildScatter(stats);
  eq(pts[0].x, 62);
  eq(pts[0].y, 30); // 30초
  eq(pts[1].x, 0);
});

test('수정 방향 집계', () => {
  const stats = [
    P('1번', true, 1, 1, { revision: 'wrong_to_right' }),
    P('2번', false, 1, 1, { revision: 'right_to_wrong' }),
    P('3번', true, 1, 1),
  ];
  const c = revisionCounts(stats);
  eq([c.wrong_to_right, c.right_to_wrong, c.unknown], [1, 1, 1]);
});

console.log(fail === 0 ? '\n=== 12/12 ===' : `\n=== 실패 ${fail} ===`);
if (fail > 0) process.exit(1);
