import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  analysisPromptFor, buildUserPrompt, CORE_ANALYSIS_RULES, extractFeatures,
  isCurrentAssessment as serverCurrent, learnReportSystemFor, runAnalysisLLM, runLearnReportLLM,
} from '../api/_analysis';
import { ASSESSMENT_VERSION, fullAnalysisKey, isCurrentAssessment as clientCurrent, preserveExistingReport } from '../src/lib/assessment';
import {
  boundedEnglishAnalysisScope, ENGLISH_ANALYSIS_RULES, ENGLISH_ANALYSIS_SCOPE, ENGLISH_ANALYSIS_VERSION,
} from '../src/lib/english-analysis';
import { effectiveSubject, NEW_PAPER_SUBJECT, NEW_PAPER_SUBJECTS, subjectAnalysisDirective, subjectDetectionRules } from '../src/lib/paper-subject';

let passed = 0;
async function test(name: string, check: () => unknown) {
  await check(); passed++; console.log(`PASS ${name}`);
}

await test('새 교재만 영어 기본값, 기존 미지정 교재는 수학 유지', () => {
  assert.equal(NEW_PAPER_SUBJECT, '영어');
  assert.equal(NEW_PAPER_SUBJECTS[0], '영어');
  for (const old of [null, undefined, '', '미지정']) assert.equal(effectiveSubject(old), '수학');
  const page = readFileSync('src/app/teacher/pages/PapersPage.tsx', 'utf8');
  assert.match(page, /useState<PaperSubject>\(NEW_PAPER_SUBJECT\)/);
  assert.match(page, /setSubject\(NEW_PAPER_SUBJECT\)/);
});

await test('영어 공유 지문·빈칸·문장 삽입 위치와 보기 원문 보존', () => {
  const rules = subjectDetectionRules('영어');
  assert.ok(rules.shape.join('\n').includes('각각을 따로'));
  assert.ok(rules.extra.join('\n').includes('문장 삽입 위치'));
  assert.ok(rules.extra.join('\n').includes('빠진 지문을 추측하지'));
});

