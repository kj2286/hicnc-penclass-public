import {
  compareSolutionsToPaper,
  mergeSolutionPages, solutionDirective, solutionFor, type SolutionsDoc } from '../src/lib/solutions.ts';

let pass = 0, fail = 0;
const test = (n: string, f: () => void) => {
  try { f(); pass++; console.log(`PASS  ${n}`); }
  catch (e) { fail++; console.log(`FAIL  ${n}\n      ${e instanceof Error ? e.message : e}`); }
};
const eq = (a: unknown, b: unknown, m = '') => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
};
const ok = (v: unknown, m = '') => { if (!v) throw new Error(m || '거짓'); };

const doc: SolutionsDoc = {
  v: 1,
  problems: [
    { stage: '계산력', no: 1, answer: '7 7/10', solution: null, page: 7 },
    { stage: '1단계', no: 1, answer: '0.8배', solution: '1.28÷1.6=0.8', page: 1 },
    { stage: '2단계', no: 1, answer: '112m²', solution: '□×4/7×3/8=24', page: 3 },
    { stage: null, no: 9, answer: '유일', solution: null, page: 1 },
  ],
};

test('단계+번호로 정확히 찾는다 — 표기가 흔들려도(계산식/1단계(기본))', () => {
  eq(solutionFor(doc, '1단계(기본)', 1)?.answer, '0.8배');
  eq(solutionFor(doc, '계산식', 1)?.answer, '7 7/10', '계산식→계산력 별칭');
  eq(solutionFor(doc, '2단계', 1)?.answer, '112m²');
});

test('단계마다 같은 번호가 있어도 섞이지 않는다', () => {
  // 1번이 세 단계에 다 있다 — 단계 없이 물으면 유일하지 않으므로 null
  eq(solutionFor(doc, undefined, 1), null);
  // 번호가 유일하면 단계 없이도 찾는다
  eq(solutionFor(doc, undefined, 9)?.answer, '유일');
});

test('없으면 null — 지시문도 빈 문자열', () => {
  eq(solutionFor(doc, '3단계', 1), null);
  eq(solutionDirective(null), '');
});

test('지시문 — 정답·모범 풀이·비교 지시(좋은점/부족한점/보완)가 들어간다', () => {
  const d = solutionDirective(solutionFor(doc, '1단계', 1));
  ok(d.includes('[정답] 0.8배'));
  ok(d.includes('[모범 풀이] 1.28÷1.6=0.8'));
  ok(d.includes('잘한 점') && d.includes('부족한 점') && d.includes('보완 방법'));
  // 서버 게이트(api/_analysis MODEL_SOLUTION_MARKER)와의 계약 — 헤더가 이 문구로 시작해야 한다
  ok(d.startsWith('## 모범 풀이·답안'), '서버가 이 마커로 블록 유무를 판정한다');
  ok(d.includes('modelComparison'), '구조화 필드 지시');
  // 답만 있는 계산력 — 모범 풀이 줄은 빠지고 정답만
  const d2 = solutionDirective(solutionFor(doc, '계산력', 1));
  ok(d2.includes('[정답] 7 7/10') && !d2.includes('[모범 풀이]'));
});


// ── mergeSolutionPages — 풀이+답안 PDF 인제스트의 병합 규칙 ──────────
test('병합 — 단계 제목은 다음 쪽으로 이어받고 page 는 손풀이 쪽 번호', () => {
  const d = mergeSolutionPages([
    { stageTitle: '1단계', problems: [{ no: 1, answer: '0.8배', solution: '풀이1' }] },
    { problems: [{ no: 5, answer: '34개', solution: '풀이5' }] }, // 제목 없음 → 1단계
    { stageTitle: '2단계', problems: [{ no: 1, answer: '112m²', solution: '풀이' }] },
  ]);
  eq(d.problems.length, 3);
  const p1 = d.problems.find((x) => x.stage === '1단계' && x.no === 5);
  eq(p1?.page, 2, '손풀이가 실린 쪽 번호');
  ok(d.problems.some((x) => x.stage === '2단계' && x.no === 1));
});

test('병합 — 정답표가 정본: 답을 덮고, 풀이 없는 문항은 답만으로 만든다', () => {
  const d = mergeSolutionPages([
    { stageTitle: '1단계', problems: [{ no: 1, answer: '0.8', solution: '풀이' }] },
    {
      answerTable: [
        { stage: '1단계', no: 1, answer: '0.8배' }, // 덮어쓰기
        { stage: '계산력', no: 3, answer: '$4\\frac{1}{2}$' }, // 신규(답만)
      ],
    },
  ]);
  const a = d.problems.find((x) => x.stage === '1단계' && x.no === 1);
  eq(a?.answer, '0.8배', '표의 값이 정본');
  eq(a?.solution, '풀이', '손풀이는 유지');
  const b = d.problems.find((x) => x.stage === '계산력' && x.no === 3);
  ok(b && b.solution == null, '계산력은 답만');
  eq(b?.page, 2, '답만 있는 문항은 정답표 쪽을 열람 이미지로 쓴다 (2026-09-02)');
});

