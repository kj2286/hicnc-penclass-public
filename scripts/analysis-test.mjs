/**
 * AI 분석 스키마 회귀 테스트 — LLM·하드웨어 불필요.
 *
 *   node scripts/analysis-test.mjs
 *
 * 대상: api/_analysis.ts 의 parseReport(모델 JSON → AnalysisReport)와
 * extractFeatures. 신규 필드(solution·psychology·issues)의 파싱과
 * 구버전 캐시(신규 필드 없음) 호환을 검증한다.
 */
import assert from 'node:assert/strict';
import {
  parseReport,
  extractFeatures,
  DEFAULT_ANALYSIS_PROMPT,
  CORE_ANALYSIS_RULES,
  LEARN_REPORT_SYSTEM,
  KOREAN_STYLE_RULES,
  analysisPromptFor,
  learnReportSystemFor,
  toAnalysisSubject,
  buildUserPrompt,
} from '../api/_analysis.ts';
import {
  buildProblemTimelines,
  formatProblemsContext,
  SEGMENT_GAP_MS,
} from '../src/lib/problem-timeline.ts';

let pass = 0;
let fail = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
    console.log(`PASS  ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}

const FULL = {
  headline: '고민 끝의 오답',
  overview: '요약입니다.',
  solution: {
    studentAnswer: '12',
    correctAnswer: '15',
    verdict: 'wrong',
    explanation: '나눗셈 단계에서 몫을 잘못 구했습니다.',
  },
  psychology: '초반에 자신 있게 시작했지만 중반 이후 망설임이 보입니다.',
  stages: [
    { fromMs: 0, toMs: 20000, title: '1단계', body: '식 세우기' },
    { fromMs: 20000, toMs: 60000, title: '2단계', body: '계산' },
  ],
  issues: [
    {
      fromMs: 25000,
      toMs: 31000,
      title: '몫 계산 오류',
      why: '300÷12 를 20 으로 적었습니다.',
      suggestion: '나눗셈 검산을 지도하세요.',
    },
  ],
  traits: { pace: 'p', corrections: 'r' },
  outcome: {
    status: 'attempted',
    reason: '2번 시도 후 같은 지점에서 멈춤 — 막힌 것으로 보입니다.',
    attempts: 2,
    revisits: 1,
    timeSpentMs: 95000,
    perceivedDifficulty: 'hard',
    difficultyNote: '비슷한 유형(5번)은 40초에 푼 것과 대비됩니다.',
  },
};

test('modelComparison — 있으면 정규화, 없거나 비면 null (2026-09-02)', () => {
  const withCmp = {
    ...FULL,
    modelComparison: {
      verdict: 'similar',
      summary: '순서만 다르고 같은 접근',
      studentApproach: '역수로 바꿔 곱함',
      modelApproach: '통분 후 나눔',
      difference: '통분 대신 역수',
      whyDifferent: '역수 곱셈이 익숙한 듯',
      mismatchNote: '',
      advice: '두 방법 모두 인정하되 검산 습관',
    },
  };
  const r = parseReport(JSON.stringify(withCmp), 'm');
  assert.equal(r.modelComparison.verdict, 'similar');
  assert.equal(r.modelComparison.difference, '통분 대신 역수');
  const none = parseReport(JSON.stringify({ ...FULL, modelComparison: null }), 'm');
  assert.equal(none.modelComparison, null);
  const empty = parseReport(JSON.stringify({ ...FULL, modelComparison: { verdict: 'same' } }), 'm');
  assert.equal(empty.modelComparison, null, '내용이 비면 null');
  const badVerdict = parseReport(JSON.stringify({ ...withCmp, modelComparison: { ...withCmp.modelComparison, verdict: 'maybe' } }), 'm');
  assert.equal(badVerdict.modelComparison.verdict, 'unknown');
  assert.ok(CORE_ANALYSIS_RULES.includes('modelComparison'), '불변 규칙에 비교 지시가 있다');
  assert.ok(CORE_ANALYSIS_RULES.includes('정답은 맞음'), '풀이 다른데 정답인 경우');
});

test('신규 스키마 전체 파싱 (solution·psychology·issues)', () => {
  const r = parseReport(JSON.stringify(FULL), 'test-model');
  assert.equal(r.headline, '고민 끝의 오답');
  assert.equal(r.solution.verdict, 'wrong');
  assert.equal(r.solution.correctAnswer, '15');
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].title, '몫 계산 오류');
  assert.ok(r.psychology.includes('망설임'));
  assert.equal(r.stages.length, 2);
  assert.equal(r.model, 'test-model');
});

test('구버전 응답(신규 필드 없음) 호환 — 기본값 채움', () => {
  const legacy = {
    headline: 'h',
    overview: 'o',
    stages: [{ fromMs: 0, toMs: 1000, title: 't', body: 'b' }],
    traits: { pace: '', pressure: '', corrections: '' },
  };
  const r = parseReport(JSON.stringify(legacy), 'm');
  assert.deepEqual(r.issues, []);
  assert.equal(r.psychology, '');
  assert.equal(r.solution.verdict, 'unknown');
  assert.equal(r.solution.studentAnswer, '');
});

test('마크다운 펜스(```json) 제거 후 파싱', () => {
  const r = parseReport('```json\n' + JSON.stringify(FULL) + '\n```', 'm');
  assert.equal(r.solution.verdict, 'wrong');
});

