/**
 * 내신 시험지 분석 계산 회귀 테스트 (수학 마스터 프롬프트 2026-09-05).
 */
import {
  anxietyIndex,
  buildExamChartRows,
  byType,
  feltDifficulty,
  hesitationCount,
  hoveringMs,
  pageFlows,
  summarizeExam,
  type ExamProblemInput,
} from '../src/lib/exam-report';

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

const P = (o: Partial<ExamProblemInput> & { label: string }): ExamProblemInput => ({
  points: 4,
  type: '객관식',
  verdict: 'correct',
  activeMs: 30_000,
  spanMs: 40_000,
  attempts: 1,
  revisits: 0,
  page: 1,
  ...o,
});

test('멈칫 시간·횟수', () => {
  eq(hoveringMs({ activeMs: 30_000, spanMs: 95_000 }), 65_000);
  eq(hesitationCount({ attempts: 3 }), 2);
  eq(hesitationCount({ attempts: 0 }), 0);
});

test('체감 난이도 — 멈춰 있던 비율로 가른다', () => {
  eq(feltDifficulty(0.1), '쉬움');
  eq(feltDifficulty(0.35), '보통');
  eq(feltDifficulty(0.55), '어려움');
  eq(feltDifficulty(0.8), '매우 어려움');
});

test('불안정도 1~10 — 매끈하면 1, 흔들리면 높다', () => {
  eq(anxietyIndex({ activeMs: 40_000, spanMs: 41_000, attempts: 1, revisits: 0 }), 1);
  const high = anxietyIndex({
    activeMs: 20_000,
    spanMs: 200_000,
    attempts: 5,
    revisits: 3,
    overwrites: 4,
  });
  if (high < 8) throw new Error(`너무 낮다: ${high}`);
});

test('총점·득점 — 부분 점수를 반영한다', () => {
  const s = summarizeExam([
    P({ label: '1번', points: 4, verdict: 'correct' }),
    P({ label: '2번', points: 5, verdict: 'wrong' }),
    P({ label: '3번', points: 6, type: '주관식', verdict: 'wrong', partialPoints: 3 }),
  ]);
  eq([s.totalPoints, s.earnedPoints], [15, 7]);
  eq([s.correct, s.wrong], [1, 2]);
});

test('배점을 하나도 못 읽으면 총점은 null (0점으로 속이지 않는다)', () => {
  const s = summarizeExam([P({ label: '1번', points: null }), P({ label: '2번', points: null })]);
  eq([s.totalPoints, s.earnedPoints], [null, null]);
});

test('요약 — 멈칫 비율로 체감 난이도가 나온다', () => {
  const s = summarizeExam([
    P({ label: '1번', activeMs: 10_000, spanMs: 100_000 }),
    P({ label: '2번', activeMs: 10_000, spanMs: 100_000 }),
  ]);
  eq(s.hoveringMs, 180_000);
  eq(s.felt, '매우 어려움');
});

test('페이지 흐름 — 페이지별로 묶고 속도 변화를 판정한다', () => {
  const flows = pageFlows([
    P({ label: '1번', page: 1, activeMs: 20_000, spanMs: 30_000, unit: '이차함수' }),
    P({ label: '2번', page: 1, activeMs: 20_000, spanMs: 30_000, unit: '이차함수' }),
    P({ label: '3번', page: 2, activeMs: 60_000, spanMs: 90_000, unit: '확률' }),
  ]);
  eq(flows.length, 2);
  eq([flows[0].page, flows[0].from, flows[0].to, flows[0].problems], [1, '1번', '2번', 2]);
  eq(flows[0].units, ['이차함수']);
  eq(flows[1].trend, '느려짐'); // 20초 → 60초
  eq(flows[0].trend, null); // 첫 페이지는 비교 대상이 없다
});

test('페이지를 모르는 문항은 흐름에서 버린다', () => {
  const flows = pageFlows([P({ label: '1번', page: null }), P({ label: '2번', page: 3 })]);
  eq(flows.map((f) => f.page), [3]);
});

test('차트 Raw Data — 부분 점수는 partial 로', () => {
  const rows = buildExamChartRows([
    P({ label: '1번', verdict: 'correct' }),
    P({ label: '2번', points: 6, verdict: 'wrong', partialPoints: 3 }),
    P({ label: '3번', verdict: 'wrong' }),
  ]);
  eq(rows.map((r) => r.isCorrect), [true, 'partial', false]);
  eq(rows[0].duration_sec, 40);
  eq(rows[0].hovering_sec, 10);
  eq(rows[0].overwrite_count, null);
});

test('유형별 집계 — 객관식/주관식 득점', () => {
  const t = byType([
    P({ label: '1번', type: '객관식', points: 4, verdict: 'correct' }),
    P({ label: '2번', type: '객관식', points: 4, verdict: 'wrong' }),
    P({ label: '3번', type: '주관식', points: 8, verdict: 'wrong', partialPoints: 4 }),
  ]);
  eq([t.객관식.count, t.객관식.correct, t.객관식.points, t.객관식.earned], [2, 1, 8, 4]);
  eq([t.주관식.count, t.주관식.points, t.주관식.earned], [1, 8, 4]);
});

test('빈 입력에도 안 터진다', () => {
  const s = summarizeExam([]);
  eq([s.totalPoints, s.correct, s.felt, s.avgAnxiety], [null, 0, '쉬움', 1]);
  eq(pageFlows([]), []);
  eq(buildExamChartRows([]), []);
});

console.log(fail === 0 ? '\n=== 11/11 ===' : `\n=== 실패 ${fail} ===`);
if (fail > 0) process.exit(1);
