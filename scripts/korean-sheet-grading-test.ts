import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as rules from '../src/lib/korean-grading';
import * as scores from '../src/lib/grade-score';
import type { ProblemCluster } from '../src/lib/problem-detect';
import type { GradeCache } from '../src/lib/problem-grade';

// 실제 순수 비교 함수와 실제 비전 채점 모듈을 실행한다. 브라우저·네트워크 경계만 대체한다.
function evaluate(source: string, require: (id: string) => unknown = () => { throw Error('unexpected import'); }): any {
  const code = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports = {}; new Function('exports','require',code)(exports,require); return exports;
}
const special = readFileSync('src/lib/special-pages.ts','utf8');
const merge = evaluate(`const sameGradedSheetAnswer = require('rules').sameGradedSheetAnswer;\n` +
  special.slice(special.indexOf('export function normalizeAnswer'),special.indexOf('// ── 페이지 유형')), () => rules).mergeSheetVerdict;
let calls: Array<{image:string; prompt:string; grading:any}> = [];
const image = 'data:image/png;base64,actual-rendered-problem-region';
let nextVerdict = 'correct';
let subjectsLookedUp = 0;
const modules: Record<string,unknown> = {
  '@/lib/api': { recognizeImage: async (data:string,prompt:string,grading:any) => {
    calls.push({image:data,prompt,grading});
    return {text:JSON.stringify({verdict:nextVerdict,studentAnswer:'모델이 바꾼 표현',correctAnswer:'자연 친화적 태도',explanation:'근거를 확인함',work:'새 별도 답안에서 확인한 성취',issues:['구체적인 근거를 보완하세요']})};
  } },
  './korean-grading': rules,
  './json-repair': {repairModelJson:(s:string)=>s},
  '@/lib/strokes-io': {},
  './grade-score': scores,
  './problem-detect': {renderProblemRegionImage:async()=>image,subjectForNcodePage:async()=>{subjectsLookedUp++;return '국어';}},
};
const runtime = evaluate(readFileSync('src/lib/problem-grade.ts','utf8'), id => {
  assert.ok(id in modules,id); return modules[id];
});
const cluster = {id:'page#1',label:'1번',strokeIds:[],bbox:{minX:0,minY:0,maxX:10,maxY:10},meta:{no:1,type:'서술형',question:'화자의 태도와 근거를 쓰시오',choices:[],points:0}} as unknown as ProblemCluster;
const page = {section:1,owner:1,noteId:1,pageNumber:1};
const ext = rules.gradingSigExt('국어','teacher');
const body = {...runtime.blankGrade(cluster),verdict:'correct',studentAnswer:'자연과 조화를 이루려는 마음',correctAnswer:'자연 친화적 태도',work:'본문의 근거를 인정함',issues:[]};
let cache: GradeCache = runtime.putGrade({v:1,byProblem:{}},cluster,body,ext);
let passed = 0;
async function test(name:string,fn:()=>unknown){await fn();passed++;console.log(`PASS ${name}`);}
await test('P2: 같은 학생 답은 예시 정답과 달라도 correct와 피드백 보존',async()=>{
  assert.equal(merge(body,body.studentAnswer).verdict,'wrong'); // 기존 결함 재현
  assert.equal(merge(body,body.studentAnswer,true).verdict,'correct');
  const result = await runtime.gradeKoreanSheetProblem({page,cluster,strokes:[],cache,bodyGrade:body,sheetAnswer:body.studentAnswer,sigExt:ext});
  assert.deepEqual(result.grade,body); assert.equal(calls.length,0);
});
await test('다른 별도 답안은 실제 문항 이미지와 국어 정책으로 호출, 본문 필기 0도 평가',async()=>{
  const answer='자연과 함께 살아가려는 태도이며 시어에서 근거를 찾을 수 있다';
  assert.equal(merge(body,answer,true).verdict,'unknown');
  const result = await runtime.gradeKoreanSheetProblem({page,cluster,strokes:[],cache,bodyGrade:body,sheetAnswer:answer,sigExt:ext});
  assert.equal(result.grade.verdict,'correct'); assert.equal(result.grade.studentAnswer,answer);
  assert.equal(result.grade.work,'새 별도 답안에서 확인한 성취');
  assert.equal(calls.length,1); assert.equal(calls[0].image,image);
  assert.equal(calls[0].grading.subject,'국어'); assert.equal(calls[0].grading.question,cluster.meta!.question);
  assert.ok(calls[0].prompt.includes(JSON.stringify({studentAnswer:answer})));
  assert.ok(calls[0].prompt.includes('이미지의 파란 본문 답·풀이를 이 답안의 성취로 대신 인정하지'));
  cache=runtime.putKoreanSheetGrade(cache,cluster,result.grade,answer,ext);
  assert.deepEqual(cache.byProblem[cluster.id].studentAnswer,body.studentAnswer);
  const reused=await runtime.gradeKoreanSheetProblem({page,cluster,strokes:[],cache,bodyGrade:body,sheetAnswer:answer,sigExt:ext});
  assert.equal(reused.fromCache,true); assert.equal(calls.length,1);
});
await test('별도 답안이 바뀌면 재채점, partial은 wrong·인정 성취·수정 피드백 유지',async()=>{
  nextVerdict='wrong';
  const answer='자연을 좋아한다';
  const result=await runtime.gradeKoreanSheetProblem({page,cluster,strokes:[],cache,bodyGrade:body,sheetAnswer:answer,sigExt:ext});
  assert.equal(calls.length,2); assert.equal(result.grade.verdict,'wrong');
  assert.equal(result.grade.work,'새 별도 답안에서 확인한 성취');
  assert.deepEqual(result.grade.issues,['구체적인 근거를 보완하세요']);
  assert.equal(merge(result.grade,answer,true).verdict,'wrong');
  assert.equal(scores.computeScore([result.grade]).score,0);
  assert.equal(subjectsLookedUp,0);
});
await test('기존 객관식·다른 과목은 문자열 정규화 유지',()=>{
  assert.equal(merge({...body,correctAnswer:'①'},'1').verdict,'correct');
  assert.equal(rules.needsKoreanSheetGrading('국어','객관식'),false);
  assert.equal(rules.needsKoreanSheetGrading('영어','서술형'),false);
});
await test('P2: 현재 정책 버전이어도 수학→국어 변경은 완료로 보지 않는다',()=>{
  const status={gradingVersion:rules.KOREAN_GRADING_VERSION,gradingSubjects:{'7':'수학' as const}};
  assert.equal(status.gradingVersion,rules.KOREAN_GRADING_VERSION);
  assert.equal(rules.currentGradingSubjects(status.gradingSubjects,{'7':'국어'}),false);
  assert.equal(rules.currentGradingSubjects(status.gradingSubjects,{'7':'수학'}),true);
  assert.equal(rules.currentGradingSubjects(undefined,{'7':'수학'}),false);
  assert.equal(rules.currentGradingSubjects({'7':'국어'},{'7':null}),false);
  assert.equal(rules.currentGradingSubjects({'7':'국어'},{'7':'국어','8':'수학'}),false);
  assert.equal(rules.currentGradingSubjects({},{}),false);
});
await test('자동·수동 의미 채점 연결, 과목 확인은 버전 일치로 생략하지 않음',()=>{
  const auto=readFileSync('src/lib/auto-grade.ts','utf8');
  const review=readFileSync('src/app/teacher/pages/ReviewPage.tsx','utf8');
  assert.ok(auto.includes('await gradeKoreanSheetProblem('));
  assert.ok(review.includes('await gradeKoreanSheetProblem('));
  assert.ok(auto.includes('currentGradingSubjects(status?.gradingSubjects, subjects)'));
  assert.ok(!auto.includes('if (status && !currentGrading)'));
  assert.ok(auto.includes('gradingSubjects: Object.fromEntries'));
  assert.ok(review.includes('...sheetMerge.semanticById'));
  assert.ok(review.includes('sheetMerge?.pending'));
});
console.log(`${passed} PASS / 0 FAIL`);
