/**
 * 문항 디텍션 회귀 테스트 (npm test) — 2026-08-13 실사고 3건을 못 박는다.
 *
 *  ① 용지 밖 노이즈 dot 이 문항 영역을 페이지 밖으로 폭발시킴 (박시원 p.1 1번)
 *  ② 답란 줄에 쓴 답이 '최근접' 규칙으로 아래 문제에 붙어 사라짐 (김경수 p.5 3번)
 *  ③ 왼쪽 단 여백 필기가 직전에 풀던 오른쪽 단 문항으로 스냅돼 영역이 부풀음
 *
 * 순수 기하 모듈(problem-assign / stroke-sanitize)만 import 한다 — 브라우저·
 * 네트워크 의존이 없어 node 에서 그대로 돈다.
 */
import {
  assignStrokesToClusters,
  buildClustersFromStructure,
  normalizeClusterColumns,
  type StrokeLike,
} from '../src/lib/problem-assign';
import { clampRectToPaper, sanitizeStrokes } from '../src/lib/stroke-sanitize';
import { computeScore, gradeSignature } from '../src/lib/grade-score';
import type { ProblemCluster } from '../src/lib/problem-detect';

const PAPER = { Xmin: 0, Xmax: 88.6, Ymin: 0, Ymax: 125.3 };

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass += 1;
    console.log(`PASS  ${name}${detail ? '  — ' + detail : ''}`);
  } else {
    fail += 1;
    console.error(`FAIL  ${name}${detail ? '  — ' + detail : ''}`);
  }
}

/** 가로선 한 획 */
function stroke(
  id: string,
  startedAt: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  extra: Array<{ x: number; y: number }> = [],
): StrokeLike {
  return {
    id,
    startedAt,
    dots: [{ x: x0, y: y0 }, { x: x1, y: y1 }, ...extra],
  };
}

function cluster(id: string, label: string, box: number[]): ProblemCluster {
  const [minX, minY, maxX, maxY] = box;
  return { id, label, strokeIds: [], bbox: { minX, minY, maxX, maxY } };
}

// ── ① 노이즈 dot 정제 ────────────────────────────────────────────────
{
  const noisy = [
    stroke('a', 0, 10, 20, 12, 22, [{ x: 269.3, y: 151.3 }]), // 노이즈 1개 섞임
    stroke('b', 1, 300, 300, 310, 310), // 전부 용지 밖
    stroke('c', 2, 5, 5, 6, 6), // 정상
  ];
  const clean = sanitizeStrokes(noisy as never, PAPER);
  const dots = clean.reduce((a, s) => a + s.dots.length, 0);
  ok('① 용지 밖 dot 제거', dots === 4, `dot 7 → ${dots}`);
  ok('① 전부 밖인 획 제외', clean.length === 2 && !clean.some((s) => s.id === 'b'));
  ok(
    '① 정상 좌표는 보존',
    clean.find((s) => s.id === 'a')!.dots.length === 2,
  );
  const blown = clampRectToPaper(
    { minX: 0, minY: 0, maxX: 269.3, maxY: 217.5 },
    PAPER,
  );
  ok(
    '① 영역은 용지 안으로 잘림',
    blown.maxX === PAPER.Xmax && blown.maxY === PAPER.Ymax,
  );
}

// ── ② 답란 줄 → 바로 위 문제 ─────────────────────────────────────────
{
  const q3 = cluster('p#0', '3번', [0.9, 10, 43.9, 40]);
  const q4 = cluster('p#1', '4번', [0.9, 46, 43.9, 90]);
  // 두 박스 사이 빈 띠(y=43)에 쓴 답 — 4번 쪽이 더 가깝게 배치
  const ans = stroke('ans', 100_000, 20, 43, 30, 43.5);
  const res = assignStrokesToClusters([q3, q4], [ans]);
  ok(
    '② 답란 줄 필기는 바로 위 문제(3번)로',
    res[0].strokeIds.includes('ans') && res[1].strokeIds.length === 0,
  );
}