await test('브라우저 정책 모듈은 API 미들웨어 밖의 공통 경로에서 불러온다', () => {
  const browserModule = readFileSync('src/lib/english-analysis.ts', 'utf8');
  const serverModule = readFileSync('api/_analysis.ts', 'utf8');
  assert.ok(browserModule.includes("from '../../shared/english-analysis'"));
  assert.ok(serverModule.includes("from '../shared/english-analysis.js'"));
  assert.ok(!/from ['"][^'"]*api\//.test(browserModule));
});

await test('영어 지침은 어휘·어법·독해·서술형의 관찰 근거와 평가 한계를 공유', () => {
  for (const text of [subjectAnalysisDirective('영어'), analysisPromptFor('영어'), learnReportSystemFor('영어')]) {
    for (const token of ['어휘·어법·독해·서술형', '시제·수일치·어순', '근거 문장', '음성·듣기 자료', '필기 시간은 독해 시간', 'CEFR', '정오와 점수를 그대로']) assert.ok(text.includes(token), token);
    assert.ok(text.includes(ENGLISH_ANALYSIS_RULES));
  }
  for (const subject of ['수학', '국어', '과학'] as const) {
    assert.ok(!analysisPromptFor(subject).includes(ENGLISH_ANALYSIS_RULES));
    assert.ok(!learnReportSystemFor(subject).includes(ENGLISH_ANALYSIS_RULES));
  }
});

await test('영어 전체 분석에 영어 문항 유형 적용, 추정 심리 스키마 제거', () => {
  const prompt = buildUserPrompt({features: extractFeatures([]), ocrText: 'Which sentence is correct?', subject: '영어', isFullScope: true});
  assert.ok(prompt.includes('유형(어휘·어법·독해·서술형)'));
  assert.ok(!prompt.includes('계산·방정식·도형·응용'));
  assert.ok(!prompt.includes('"psychology": "필기 패턴에서 유추한'));
  assert.ok(!prompt.includes('"exam": {'));
  assert.ok(!learnReportSystemFor('영어').includes('인지적 괴리'));
  assert.ok(!learnReportSystemFor('영어').includes('필기 시간이 극단적으로 짧은데 답을 적은 경우 true'));
});

await test('서버·클라이언트 모두 옛 영어 분석을 분리하고 교사 리포트는 보존', () => {
  const old = {version: ASSESSMENT_VERSION, subject: '영어', status: 'fallback' as const, references: []};
  const current = {...old, englishAnalysisVersion: ENGLISH_ANALYSIS_VERSION};
  for (const isCurrent of [clientCurrent, serverCurrent]) {
    assert.equal(isCurrent(old, '영어'), false);
    assert.equal(isCurrent(current, '영어'), true);
    assert.equal(isCurrent({...current, englishAnalysisVersion: 'old'}, '영어'), false);
    assert.equal(isCurrent(current, '수학'), false);
    assert.equal(isCurrent({...old, subject: '과학'}, '과학'), true);
  }
  assert.ok(fullAnalysisKey('영어').includes(ENGLISH_ANALYSIS_VERSION));
  assert.ok(!fullAnalysisKey('수학').includes(ENGLISH_ANALYSIS_VERSION));
  assert.equal(preserveExistingReport(old, 2, 3), true);
  assert.equal(preserveExistingReport(current, 2, 3), false);
});

await test('긴 영어 문항 ID는 서버 길이 제한 안에서 구분', () => {
  const prefix = 'q-' + 'page-unit-'.repeat(30);
  const first = boundedEnglishAnalysisScope(prefix + 'a' + ENGLISH_ANALYSIS_SCOPE, '영어');
  const second = boundedEnglishAnalysisScope(prefix + 'b' + ENGLISH_ANALYSIS_SCOPE, '영어');
  assert.ok(first.length <= 80 && second.length <= 80);
  assert.notEqual(first, second);
  assert.ok(first.endsWith(ENGLISH_ANALYSIS_SCOPE));
  assert.equal(boundedEnglishAnalysisScope(prefix, '수학'), prefix);
  const cache = readFileSync('src/lib/analysis-cache.ts', 'utf8');
  assert.ok(cache.includes('boundedEnglishAnalysisScope(boundedGradingScope('));
  const auto = readFileSync('src/lib/auto-grade.ts', 'utf8');
  assert.ok(auto.includes("status?.englishAnalysisVersion === ENGLISH_ANALYSIS_VERSION"));
});

const savedFetch = globalThis.fetch;
const savedGemini = process.env.GEMINI_API_KEY;
const savedOpenRouter = process.env.OPENROUTER_API_KEY;
delete process.env.GEMINI_API_KEY;
process.env.OPENROUTER_API_KEY = 'local-test-placeholder';
let calls: Array<{messages: Array<{role: string; content: string}>}> = [];
globalThis.fetch = async (_url, init) => {
  calls.push(JSON.parse(String(init?.body)));
  return Response.json({choices: [{message: {content: JSON.stringify({
    headline: '영어 분석 테스트',
    overview: '학생 답의 근거를 확인합니다.',
    problems: [{label: '1번', type: '객관식', verdict: 'correct', guessed: false, mistake: false, difficulty: '보통', comment: '접속사 뒤의 근거를 확인했습니다.'}],
    learnerAnalysis: '독해 근거를 찾았습니다.', priorityProblems: '1번 근거 문장을 확인합니다.', overall: '연결어를 복습합니다.',
    assessment: {englishAnalysisVersion: 'forged'},
  })}}]});
};
try {
  await test('실제 분석 호출 경로: 학원 지침 뒤에 영어 규칙 적용, 서버 버전 기록', async () => {
    calls = [];
    const custom = '학원 맞춤 안내.\n' + CORE_ANALYSIS_RULES;
    const result = await runAnalysisLLM({features: extractFeatures([]), ocrText: '1. Choose the correct conjunction. However', systemPrompt: custom, subject: '영어'});
    const system = calls[0].messages[0].content;
    assert.ok(system.startsWith(custom));
    assert.ok(system.indexOf(ENGLISH_ANALYSIS_RULES) > system.indexOf(CORE_ANALYSIS_RULES));
    assert.equal(system.split(ENGLISH_ANALYSIS_RULES).length, 2);
    assert.equal(result.assessment?.englishAnalysisVersion, ENGLISH_ANALYSIS_VERSION);
    assert.equal(serverCurrent(result.assessment, '영어'), true);
  });
  await test('실제 리포트 호출 경로: 영어 기준·문항 코멘트·세 분석 글 유지', async () => {
    calls = [];
    const result = await runLearnReportLLM('1번 학생 답: ②, 확정 채점: 정답', '영어');
    assert.ok(calls[0].messages[0].content.includes(ENGLISH_ANALYSIS_RULES));
    assert.ok(calls[0].messages[0].content.includes('학생이 찍었다고 직접'));
    assert.equal(result.problems[0].guessed, false);
    assert.ok(result.learnerAnalysis && result.priorityProblems && result.overall);
    assert.equal(result.assessment?.englishAnalysisVersion, ENGLISH_ANALYSIS_VERSION);
  });
} finally {
  globalThis.fetch = savedFetch;
  if (savedGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = savedGemini;
  if (savedOpenRouter === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = savedOpenRouter;
}
console.log(`${passed} PASS / 0 FAIL (LLM 응답은 모의 데이터)`);