test('verdict 이상값은 unknown 으로 정규화', () => {
  const bad = { ...FULL, solution: { ...FULL.solution, verdict: 'maybe' } };
  const r = parseReport(JSON.stringify(bad), 'm');
  assert.equal(r.solution.verdict, 'unknown');
});

test('빈 issue(제목·이유 없음)는 걸러진다', () => {
  const withEmpty = {
    ...FULL,
    issues: [...FULL.issues, { fromMs: 0, toMs: 0, title: '', why: '' }],
  };
  const r = parseReport(JSON.stringify(withEmpty), 'm');
  assert.equal(r.issues.length, 1);
});

test('음수·문자 시간은 0 으로 클램프', () => {
  const weird = {
    ...FULL,
    issues: [{ fromMs: -5, toMs: 'x', title: 't', why: 'w', suggestion: '' }],
  };
  const r = parseReport(JSON.stringify(weird), 'm');
  assert.equal(r.issues[0].fromMs, 0);
  assert.equal(r.issues[0].toMs, 0);
});

test('headline 없으면 기본값으로 복구한다 (오류 화면 금지 — 2026-08-18)', () => {
  const r = parseReport(JSON.stringify({ stages: [] }), 'm');
  assert.equal(r.headline, '분석 요약');
});

test('JSON 아님 → 원문을 개요로 삼은 최소 리포트 (절대 던지지 않는다)', () => {
  const r = parseReport('그냥 텍스트', 'm');
  assert.match(r.headline, /분석 요약/);
  assert.match(r.overview, /그냥 텍스트/);
  assert.deepEqual(r.stages, []);
});

test('JSON 앞뒤에 설명이 붙어도 본문만 잘라 파싱한다', () => {
  const r = parseReport(
    '설명입니다.\n{"headline":"h","overview":"o","stages":[],}\n끝.',
    'm',
  );
  assert.equal(r.headline, 'h'); // 후행 쉼표까지 관용
});

test('extractFeatures — 멈춤·버스트 요약 생성', () => {
  const mk = (t0, n) => ({
    pageNumber: 1,
    startedAt: t0,
    endedAt: t0 + n * 20,
    dots: Array.from({ length: n }, (_, i) => ({
      x: i,
      y: i,
      pressure: 400,
      maxPressure: 852,
      timeStamp: t0 + i * 20,
    })),
  });
  // 0~1초 필기 → 5초 멈춤 → 6초부터 필기
  const f = extractFeatures([mk(0, 50), mk(6000, 50)]);
  assert.equal(f.strokeCount, 2);
  assert.equal(f.pauses.length, 1);
  assert.ok(f.pauses[0].durMs >= 4000);
  assert.ok(f.summaryText.includes('멈춤'));
});

test('outcome(펜 데이터 결과 판정) 파싱', () => {
  const r = parseReport(JSON.stringify(FULL), 'm');
  assert.equal(r.outcome.status, 'attempted');
  assert.equal(r.outcome.attempts, 2);
  assert.equal(r.outcome.revisits, 1);
  assert.equal(r.outcome.perceivedDifficulty, 'hard');
  assert.ok(r.outcome.reason.includes('막힌'));
});

