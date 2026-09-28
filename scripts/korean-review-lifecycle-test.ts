import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { answerSheetRequestSig, finalCachedGrades, pruneSheetGrades, gradingSigExt, sheetGradingSigExt } from '../src/lib/korean-grading';
import type { ProblemGrade } from '../src/lib/grade-score';
let passed=0;
async function test(name:string,fn:()=>unknown){await fn();passed++;console.log(`PASS ${name}`);}
const base={problemId:'p1',label:'1번',no:1,points:0,studentAnswer:'본문',correctAnswer:'예시',verdict:'correct',work:'',explanation:'',issues:[],sig:'base'+gradingSigExt('국어')} as ProblemGrade & {sig:string};
await test('P2 집계: 본문+별도 답안을 한 문항으로, 최종 시트 wrong도 반영',()=>{
  let sheet={...base,studentAnswer:'별도답',sig:sheetGradingSigExt(base.sig,'별도답')};
  let cache={byProblem:{p1:base,'p1:sheet':sheet}};
  assert.equal(Object.values(cache.byProblem).filter(g=>g.verdict==='correct').length,2);
  assert.equal(finalCachedGrades(cache).filter(g=>g.verdict==='correct').length,1);
  sheet={...sheet,verdict:'wrong'};cache={byProblem:{p1:base,'p1:sheet':sheet}};
  assert.equal(finalCachedGrades(cache).length,1);assert.equal(finalCachedGrades(cache)[0].verdict,'wrong');
});
await test('P2 집계: 오래된 본문·교사 지침·과목에 대응하는 시트는 제외',()=>{
  const sheet={...base,verdict:'wrong' as const,studentAnswer:'별도답',sig:sheetGradingSigExt(base.sig,'별도답')};
  for(const sig of ['changed'+gradingSigExt('국어'),base.sig+'teacher','math-old-signature']){
    assert.equal(finalCachedGrades({byProblem:{p1:{...base,sig},'p1:sheet':sheet}})[0].verdict,'correct');
  }
  assert.deepEqual(finalCachedGrades({byProblem:{p1:{...base,sig:'math-old-signature'}}}),[{...base,sig:'math-old-signature'}]);
  const code=readFileSync('src/lib/class-average.ts','utf8');
  assert.equal(code.split('finalCachedGrades(gc)').length-1,2);
  assert.ok(!code.includes('Object.values(gc?.byProblem'));
});
const review=readFileSync('src/app/teacher/pages/ReviewPage.tsx','utf8');
function effectBetween(start:string,end:string){
  const part=review.slice(review.indexOf(start),review.indexOf(end,review.indexOf(start)));
  return part.slice(part.indexOf('  useEffect('));
}
function mountEffect(source:string,env:Record<string,any>){
  let cleanup:any;let deps:any[]=[];
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('useEffect',...Object.keys(env),code)((fn:()=>unknown,d:any[])=>{deps=d;cleanup=fn();},...Object.values(env));
  return {cleanup,deps};
}
const autoSource=effectBetween('// ── 자동화 4:', '// ── 문항 영역 수동 편집');
await test('P2 분석 예약: 의미 채점 중에는 예약하지 않고 준비된 뒤 자동 시작',()=>{
  let started=0;const seen=new Set<string>();
  const env={scopeCacheKey:'q-1',id:'sub',currentStrokes:[{}],analysisLoading:false,receivingNow:false,autoGradingThis:false,
    playback:{isPlaying:false},semanticSheetBusy:true,sheetBusy:false,sheetMerge:{pending:true},grading:false,selectedProblem:null,grades:{},
    analysisByScope:{},docSubject:'국어',analysisAutoRef:{current:seen},ocrByScope:{'q-1':'OCR'},
    isCurrentAssessment:()=>false,isFullAnalysisKey:()=>false,runAnalysis:()=>{started++;}};
  const waiting=mountEffect(autoSource,env);assert.equal(seen.size,0);assert.equal(started,0);
  const ready=mountEffect(autoSource,{...env,semanticSheetBusy:false,sheetMerge:{pending:false}});
  assert.notDeepEqual(waiting.deps,ready.deps);assert.equal(started,1);assert.ok(seen.has('q-1'));
});
const sheetSource=effectBetween('// 정답지 인식 —', '// 표지 본인정보 인식');
function deferred(){let resolve!:(value:any)=>void;const promise=new Promise(r=>{resolve=r;});return {resolve,promise};}
const tick=()=>new Promise(r=>setImmediate(r));
await test('P2 답안지: problems 갱신 취소→같은 입력 재시도, 옛 응답은 새 대기를 해제하지 않음',async()=>{
  let busy=false;let result:any;const calls:any[]=[];const pending:ReturnType<typeof deferred>[]=[];
  const page={key:'sheet',section:1,owner:1,noteId:1,pageNumber:2,strokes:[{id:'s'}]};
  const env={submission:{id:'sub',studentId:'student'},pages:[page,{key:'body',strokes:[]}],
    specialKeys:{answer:new Set(['sheet']),info:new Set()},sheetSigRef:{current:''},
    problems:{body:[{meta:{no:1}}]},answerSheetRequestSig,setSheet:(v:any)=>{result=v;},setSheetBusy:(v:boolean)=>{busy=v;},
    recognizeAnswerSheet:(args:any)=>{calls.push(args);const d=deferred();pending.push(d);return d.promise;}};
  const first=mountEffect(sheetSource,env);assert.ok(busy);first.cleanup();assert.equal(busy,false);assert.equal(env.sheetSigRef.current,'');
  const second=mountEffect(sheetSource,{...env,problems:{body:[{meta:{no:1}}]}});
  assert.equal(calls.length,2);assert.ok(busy);
  pending[0].resolve({answers:{1:'old'}});await tick();assert.ok(busy);assert.equal(result,undefined);
  pending[1].resolve({answers:{1:'new'}});await tick();assert.equal(busy,false);assert.equal(result.answers[1],'new');
  second.cleanup();
  mountEffect(sheetSource,{...env,problems:{body:[{meta:{no:1}},{meta:{no:2}}]}});
  assert.equal(calls.length,3);assert.deepEqual(calls[2].expectedNos,[1,2]);
  pending[2].resolve({answers:{1:'new',2:'answer'}});await tick();assert.equal(busy,false);
});
await test('답안지 캐시 입력: 예상 번호·페이지·획 변경 반영, 호출에서도 같은 서명 사용',()=>{
  const page={section:1,owner:1,noteId:1,pageNumber:1};
  const sig=answerSheetRequestSig(page,['a'],[1]);
  assert.notEqual(sig,answerSheetRequestSig(page,['a'],[1,2]));
  assert.notEqual(sig,answerSheetRequestSig(page,['b'],[1]));
  assert.notEqual(sig,answerSheetRequestSig({...page,pageNumber:2},['a'],[1]));
  assert.equal(answerSheetRequestSig(page,['a','b'],[2,1,1]),answerSheetRequestSig(page,['b','a'],[1,2]));
  assert.ok(readFileSync('src/lib/special-pages.ts','utf8').includes('answerSheetRequestSig(args.page, args.strokes.map(st => st.id), expectedNos)'));
});
await test('답안지에서 지운 답은 자동·수동 캐시에서 제거하고 집계는 본문으로 복귀',()=>{
  const sheet={...base,verdict:'wrong' as const,studentAnswer:'별도답',sig:sheetGradingSigExt(base.sig,'별도답')};
  const cache={v:1,byProblem:{p1:base,'p1:sheet':sheet}};
  assert.equal(finalCachedGrades(cache)[0].verdict,'wrong');
  const removed=pruneSheetGrades(cache,{});
  assert.equal(removed.byProblem['p1:sheet'],undefined);
  assert.equal(finalCachedGrades(removed).length,1);
  assert.equal(finalCachedGrades(removed)[0].verdict,'correct');
  assert.equal(cache.byProblem['p1:sheet'],sheet);
  assert.equal(pruneSheetGrades(cache,{'1':'별도답'}),cache);
  assert.equal(pruneSheetGrades(cache,{'1':'다른 답'}).byProblem['p1:sheet'],undefined);
  assert.equal(pruneSheetGrades(cache,{'1':'  '}).byProblem['p1:sheet'],undefined);
  const auto=readFileSync('src/lib/auto-grade.ts','utf8');
  assert.ok(auto.includes('pruneSheetGrades(cache, sheetDoc.answers)'));
  assert.ok(review.includes('pruneSheetGrades(gradeCacheRef.current, sheet.answers)'));
  assert.ok(review.includes('await saveGradeCache(submission.studentId, submission.id, next)'));
});
console.log(`${passed} PASS / 0 FAIL`);