// ── ③ 다른 단으로 시간 스냅 금지 ─────────────────────────────────────
{
  const left = cluster('p#0', '1번', [0.9, 15, 43.9, 42]);
  const right = cluster('p#1', '5번', [44.7, 40, 87.7, 76]);
  const onRight = stroke('r1', 1_000, 50, 50, 55, 52); // 5번 안
  // 직후 1초 뒤 왼쪽 단 상단 여백(어떤 박스와도 안 겹침)에 낙서
  const leftMargin = stroke('l1', 2_000, 8, 14, 12, 14.5);
  const res = assignStrokesToClusters([left, right], [onRight, leftMargin]);
  ok('③ 오른쪽 단 필기는 5번 유지', res[1].strokeIds.includes('r1'));
  ok(
    '③ 왼쪽 단 여백 낙서가 5번으로 안 끌려감',
    !res[1].strokeIds.includes('l1') && res[0].strokeIds.includes('l1'),
  );
}

// ── ④ 영역 구조 확정 (답란 포함 · 단 폭 · 용지 안) ───────────────────
{
  const raw = [
    cluster('p#0', '1번', [2, 15, 20, 30]), // 폭 반쪽, 답란 못 미침
    cluster('p#1', '2번', [2, 42, 43, 60]),
    cluster('p#2', '4번', [45, 6, 87, 300]), // 페이지 밖까지 늘어난 거대 박스
  ];
  const out = normalizeClusterColumns(raw, PAPER);
  const [q1, q2, q4] = out;
  ok(
    '④ 1번 아래끝이 2번 시작 직전까지 (답란 포함)',
    q1.bbox.maxY > 40 && q1.bbox.maxY < q2.bbox.minY,
    `maxY=${q1.bbox.maxY.toFixed(1)}`,
  );
  ok(
    '④ 폭은 단 전체 — 왼쪽 단은 용지 왼끝부터 가운데까지',
    q1.bbox.minX === PAPER.Xmin && q1.bbox.maxX === PAPER.Xmax / 2,
    `${q1.bbox.minX}~${q1.bbox.maxX}`,
  );
  ok(
    '④ 거대 박스도 용지 안으로 (오른쪽 단은 가운데부터 오른끝까지)',
    q4.bbox.maxY <= PAPER.Ymax && q4.bbox.minX === PAPER.Xmax / 2,
    `maxY=${q4.bbox.maxY.toFixed(1)}`,
  );
}

// ── ⑤ 겹침 면적 우선 (옆 문제에 살짝 걸친 풀이) ──────────────────────
{
  const a = cluster('p#0', '1번', [0, 0, 44, 50]);
  const b = cluster('p#1', '2번', [0, 50, 44, 100]);
  // 대부분 1번 안, 아래로 살짝(10%) 2번에 걸침
  const s = stroke('s', 0, 10, 40, 20, 51);
  const res = assignStrokesToClusters([a, b], [s]);
  ok('⑤ 10% 걸쳐도 주로 쓴 문항(1번)으로', res[0].strokeIds.includes('s'));
}


// ── ⑥ 구조 인식 → 영역: 답란이 다음 문제 위에 있어도 정확히 가른다 ─────
// (2026-08-13 고유현 p.2 8번: 7번 답란을 8번 영역이 삼켜 거대 박스가 됨)
{
  const items = [
    { no: 7, column: 'left', questionY: 0.10, answerY: 0.40, points: 10,
      type: '객관식', question: '다음 중 옳은 것을 모두 고르시오', choices: ['a', 'b'] },
    { no: 8, column: 'left', questionY: 0.45, answerY: 0.72, points: 10,
      type: '객관식', question: '정비례 관계 그래프 설명', choices: ['원점을 지난다'] },
    { no: 9, column: 'left', questionY: 0.78, answerY: null, points: 10,
      type: '주관식', question: '계산하시오', choices: [] },
  ];
  const cs = buildClustersFromStructure('pg', items, PAPER);
  const [q7, q8, q9] = cs;
  const y = (r: number) => PAPER.Ymin + r * (PAPER.Ymax - PAPER.Ymin);
  ok('⑥ 7번 영역이 자기 답란까지 포함', q7.bbox.maxY > y(0.4), `maxY=${q7.bbox.maxY.toFixed(1)}`);
  ok(
    '⑥ 7번 답란이 8번 영역에 안 들어감',
    q8.bbox.minY > y(0.4),
    `8번 minY=${q8.bbox.minY.toFixed(1)} > 7번 답란 ${y(0.4).toFixed(1)}`,
  );
  ok('⑥ 8번 영역이 자기 답란까지', q8.bbox.maxY > y(0.72));
  ok('⑥ 8번이 9번 시작을 넘지 않음', q8.bbox.maxY <= y(0.78) + 0.01);
  ok('⑥ 답란 없는 9번은 페이지 하단까지', q9.bbox.maxY > y(0.9));
  ok('⑥ 지문·보기·배점이 meta 로 보존', q8.meta?.question?.includes('정비례') === true && q8.meta?.points === 10);
  ok('⑥ 라벨은 문제 번호', q7.label === '7번' && q9.label === '9번');
}