test('outcome 없거나 이상값이면 unknown 기본값', () => {
  const legacy = { headline: 'h', stages: [], traits: {} };
  const r = parseReport(JSON.stringify(legacy), 'm');
  assert.equal(r.outcome.status, 'unknown');
  assert.equal(r.outcome.perceivedDifficulty, 'unknown');
  const bad = { ...FULL, outcome: { ...FULL.outcome, status: '??', perceivedDifficulty: 'x' } };
  const r2 = parseReport(JSON.stringify(bad), 'm');
  assert.equal(r2.outcome.status, 'unknown');
  assert.equal(r2.outcome.perceivedDifficulty, 'unknown');
});

test('traits 에 필압(pressure)은 더 이상 없다', () => {
  const withP = { ...FULL, traits: { pace: 'p', pressure: 'q', corrections: 'r' } };
  const r = parseReport(JSON.stringify(withP), 'm');
  assert.equal(r.traits.pressure, undefined, '모델이 줘도 버린다');
  assert.equal(r.traits.pace, 'p');
});

test('피처 요약에 필압이 등장하지 않는다', () => {
  const mk = (t0) => ({
    pageNumber: 1, startedAt: t0, endedAt: t0 + 500,
    dots: [{ x: 0, y: 0, pressure: 1, maxPressure: 1, timeStamp: t0 }],
  });
  const f = extractFeatures([mk(0), mk(1000)]);
  assert.ok(!f.summaryText.includes('필압'));
});

// ── 문항 타임라인 (펜 데이터 → 시도·재방문) ──

const TL_STROKE = (id, from, to) => ({ id, startedAt: from, endedAt: to });

test('타임라인: 8초+ 공백으로 시도(세그먼트)가 나뉜다', () => {
  const strokes = [
    TL_STROKE('a', 0, 2000),
    TL_STROKE('b', 3000, 5000),          // 같은 시도 (1초 갭)
    TL_STROKE('c', 5000 + SEGMENT_GAP_MS + 1000, 20000), // 새 시도
  ];
  const [t] = buildProblemTimelines(strokes, [{ id: 'q1', label: '1번', strokeIds: ['a','b','c'] }], 0);
  assert.equal(t.segments.length, 2);
  assert.equal(t.revisits, 0, '사이에 다른 문항 필기 없음 = 복귀 아님');
});

test('타임라인: 다른 문항을 풀다 돌아오면 revisit', () => {
  const strokes = [
    TL_STROKE('a', 0, 2000),
    TL_STROKE('x', 4000, 9000),   // 그 사이 2번 문항
    TL_STROKE('b', 15000, 18000), // 1번으로 복귀
  ];
  const problems = [
    { id: 'q1', label: '1번', strokeIds: ['a', 'b'] },
    { id: 'q2', label: '2번', strokeIds: ['x'] },
  ];
  const [t1] = buildProblemTimelines(strokes, problems, 0);
  assert.equal(t1.label, '1번', '처음 손댄 순 정렬');
  assert.equal(t1.segments.length, 2);
  assert.equal(t1.revisits, 1);
});

test('타임라인: 활동 시간은 공백 제외 합', () => {
  const strokes = [TL_STROKE('a', 0, 3000), TL_STROKE('b', 20000, 25000)];
  const [t] = buildProblemTimelines(strokes, [{ id: 'q', label: '3번', strokeIds: ['a','b'] }], 0);
  assert.equal(t.activeMs, 8000);   // 3s + 5s
  assert.equal(t.spanMs, 25000);    // 체류는 전체
});

test('컨텍스트 텍스트: 시도·복귀·현재 대상 표시', () => {
  const strokes = [
    TL_STROKE('a', 0, 2000), TL_STROKE('x', 4000, 9000), TL_STROKE('b', 15000, 18000),
  ];
  const problems = [
    { id: 'q1', label: '1번', strokeIds: ['a', 'b'] },
    { id: 'q2', label: '2번', strokeIds: ['x'] },
    { id: 'q3', label: '7번', strokeIds: [] },
  ];
  const text = formatProblemsContext(buildProblemTimelines(strokes, problems, 0), 'q1');
  assert.ok(text.includes('1번'));
  assert.ok(text.includes('★현재 분석 대상'));
  assert.ok(text.includes('복귀 1회'));
  assert.ok(text.includes('7번: 필기 없음'), '손대지 않은 문항도 명시');
});

