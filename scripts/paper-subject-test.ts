/**
 * 과목별 인식·분석 규칙 회귀 테스트 (026 + 028 과학).
 *
 * 실사고(2026-09-04): 인식 프롬프트가 "이 이미지는 수학 교재의 한 페이지입니다"
 * 로 고정이라, 국어·영어 시험지를 넣으면 모델이 지시대로 빈 목록을 돌려주고
 * 문항이 하나도 안 잡혔다. 과목이 프롬프트에 실제로 반영되는지 본다.
 */
import {
  PAPER_SUBJECTS,
  effectiveSubject,
  isPaperSubject,
  subjectAnalysisDirective,
  subjectDetectionRules,
} from '../src/lib/paper-subject';

let pass = 0;
let fail = 0;
const ok = (cond: boolean, note: string) => {
  if (cond) pass++;
  else {
    fail++;
    console.log(`  FAIL ${note}`);
  }
};
const test = (name: string, fn: () => void) => {
  const before = fail;
  fn();
  console.log(`${fail === before ? 'PASS' : 'FAIL'}  ${name}`);
};

test('과목 목록은 수학·영어·국어·과학 넷 — 표시 순서 그대로', () => {
  ok(JSON.stringify(PAPER_SUBJECTS) === '["수학","영어","국어","과학"]', '목록');
  ok(isPaperSubject('국어') && isPaperSubject('과학'), '판별');
  ok(!isPaperSubject('사회') && !isPaperSubject(null), '모르는 값은 거른다');
});

test('미지정은 수학으로 읽는다 — 026 이전 교재는 전부 수학이었다', () => {
  ok(effectiveSubject(null) === '수학', 'null');
  ok(effectiveSubject(undefined) === '수학', 'undefined');
  ok(effectiveSubject('사회') === '수학', '모르는 값');
  ok(effectiveSubject('영어') === '영어', '정상값은 그대로');
  ok(effectiveSubject('과학') === '과학', '과학도 정상값이다');
});

test('수학 규칙은 예전 문구를 그대로 유지한다 (재분석 유발 금지)', () => {
  const r = subjectDetectionRules('수학');
  ok(r.intro === '이 이미지는 수학 교재의 한 페이지입니다.', 'intro');
  ok(r.noun === '수학 문제', 'noun');
  ok(r.extra.length === 0, '수학엔 추가 규칙 없음');
  ok(subjectAnalysisDirective('수학') === '', '수학 분석 지시문은 빈 문자열');
});

test('수학이 아닌 과목 프롬프트에 "수학" 이라는 말이 남아 있으면 안 된다', () => {
  for (const sj of ['국어', '영어', '과학'] as const) {
    const r = subjectDetectionRules(sj);
    const all = [r.intro, r.noun, ...r.shape, ...r.extra].join('\n');
    ok(!all.includes('수학'), `${sj}: 수학 언급 없음`);
    ok(r.intro.includes(sj), `${sj}: intro 에 과목명`);
    ok(r.noun === `${sj} 문제`, `${sj}: noun`);
  }
});

test('국어·영어는 지문에 문항이 여러 개 매달리는 구조를 알려준다', () => {
  for (const sj of ['국어', '영어'] as const) {
    const r = subjectDetectionRules(sj);
    const shape = r.shape.join('\n');
    ok(shape.includes('지문'), `${sj}: 지문 언급`);
    ok(shape.includes('지문 자체는 문항이 아닙니다'), `${sj}: 지문 오인 방지`);
    ok(r.extra.join('\n').includes('passage'), `${sj}: passage 필드 요구`);
  }
});

test('영어는 원문 유지, 국어는 <보기> 처리를 따로 일러 준다', () => {
  ok(subjectDetectionRules('영어').extra.join('\n').includes('번역하지 마세요'), '영어');
  ok(subjectDetectionRules('국어').extra.join('\n').includes('<보기>'), '국어');
});

test('과학은 자료를 문항으로 오인하지 않게 일러 준다', () => {
  const r = subjectDetectionRules('과학');
  const shape = r.shape.join('\n');
  ok(shape.includes('자료 자체는 문항이 아닙니다'), '자료 오인 방지');
  ok(shape.includes('다음 자료를 보고 물음에 답하시오'), '안내줄도 문항이 아니다');
  ok(shape.includes('그래프') && shape.includes('실험'), '자료형 문항 모양');
  ok(r.extra.join('\n').includes('단위'), '단위·기호는 원문 그대로');
  ok(r.intro === '이 이미지는 과학 시험지의 한 페이지입니다.', 'intro');
});

test('과학 분석 지시문은 단위 환산·서술형 조건을 짚는다', () => {
  const d = subjectAnalysisDirective('과학');
  ok(d.startsWith('## 과학 문항 분석 지침'), '머리글');
  ok(d.includes('단위 환산'), '단위 환산');
  ok(d.includes('자료 해석') && d.includes('실험'), '자료 해석·실험 추론');
  ok(d.includes('서술형'), '서술형 요구 조건');
  ok(d.includes('미응시'), '빈칸은 지어내지 않는다');
});

test('수학이 아닌 과목 분석 지시문은 근거와 미응시를 다룬다', () => {
  for (const sj of ['국어', '영어', '과학'] as const) {
    const d = subjectAnalysisDirective(sj);
    ok(d.includes('근거'), `${sj}: 근거`);
    ok(d.includes('미응시'), `${sj}: 빈칸은 지어내지 않는다`);
    ok(d.startsWith(`## ${sj} 문항 분석 지침`), `${sj}: 머리글`);
  }
  ok(subjectAnalysisDirective('영어').includes('시제'), '영어는 문법 오류를 짚는다');
  ok(subjectAnalysisDirective('국어').includes('서술형'), '국어는 서술형 조건을 따진다');
});

console.log(`\n=== ${pass}/${pass + fail} ===`);
if (fail > 0) process.exit(1);