// ── ⑦ 2단 구성: 좌/우 단이 서로 침범하지 않는다 ──────────────────────
{
  const items = [
    { no: 1, column: 'left', questionY: 0.1, answerY: 0.3, type: '주관식', question: 'a', choices: [] },
    { no: 4, column: 'right', questionY: 0.1, answerY: 0.3, type: '주관식', question: 'b', choices: [] },
  ];
  const [l, r] = buildClustersFromStructure('pg', items, PAPER);
  ok('⑦ 왼쪽 단은 페이지 왼쪽 절반', l.bbox.maxX <= PAPER.Xmax / 2 + 0.01);
  ok('⑦ 오른쪽 단은 오른쪽 절반', r.bbox.minX >= PAPER.Xmax / 2 - 0.01);
  ok('⑦ 두 단이 겹치지 않음', l.bbox.maxX <= r.bbox.minX);
}


// ── ⑧ 채점: 100점 만점 환산 · 재호출 차단 서명 ────────────────────────
{
  const g = (no: number, verdict: string, points = 0) => ({
    problemId: `p#${no}`, no, label: `${no}번`, points,
    verdict: verdict as never, studentAnswer: '', correctAnswer: '',
    explanation: '', work: '', issues: [] as string[],
  });
  // 배점 미지정 4문항 중 3개 정답 → 75점
  const s1 = computeScore([g(1, 'correct'), g(2, 'correct'), g(3, 'correct'), g(4, 'wrong')]);
  ok('⑧ 배점 없으면 균등 배분해 100점 환산', s1.score === 75, `${s1.score}점`);
  ok('⑧ 정오 개수 집계', s1.correct === 3 && s1.wrong === 1);
  // 배점 명시(20점씩 5문항) 중 4개 정답 → 80점
  const s2 = computeScore([
    g(1, 'correct', 20), g(2, 'correct', 20), g(3, 'correct', 20),
    g(4, 'correct', 20), g(5, 'wrong', 20),
  ]);
  ok('⑧ 배점이 있으면 그대로 반영', s2.score === 80, `${s2.score}점`);
  // 안 푼 문제는 오답과 구분
  const s3 = computeScore([g(1, 'correct'), g(2, 'blank')]);
  // 정책 변경(2026-08-26): **정답이 아니면 무조건 틀림.** 안 푼 문항은 wrong 에
  // 포함되고, blank 는 "미응시" 표시용으로만 따로 센다.
  ok(
    '⑧ 안 푼 문제도 틀림으로 세고 blank 로 구분 표시',
    s3.blank === 1 && s3.wrong === 1 && s3.score === 50,
  );
}

{
  const base: ProblemCluster = {
    id: 'pg#0', label: '3번', strokeIds: ['a', 'b'],
    bbox: { minX: 0, minY: 0, maxX: 40, maxY: 40 },
    meta: { no: 3, type: '객관식', points: 10, question: 'q', choices: [], hasAnswerLine: true },
  };
  const same = { ...base, strokeIds: ['b', 'a'] }; // 순서만 다름
  const added = { ...base, strokeIds: ['a', 'b', 'c'] };
  ok('⑧ 획 순서가 달라도 서명 동일 → 재호출 안 함', gradeSignature(base) === gradeSignature(same));
  ok('⑧ 필기가 늘면 서명이 바뀜 → 다시 채점', gradeSignature(base) !== gradeSignature(added));
}