test('프롬프트가 심리·문제점·정답·펜데이터 판정을 지시하고 필압을 금지한다', () => {
  assert.ok(DEFAULT_ANALYSIS_PROMPT.includes('심리 상태'));
  assert.ok(DEFAULT_ANALYSIS_PROMPT.includes('issues'));
  assert.ok(DEFAULT_ANALYSIS_PROMPT.includes('정답'));
  assert.ok(DEFAULT_ANALYSIS_PROMPT.includes('풀이 과정을 서사로'));
  assert.ok(DEFAULT_ANALYSIS_PROMPT.includes('필압은 언급 금지'));
  assert.ok(DEFAULT_ANALYSIS_PROMPT.includes('outcome'));
  assert.ok(DEFAULT_ANALYSIS_PROMPT.includes('시간 부족'));
});

test('프롬프트가 시간 나열을 막고 진단을 요구한다', () => {
  // 사용자 요구 2026-08-25: raw 초 나열 대신 문제점·장단점 중심으로.
  assert.ok(DEFAULT_ANALYSIS_PROMPT.includes('시간 언급은 최소로'));
  assert.ok(DEFAULT_ANALYSIS_PROMPT.includes('초 단위로 환산하지 마세요'));
  assert.ok(DEFAULT_ANALYSIS_PROMPT.includes('관찰이 아니라 **진단**'));
});

test('필기 통계의 시간은 분·초로 사람이 읽게 준다', () => {
  const f = extractFeatures(
    [
      { id: 'a', startedAt: 0, endedAt: 1000, dots: [{ x: 0, y: 0, force: 1, t: 0 }] },
      { id: 'b', startedAt: 200000, endedAt: 201000, dots: [{ x: 1, y: 1, force: 1, t: 200000 }] },
    ],
  );
  assert.ok(!/\d+\.\ds\b/.test(f.summaryText), `raw 초 표기가 남아 있다: ${f.summaryText}`);
  assert.ok(/분/.test(f.summaryText), `분 표기가 없다: ${f.summaryText}`);
});

test('프롬프트가 서술형(narrative)을 시각 표기 없이 지시한다', () => {
  // 사용자 요구 2026-08-24: 시간대 나열 대신 과정에서 느껴진 것을 글로.
  assert.ok(DEFAULT_ANALYSIS_PROMPT.includes('narrative'));
  assert.ok(DEFAULT_ANALYSIS_PROMPT.includes('시각 표기와 단계 나열은 쓰지 마세요'));
});

test('narrative 는 파싱되고, 없던 구버전 응답도 빈 문자열로 채워진다', () => {
  const withNarr = parseReport(
    JSON.stringify({ headline: 'h', overview: 'o', narrative: '과정 서술', stages: [] }),
    'test-model',
  );
  assert.equal(withNarr.narrative, '과정 서술');
  const legacy = parseReport(
    JSON.stringify({ headline: 'h', overview: 'o', stages: [] }),
    'test-model',
  );
  assert.equal(legacy.narrative, '');
});

test('리포트 프롬프트 3종이 사용자 지정대로 들어 있다', () => {
  // 사용자가 준 프롬프트(2026-08-26). 문자열이 끊기면(백틱 사고) 여기서 잡힌다.
  assert.ok(LEARN_REPORT_SYSTEM.includes('## 체감도 총평'), '학습자 결과분석 구성');
  assert.ok(LEARN_REPORT_SYSTEM.includes('심리적 취약 구간'));
  assert.ok(LEARN_REPORT_SYSTEM.includes('우선 복습 목록'), '우선학습 프롬프트');
  assert.ok(LEARN_REPORT_SYSTEM.includes('원포인트 개념 학습 필요'));
  assert.ok(LEARN_REPORT_SYSTEM.includes('## 핵심 키워드'), '종합분석 구성');
  assert.ok(LEARN_REPORT_SYSTEM.includes('5:5'));
  assert.ok(!LEARN_REPORT_SYSTEM.includes('actual_difficulty'), '변수명 노출 금지');
  assert.ok(LEARN_REPORT_SYSTEM.length > 2000, '프롬프트가 잘렸다');
});

test('코어 규칙 — 커스텀 프롬프트가 있어도 병합될 불변 지시', () => {
  assert.ok(CORE_ANALYSIS_RULES.includes('[불변 규칙'));
  assert.ok(CORE_ANALYSIS_RULES.includes('필압 언급 금지'));
  assert.ok(CORE_ANALYSIS_RULES.includes('solution 필수'));
  assert.ok(CORE_ANALYSIS_RULES.includes('outcome 필수'));
});