test('병합 — 문항 영역(box)은 0~1 로 접혀 실리고, 정답표 문항은 표 영역을 받는다', () => {
  const d = mergeSolutionPages([
    { stageTitle: '1단계', problems: [{ no: 1, answer: 'a', solution: 's', box: { x0: 0.02, y0: 0.1, x1: 0.5, y1: 0.48 } }] },
    { answerTable: [{ stage: '계산력', no: 1, answer: '3' }], tableBox: { x0: 0.05, y0: 0.6, x1: 0.6, y1: 0.9 } },
  ]);
  const a = d.problems.find((x) => x.stage === '1단계' && x.no === 1);
  eq(a?.box, { x0: 0.02, y0: 0.1, x1: 0.5, y1: 0.48 });
  const c = d.problems.find((x) => x.stage === '계산력' && x.no === 1);
  eq(c?.page, 2); eq(c?.box, { x0: 0.05, y0: 0.6, x1: 0.6, y1: 0.9 });
  // 뒤집히거나 너무 작은 상자는 버린다
  const bad = mergeSolutionPages([{ stageTitle: '1단계', problems: [{ no: 2, answer: 'a', solution: 's', box: { x0: 0.5, y0: 0.5, x1: 0.5, y1: 0.5 } }] }]);
  eq(bad.problems[0].box, null);
});

test('병합 — 같은 문항이 두 쪽에 걸치면 첫 쪽을 남긴다', () => {
  const d = mergeSolutionPages([
    { stageTitle: '3단계', problems: [{ no: 8, answer: '637.2', solution: '앞쪽' }] },
    { problems: [{ no: 8, answer: '637.2', solution: '뒷쪽 이어짐' }] },
  ]);
  eq(d.problems.length, 1);
  eq(d.problems[0].solution, '앞쪽');
  eq(d.problems[0].page, 1);
});

test('병합 — 「계산식」 제목도 계산력으로 접혀 매칭된다', () => {
  const d = mergeSolutionPages([
    { stageTitle: '□ 계산식', problems: [{ no: 2, answer: 'x', solution: 's' }] },
  ]);
  eq(solutionFor(d, '계산력', 2)?.answer, 'x');
});


// ── 풀이+답안 ↔ 테스트지 대조 ──────────────────────────────────────────
const paperOf = (...items: Array<[string | null, number, string?]>) =>
  items.map(([stage, no, question]) => ({ stage, no, question }));

test('대조 — 구성·내용이 같으면 same', () => {
  const d = mergeSolutionPages([
    { stageTitle: '1단계', problems: [
      { no: 1, answer: '0.8배', solution: 's', question: '노란색 끈 1.6m 빨간색 끈 1.28m' },
      { no: 2, answer: 'x', solution: 's', question: '쌓기나무 11개를 사용하여' },
    ] },
  ]);
  const r = compareSolutionsToPaper(
    paperOf(['1단계', 1, '노란색 끈의 길이는 1.6m이고 빨간색 끈의 길이는 1.28m'], ['1단계', 2, '쌓기나무 11개']),
    d,
  );
  ok(r.same, r.issues.join(' / '));
  eq(r.paperCount, 2); eq(r.solutionCount, 2);
});

test('대조 — 문항 수·누락이 다르면 issue 로 나열된다', () => {
  const d = mergeSolutionPages([
    { stageTitle: '1단계', problems: [{ no: 1, answer: 'a', solution: 's' }] },
  ]);
  const r = compareSolutionsToPaper(
    paperOf(['1단계', 1], ['1단계', 2], ['2단계', 1]),
    d,
  );
  ok(!r.same);
  ok(r.issues.some((i) => i.includes('문항 수가 다릅니다')), r.issues.join('/'));
  ok(r.issues.some((i) => i.includes('풀이+답안에 없는 문항')), r.issues.join('/'));
});

test('대조 — 숫자 구성이 크게 다르면 "내용이 달라 보이는 문항"', () => {
  const d = mergeSolutionPages([
    { stageTitle: '1단계', problems: [
      { no: 1, answer: 'a', solution: 's', question: '원의 반지름이 8cm 이고 20cm' },
    ] },
  ]);
  const r = compareSolutionsToPaper(
    paperOf(['1단계', 1, '구슬 119개를 예나와 예서가 2:5 비로']),
    d,
  );
  ok(!r.same);
  ok(r.issues.some((i) => i.includes('내용이 달라')), r.issues.join('/'));
});

test('대조 — 지문이 한쪽에만 있으면 내용 판정은 보류한다', () => {
  const d = mergeSolutionPages([
    { stageTitle: '1단계', problems: [{ no: 1, answer: 'a', solution: 's' }] },
  ]);
  const r = compareSolutionsToPaper(paperOf(['1단계', 1, '구슬 119개 2:5']), d);
  ok(r.same, r.issues.join('/'));
});

console.log(`\n=== ${pass}/${pass + fail} ===`);
process.exit(fail === 0 ? 0 : 1);