// ─────────────────────────────────────────────────────────────
// ⑥ 죽은 구역 없음 — 여백에 쓴 풀이가 문항에서 빠지지 않는다
//
// 2026-08-14 실사고: 5번 문항 **오른쪽 여백**에 쓴 전개가 어느 문항에도
// 안 잡혔다. 원인은 문항 영역이 "답:" 줄에서 잘리고 좌우도 1% 안쪽으로
// 물려 있어, 그 바깥이 아무 문항에도 속하지 않는 구역이었기 때문.
// 이제 용지 전체가 문항으로 덮이므로 어디에 써도 반드시 어딘가에 속한다.
// ─────────────────────────────────────────────────────────────
{
  const paper = { Xmin: 0, Xmax: 88.6, Ymin: 0, Ymax: 125.3 };
  const items = [
    { no: 4, column: 'left', questionY: 0.05, answerY: 0.12 },
    { no: 5, column: 'left', questionY: 0.2, answerY: 0.28 },
    { no: 6, column: 'left', questionY: 0.6, answerY: 0.7 },
  ];
  const cs = buildClustersFromStructure('p', items, paper);

  // 용지 전체가 덮이는지 — 격자로 훑어 어느 문항에도 안 드는 점을 찾는다
  const uncovered: string[] = [];
  for (let i = 0; i <= 20; i++) {
    for (let j = 0; j <= 20; j++) {
      const x = paper.Xmin + ((paper.Xmax - paper.Xmin) * i) / 20;
      const y = paper.Ymin + ((paper.Ymax - paper.Ymin) * j) / 20;
      const hit = cs.some(
        (c) =>
          x >= c.bbox.minX &&
          x <= c.bbox.maxX &&
          y >= c.bbox.minY &&
          y <= c.bbox.maxY,
      );
      if (!hit) uncovered.push(`(${x.toFixed(1)},${y.toFixed(1)})`);
    }
  }
  ok(
    '⑥ 용지에 죽은 구역이 없다 (어디에 써도 문항에 속한다)',
    uncovered.length === 0,
    uncovered.slice(0, 5).join(' '),
  );

  // 실사고 재현: 5번 문항의 **오른쪽 여백**(용지 오른끝 근처)에 쓴 풀이
  const q5 = cs.find((c) => c.meta?.no === 5)!;
  const marginStroke = {
    id: 'margin',
    startedAt: 0,
    dots: [
      { x: 80, y: 30 },
      { x: 86, y: 36 },
    ],
  };
  const assigned = assignStrokesToClusters(cs, [marginStroke]);
  const owner = assigned.find((c) => c.strokeIds.includes('margin'));
  ok(
    '⑥ 오른쪽 여백에 쓴 풀이가 5번에 붙는다',
    owner?.meta?.no === 5,
    `→ ${owner?.meta?.no ?? '(없음)'}번`,
  );

  // 답란 줄 아래(다음 문제 전)에 쓴 풀이도 그 문제 것
  const belowAnswer = {
    id: 'below',
    startedAt: 0,
    dots: [
      { x: 20, y: 50 },
      { x: 30, y: 52 },
    ],
  };
  const a2 = assignStrokesToClusters(cs, [belowAnswer]);
  ok(
    '⑥ 답란 아래 여백에 쓴 풀이도 그 문제 것',
    a2.find((c) => c.strokeIds.includes('below'))?.meta?.no === 5,
  );

  ok(
    '⑥ 답란 위치는 채점용으로 남아 있다',
    q5.meta?.hasAnswerLine === true,
  );

  // 마지막 문제는 용지 맨 아래까지
  const q6 = cs.find((c) => c.meta?.no === 6)!;
  ok('⑥ 마지막 문제는 용지 맨 아래까지', q6.bbox.maxY === paper.Ymax);
}

// ─────────────────────────────────────────────────────────────
// ⑦ 시험지 3구역 — 문제 / 풀이 공간 / 답란
// 채점 표시를 문제 번호 옆에 찍고, "풀이 없이 답만 썼는지" 를 가르는 근거다.
// ─────────────────────────────────────────────────────────────
{
  const paper = { Xmin: 0, Xmax: 88.6, Ymin: 0, Ymax: 125.3 };
  const cs = buildClustersFromStructure(
    'p',
    [
      {
        no: 5,
        column: 'left',
        questionY: 0.1,
        numberX: 0.08,
        questionBottomY: 0.3,
        answerY: 0.5,
      },
      { no: 6, column: 'left', questionY: 0.6 },
    ],
    paper,
  );
  const m = cs.find((c) => c.meta?.no === 5)!.meta!;

  ok('⑦ 문제 번호 x 를 모델 값에서 가져온다', Math.abs(m.numberX - 88.6 * 0.08) < 0.01, m.numberX);
  ok('⑦ 문제 번호 y = 문제 시작 줄', Math.abs(m.numberY - 125.3 * 0.1) < 0.01, m.numberY);
  ok('⑦ 풀이 공간은 지문 아래에서 시작', Math.abs(m.workTopY - 125.3 * 0.3) < 0.01, m.workTopY);
  ok('⑦ 답란 y 를 따로 보관', m.answerTopY != null && Math.abs(m.answerTopY - 125.3 * 0.5) < 0.01);
  ok('⑦ 순서가 뒤집히지 않는다 (번호 < 풀이 < 답란)',
    m.numberY < m.workTopY && m.workTopY < (m.answerTopY ?? Infinity));

  // 모델이 번호 x·지문 끝을 못 주면 기하로 어림한다
  const cs2 = buildClustersFromStructure(
    'p',
    [{ no: 1, column: 'left', questionY: 0.1 }],
    paper,
  );
  const m2 = cs2[0].meta!;
  ok('⑦ numberX 가 없으면 단 안쪽으로 어림', m2.numberX > paper.Xmin && m2.numberX < paper.Xmax * 0.2, m2.numberX);
  ok('⑦ 지문 끝이 없어도 풀이 공간은 문제 아래', m2.workTopY > m2.numberY);
  ok('⑦ 답란이 없으면 null', m2.answerTopY === null);
}