test('한글 문체 규칙이 과정분석·학습리포트 프롬프트에 모두 들어 있다', () => {
  // 리포트는 학부모가 읽는다 — 번역투 차단을 생성 시점에 건다.
  assert.ok(KOREAN_STYLE_RULES.includes('번역투'));
  assert.ok(KOREAN_STYLE_RULES.includes('~을 통해'));
  assert.ok(KOREAN_STYLE_RULES.includes('결론적으로'));
  assert.ok(DEFAULT_ANALYSIS_PROMPT.includes(KOREAN_STYLE_RULES));
  assert.ok(LEARN_REPORT_SYSTEM.includes(KOREAN_STYLE_RULES));
});

// ── 과목별 프롬프트 (027) ──

test('수학 프롬프트는 한 글자도 달라지지 않는다', () => {
  // 여기가 어긋나면 기존 분석 캐시·동작이 통째로 흔들린다.
  assert.equal(analysisPromptFor('수학'), DEFAULT_ANALYSIS_PROMPT);
  // 기본 문구는 **한 글자도 바뀌지 않고**, 내신 지침만 뒤에 붙는다
  assert.ok(learnReportSystemFor('수학').startsWith(LEARN_REPORT_SYSTEM));
  assert.ok(learnReportSystemFor('수학').includes('총점 대비 득점'));
  assert.ok(learnReportSystemFor('수학').includes('필압은 언급하지 마세요'));
});

test('모르는 과목·미지정은 수학으로 접는다', () => {
  assert.equal(toAnalysisSubject(undefined), '수학');
  assert.equal(toAnalysisSubject('한문'), '수학');
  assert.equal(toAnalysisSubject('과학'), '과학');
  assert.equal(analysisPromptFor(toAnalysisSubject(null)), DEFAULT_ANALYSIS_PROMPT);
});

test('국어·영어·과학 분석 프롬프트가 골격을 지킨다', () => {
  for (const subject of ['국어', '영어', '과학']) {
    const p = analysisPromptFor(subject);
    assert.ok(p.includes(`${subject} 학습 코치`), `${subject}: 역할`);
    assert.ok(p !== DEFAULT_ANALYSIS_PROMPT, `${subject}: 수학과 같으면 안 된다`);
    // 골격 — 수학과 공유하는 규칙
    assert.ok(p.includes('필압은 언급 금지'), `${subject}: 필압`);
    assert.ok(p.includes('지어내지 마세요'), `${subject}: 지어내기 금지`);
    assert.ok(p.includes('outcome'), `${subject}: outcome`);
    assert.ok(p.includes('attempts/revisits/timeSpentMs'), `${subject}: 실측 전달`);
    assert.ok(p.includes('perceivedDifficulty'), `${subject}: 체감 난이도`);
    assert.ok(p.includes('psychology'), `${subject}: 심리`);
    assert.ok(p.includes('issues'), `${subject}: 문제점`);
    assert.ok(p.includes('narrative'), `${subject}: 서술`);
    assert.ok(p.includes('시간 언급은 최소로'), `${subject}: 시간 나열 금지`);
    assert.ok(p.includes(KOREAN_STYLE_RULES), `${subject}: 한글 문체 규칙`);
  }
});

test('과목별 판정 규칙이 실제로 갈린다', () => {
  const ko = analysisPromptFor('국어');
  assert.ok(ko.includes('근거 찾기·지문 독해·조건 준수'));
  assert.ok(ko.includes('정답 근거를 지문에서 직접 짚어'));
  assert.ok(ko.includes('글자 수·형식'), '서술형 조건 준수');

  const en = analysisPromptFor('영어');
  assert.ok(en.includes('번역하지 마세요'));
  assert.ok(en.includes('시제·수일치·어순'));
  assert.ok(en.includes('오역'));

  const sci = analysisPromptFor('과학');
  assert.ok(sci.includes('자료(그래프·표) 해석'));
  assert.ok(sci.includes('단위·공식 적용 오류'));
  assert.ok(sci.includes('근거와 단위를 함께 썼는지'));
});

