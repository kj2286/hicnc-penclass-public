import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { boundedGradingScope, KOREAN_GRADING_SCOPE, buildGradingPrompt, gradingSigExt, isCurrentGrading, KOREAN_GRADING_VERSION } from '../src/lib/korean-grading';
import { computeScore, gradeSignature, type ProblemGrade } from '../src/lib/grade-score';
import type { ProblemCluster } from '../src/lib/problem-detect';

let passed = 0;
function test(name: string, fn: () => void) { fn(); passed++; console.log(`PASS ${name}`); }
const meta = {question:'문제 원문', choices:['첫째','둘째']} as ProblemCluster['meta'];
const korean = buildGradingPrompt('국어', meta);
test('국어: 근거 있는 대안 답과 부분 성취의 판정 구분', () => {
  assert.match(korean, /correct: 타당한 대안 해석.*모두 충족/);
  assert.match(korean, /wrong: 일부만 충족/);
  assert.match(korean, /텍스트 근거가 타당/);
  assert.match(korean, /맞게 이해한 내용과 부족한 근거를 구분/);
  assert.doesNotMatch(korean, /correct: 완전히 일치/);
  assert.match(korean, /관련 단어 나열만으로 설명을 인정하지/);
});
test('국어: 독립 평가·중복 감점·임의 배점·교육과정 추정 금지', () => {
  for (const text of ['표현을 독립적으로', '같은 오류를 중복 감점하지', '숫자 배점·부분점수·감점량을 만들거나', '실제 문항이나 교사 기준이 요구한 범위', '고등학교 또는 2022 교육과정을 추정하지', '구체적인 수정 행동']) assert.ok(korean.includes(text), text);
  assert.match(korean, /blank:.*무응답.*unknown:.*읽지 못해/);
});
test('국어: 긴 지문·교사 지침에도 4000자 앞에 스키마 보존', () => {
  const prompt = buildGradingPrompt('국어', {...meta!, question:'긴문항'.repeat(9000)}, '교사지침'.repeat(9000));
  const clipped = prompt.slice(0, 4000);
  const json = clipped.split('\n').find(line => line.startsWith('{'))!;
  assert.deepEqual(Object.keys(JSON.parse(json)), ['correctAnswer','studentAnswer','verdict','explanation','work','issues']);
  assert.ok(!prompt.includes('긴문항'));
});
// 변경 전 HEAD의 실제 프롬프트로 계산한 해시. 다른 과목 문구·순서·보기·교사 지침까지 동일해야 한다.
const legacy = {'수학':'4d97f07f07500122ffbec2d5d542f1da4f61ffa858727221622314a4398c04b5','영어':'6a54e18e1102569adff6ed8e19ba92320a871dfd41bd229fd63f30ed5b6880db','과학':'6b045bf7ab2b10b637322d8cd5271015836592c3a2bedc92b19e8b59528dabb6'} as const;
for (const subject of ['수학','영어','과학'] as const) test(`${subject}: 기존 프롬프트와 서명 보존`, () => {
  assert.equal(createHash('sha256').update(buildGradingPrompt(subject,meta,'교사 기준')).digest('hex'),legacy[subject]);
  assert.equal(gradingSigExt(subject,'|teacher'), '|teacher');
  assert.equal(isCurrentGrading(`base${gradingSigExt('국어')}`,subject),false);
});
test('자동·수동 동일 국어 캐시 서명, 옛 버전·다른 과목 분리', () => {
  const c = {label:'1번',strokeIds:['s1'],bbox:{minX:0,minY:0,maxX:10,maxY:10}} as ProblemCluster;
  const base = gradeSignature(c);
  const auto = base + gradingSigExt('국어', '|teacher');
  const manual = base + gradingSigExt('국어', gradingSigExt('국어','|teacher'));
  assert.equal(auto,manual);
  assert.equal(isCurrentGrading(auto,'국어'),true);
  for (const old of [undefined,base,base+'|teacher',base+'|ko-grading-old']) assert.equal(isCurrentGrading(old,'국어'),false);
  assert.equal(KOREAN_GRADING_VERSION,'ko-grading-2026-09-10-v1');
});
test('부분 성취 설명은 기존 100점 이진 점수를 바꾸지 않는다', () => {
  const g = {points:0,verdict:'wrong',work:'주장은 맞지만 근거가 빠짐'} as ProblemGrade;
  assert.equal(computeScore([g]).score,0);
  assert.equal(computeScore([g,{...g,verdict:'correct'}]).score,50);
});
test('실제 호출·화면 복원·자동 완료 검사·분석 스코프 연결', () => {
  const grade = readFileSync('src/lib/problem-grade.ts','utf8');
  assert.ok(grade.indexOf('await subjectForNcodePage(page)') < grade.indexOf('const hit = cache.byProblem'));
  assert.match(grade,/recognizeImage\(dataUrl, prompt, \{\s+subject,\s+question:/);
  const api = readFileSync('src/lib/api.ts','utf8');
  assert.ok(api.includes('...(grading ? { grading } : {})'));
  const review = readFileSync('src/app/teacher/pages/ReviewPage.tsx','utf8');
  assert.ok(review.includes('if (!isCurrentGrading(sig, subject)) continue;'));
  assert.ok(review.includes('gradingSigExt(subject, promptSigExt(directive))'));
  const auto = readFileSync('src/lib/auto-grade.ts','utf8');
  assert.ok(auto.includes('gradingSigExt(gradeSubjectForPage(pg.key), promptSigExt(directive))'));
  assert.ok(auto.includes('status?.gradingVersion === KOREAN_GRADING_VERSION'));
  assert.ok(auto.includes('subject: gradeSubjectForPage(pg.key)'));
  const scopes = readFileSync('src/lib/analysis-cache.ts','utf8');
  assert.ok(scopes.includes("subject === '국어' ? KOREAN_GRADING_SCOPE : ''"));
});
test('국어 분석 키는 서버 80자 제한 이내, 긴 ID도 서로 분리', () => {
  const prefix = 'q-' + 'page-id-'.repeat(20);
  const key = prefix + '-s-ko-essay-2026-09-10-v1' + KOREAN_GRADING_SCOPE;
  assert.ok(boundedGradingScope(key,'국어').length <= 80);
  assert.notEqual(boundedGradingScope(key,'국어'), boundedGradingScope(key+'2','국어'));
  assert.equal(boundedGradingScope(key,'수학'),key);
  assert.equal(boundedGradingScope('short-kg1','국어'),'short-kg1');
});
console.log(`${passed} PASS / 0 FAIL`);