// ─────────────────────────────────────────────────────────────
// ⑧ 앞 문제 침범 금지 — 자기 번호 줄 위는 자기 것이 아니다
//
// 2026-08-17 실사고: 3번을 고르면 **2번의 풀이·답까지** 함께 잡혔다.
// 영역은 용지를 빈틈없이 덮으려고 위아래로 넓게 잡히지만, 배정까지 그 범위를
// 쓰면 위 문제의 필기를 가져간다. 배정 상한을 번호 줄로 자른다.
// ─────────────────────────────────────────────────────────────
{
  const paper = { Xmin: 0, Xmax: 88.6, Ymin: 0, Ymax: 125.3 };
  const cs = buildClustersFromStructure(
    'p',
    [
      { no: 2, column: 'left', questionY: 0.1, numberX: 0.05, answerY: 0.22 },
      { no: 3, column: 'left', questionY: 0.3, numberX: 0.05, answerY: 0.6 },
    ],
    paper,
  );
  const q2 = cs.find((c) => c.meta?.no === 2)!;
  const q3 = cs.find((c) => c.meta?.no === 3)!;

  // 2번 답란 줄(=0.22 부근)에 쓴 답 — 3번 시작(0.3)보다 위다
  const ans2 = {
    id: 'ans2',
    startedAt: 0,
    dots: [
      { x: 40, y: 125.3 * 0.23 },
      { x: 46, y: 125.3 * 0.24 },
    ],
  };
  // 3번 풀이 — 3번 시작 아래
  const work3 = {
    id: 'work3',
    startedAt: 60_000,
    dots: [
      { x: 30, y: 125.3 * 0.45 },
      { x: 38, y: 125.3 * 0.47 },
    ],
  };
  const a = assignStrokesToClusters(cs, [ans2, work3]);
  const owner = (sid: string) =>
    a.find((c) => c.strokeIds.includes(sid))?.meta?.no;

  ok('⑧ 2번 답란에 쓴 답은 2번 것', owner('ans2') === 2, `→ ${owner('ans2')}번`);
  ok('⑧ 3번 풀이는 3번 것', owner('work3') === 3, `→ ${owner('work3')}번`);
  ok(
    '⑧ 3번 영역은 자기 번호 줄 위로 안 올라간다',
    q3.meta!.numberY >= 125.3 * 0.3 - 0.01,
  );
  ok('⑧ 2번·3번이 서로 다른 문항으로 분리된다', q2.id !== q3.id);
}

{
  // 모델이 위 문제를 놓쳐 아래 문제가 '첫 문제'가 되어도 위를 삼키지 않는다
  const paper = { Xmin: 0, Xmax: 88.6, Ymin: 0, Ymax: 125.3 };
  const low = buildClustersFromStructure(
    'p',
    [{ no: 3, column: 'left', questionY: 0.55, numberX: 0.05 }],
    paper,
  );
  ok(
    '⑧ 페이지 중간에서 시작한 첫 문제는 위로 안 늘어난다',
    low[0].bbox.minY > paper.Ymax * 0.4,
    `minY=${low[0].bbox.minY.toFixed(1)}`,
  );
  const top = buildClustersFromStructure(
    'p',
    [{ no: 1, column: 'left', questionY: 0.08, numberX: 0.05 }],
    paper,
  );
  ok(
    '⑧ 페이지 위쪽 첫 문제는 여백까지 덮는다 (죽은 구역 방지)',
    top[0].bbox.minY === paper.Ymin,
  );
}


console.log(`\n=== ${pass}/${pass + fail} ===`);
if (fail > 0) process.exit(1);