test('과목별 리포트 프롬프트 — 교사·mistake 만 갈리고 구성은 그대로', () => {
  for (const subject of ['국어', '영어', '과학']) {
    const r = learnReportSystemFor(subject);
    assert.ok(r.includes(`${subject} 교사입니다.`), `${subject}: 역할`);
    assert.ok(!r.includes('수학 교사입니다.'), `${subject}: 수학 역할이 남았다`);
    // 세 분석 글의 구성은 과목이 달라도 같아야 리포트를 견줄 수 있다
    assert.ok(r.includes('## 체감도 총평'), `${subject}: 학습자 결과분석 구성`);
    assert.ok(r.includes('우선 복습 목록'), `${subject}: 우선학습`);
    assert.ok(r.includes('## 핵심 키워드'), `${subject}: 종합분석 구성`);
    assert.ok(r.includes(KOREAN_STYLE_RULES), `${subject}: 한글 문체 규칙`);
    assert.ok(
      !r.includes('계산·부호·옮겨적기'),
      `${subject}: 수학 실수 정의가 남았다`,
    );
  }
  assert.ok(learnReportSystemFor('국어').includes('선택지 판단·조건 확인'));
  assert.ok(learnReportSystemFor('영어').includes('어휘·문법'));
  assert.ok(learnReportSystemFor('과학').includes('단위·계산·자료'));
});

// ── 국어 마스터 프롬프트 (2026-09-05) — 5-Depth × 행동 심리가 유저 프롬프트에 실린다 ──
const FEATURES = {
  totalMs: 120000,
  strokeCount: 30,
  pageCount: 1,
  bursts: [],
  pauses: [],
  avgPressure: 0,
  summaryText: '총 필기 시간 2분',
};

test('국어 — 5-Depth 지시와 korean 스키마가 유저 프롬프트에 들어간다', () => {
  const up = buildUserPrompt({ features: FEATURES, ocrText: '지문', subject: '국어' });
  for (const needle of [
    'Depth 1 조건·형식',
    'Depth 5 영역 성취',
    'wrong_to_right',
    '"korean": {',
    '"coaching"',
  ]) {
    assert.ok(up.includes(needle), `국어 프롬프트에 "${needle}" 없음`);
  }
});

test('국어 — 필압 사용을 명시적으로 막는다', () => {
  const up = buildUserPrompt({ features: FEATURES, ocrText: '지문', subject: '국어' });
  assert.ok(up.includes('필압은 쓰지 마세요'), '필압 금지 문구 없음');
});

test('수학·영어·과학에는 국어 블록이 붙지 않는다', () => {
  for (const subject of ['수학', '영어', '과학', undefined]) {
    const up = buildUserPrompt({ features: FEATURES, ocrText: '지문', subject });
    assert.ok(!up.includes('"korean": {'), `${subject} 에 korean 스키마가 붙었다`);
    assert.ok(!up.includes('Depth 1 조건·형식'), `${subject} 에 5-Depth 지시가 붙었다`);
  }
});

test('과목 블록은 앞쪽(solution 뒤)에 놓여 응답이 잘려도 살아남는다', () => {
  // 🚨 실사고 2026-09-05: exam 블록을 traits 뒤(맨 끝)에 두었더니 수학 응답이
  // issues 중간에서 잘려 exam 이 통째로 사라졌다. 앞으로 옮겨 고정한다.
  for (const [subject, key] of [['국어', '"korean": {'], ['수학', '"exam": {']]) {
    const up = buildUserPrompt({ features: FEATURES, ocrText: '지문', subject });
    const at = up.indexOf(key);
    assert.ok(at > 0, `${subject} 스키마에 ${key} 없음`);
    assert.ok(at < up.indexOf('"stages": ['), `${subject} 블록이 stages 보다 뒤에 있다`);
    assert.ok(at > up.indexOf('"solution": {'), `${subject} 블록이 solution 보다 앞에 있다`);
  }
});

test('스키마 JSON 의 중괄호가 균형을 이룬다', () => {
  for (const subject of ['국어', '수학', '영어', '과학']) {
    const up = buildUserPrompt({ features: FEATURES, ocrText: '지문', subject });
    const start = up.indexOf('{\n  "headline"');
    const json = up.slice(start, up.lastIndexOf('}') + 1);
    const open = (json.match(/{/g) || []).length;
    const close = (json.match(/}/g) || []).length;
    assert.equal(open, close, `${subject} 중괄호 불균형 ${open} vs ${close}`);
  }
});

test('수학 — 내신 행동 데이터(번복·블록) 지시와 exam 스키마가 붙는다', () => {
  const up = buildUserPrompt({ features: FEATURES, ocrText: '문항', subject: '수학' });
  for (const needle of ['내신 시험지 행동 데이터', '"exam": {', '"overwrites"', '"blockNote"']) {
    assert.ok(up.includes(needle), `수학 프롬프트에 "${needle}" 없음`);
  }
  assert.ok(up.includes('필압은 쓰지 마세요'), '필압 금지 문구 없음');
});

test('국어·영어·과학에는 exam 블록이 붙지 않는다', () => {
  for (const subject of ['국어', '영어', '과학']) {
    const up = buildUserPrompt({ features: FEATURES, ocrText: '문항', subject });
    assert.ok(!up.includes('"exam": {'), `${subject} 에 exam 스키마가 붙었다`);
  }
});

test('과목 미지정은 수학으로 보고 exam 블록을 붙인다', () => {
  const up = buildUserPrompt({ features: FEATURES, ocrText: '문항' });
  assert.ok(up.includes('"exam": {'), '미지정에 exam 스키마가 없다');
});

// ── parseReport 가 과목 블록을 **버리지 않는지** (2026-09-05 실사고) ──
// 모델 응답 JSON 에는 korean 이 있는데 화이트리스트 조립이 통째로 버려서,
// 프롬프트는 맞는데 화면에는 아무것도 안 떴다. 실제 Gemini 응답으로 확인 후 고침.
test('parseReport — 국어 korean 블록을 살려서 넘긴다', () => {
  const raw = JSON.stringify({
    headline: 'h',
    korean: {
      area: '독서',
      depths: [
        { depth: 1, verdict: 'met', note: '30자 이내를 지킴' },
        { depth: 4, verdict: 'partial', note: '근거가 일부만' },
      ],
      behavior: {
        confidence: 'medium',
        confidenceNote: '멈춤이 길었다',
        overloadNote: '24초 구간',
        revision: 'wrong_to_right',
        revisionNote: '고쳐 씀',
      },
      coaching: '뼈대를 먼저 적기',
    },
  });
  const r = parseReport(raw, 'm');
  assert.equal(r.korean?.area, '독서');
  assert.equal(r.korean?.depths.length, 2);
  assert.equal(r.korean?.depths[1].verdict, 'partial');
  assert.equal(r.korean?.behavior.revision, 'wrong_to_right');
  assert.equal(r.korean?.coaching, '뼈대를 먼저 적기');
});

test('parseReport — 수학 exam 블록을 살리고, 못 센 값은 null 로 둔다', () => {
  const r = parseReport(
    JSON.stringify({
      headline: 'h',
      exam: {
        overwrites: 2,
        overwriteNote: '판별식을 지움',
        partialPoints: null,
        blockNote: '전개에서 멈춤',
      },
    }),
    'm',
  );
  assert.equal(r.exam?.overwrites, 2);
  assert.equal(r.exam?.partialPoints, null);
  assert.equal(r.exam?.blockNote, '전개에서 멈춤');
});

test('parseReport — 블록이 없거나 비면 null (빈 카드를 그리지 않는다)', () => {
  const none = parseReport(JSON.stringify({ headline: 'h' }), 'm');
  assert.equal(none.korean, null);
  assert.equal(none.exam, null);
  const empty = parseReport(
    JSON.stringify({ headline: 'h', korean: { area: '', depths: [], coaching: '' } }),
    'm',
  );
  assert.equal(empty.korean, null);
});

test('parseReport — 이상한 verdict·depth 는 안전한 값으로 접는다', () => {
  const r = parseReport(
    JSON.stringify({
      headline: 'h',
      korean: {
        depths: [{ depth: 9, verdict: '아무거나', note: 'x' }],
        behavior: { confidence: '엄청남', revision: '???' },
        coaching: 'c',
      },
    }),
    'm',
  );
  assert.equal(r.korean?.depths[0].depth, 5);
  assert.equal(r.korean?.depths[0].verdict, 'na');
  assert.equal(r.korean?.behavior.confidence, 'unknown');
  assert.equal(r.korean?.behavior.revision, 'unknown');
});

console.log(`\n=== ${pass}/${pass + fail} ===`);
process.exit(fail === 0 ? 0 : 1);
