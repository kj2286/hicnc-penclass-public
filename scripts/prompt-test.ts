/** 학원 교재·문항별 프롬프트 — 합성·서명 회귀 테스트.
 *  합성이 흔들리면 채점 서명이 갈라져 "완료된 문항 재채점" 이 부활한다. */
import {
  EMPTY_PROMPT_CONFIG,
  EMPTY_REPORT_PROMPTS,
  composeReportSectionDirective,
  analysisDirective,
  gradeDirective,
  promptFor,
  promptSigExt,
  reportDirective,
  type PaperPromptConfig,
} from '../src/lib/paper-prompts';

let pass = 0,
  fail = 0;
const ok = (n: string, c: boolean, got?: unknown) => {
  if (c) {
    pass++;
    console.log(`PASS  ${n}`);
  } else {
    fail++;
    console.log(`FAIL  ${n} — got ${String(got)}`);
  }
};

const cfg: PaperPromptConfig = {
  enabled: true,
  byPdf: {
    77: { paper: '풀이 과정을 중점 평가.', byNo: { 3: '3번은 식 세우기가 핵심.' } },
    80: { byNo: {} },
  },
};

ok('OFF 이면 항상 빈 문자열', promptFor({ ...cfg, enabled: false }, 77, 3) === '');
ok('EMPTY 설정은 빈 문자열', gradeDirective(EMPTY_PROMPT_CONFIG, 77, 3) === '');
ok('교재+문항 합성 (전체 → 문항 순서)',
  promptFor(cfg, 77, 3) === '풀이 과정을 중점 평가.\n3번은 식 세우기가 핵심.');
ok('문항 프롬프트 없는 번호는 교재만', promptFor(cfg, 77, 5) === '풀이 과정을 중점 평가.');
ok('설정 없는 교재는 빈 문자열', promptFor(cfg, 99, 3) === '');
ok('채점 지시문에 라벨 포함',
  gradeDirective(cfg, 77, 3).startsWith('[학원 채점·평가 기준'));
ok('분석 지시문에 라벨 포함',
  analysisDirective(cfg, 77, null).includes('[학원 분석 기준'));
ok('리포트는 교재 전체 프롬프트만 (없는 교재 무시)',
  reportDirective(cfg, [77, 80, 99]).includes('풀이 과정을 중점 평가.') &&
    !reportDirective(cfg, [80, 99]));
ok('서명: 빈 지시문은 꼬리 없음', promptSigExt('') === '');
ok('서명: 같은 지시문 = 같은 꼬리',
  promptSigExt('abc') === promptSigExt('abc') && promptSigExt('abc').startsWith('|d'));
ok('서명: 다른 지시문 = 다른 꼬리', promptSigExt('abc') !== promptSigExt('abd'));

ok('리포트 섹션: 전부 비면 빈 문자열',
  composeReportSectionDirective(EMPTY_REPORT_PROMPTS) === '');
const rd = composeReportSectionDirective({
  ...EMPTY_REPORT_PROMPTS,
  problemLine: '칭찬 반 보완 반.',
  overall: '2주 플랜 제시.',
});
ok('리포트 섹션: 쓴 항목만 라벨과 함께',
  rd.includes('[문항별 AI 과정 분석') && rd.includes('[종합분석') &&
    !rd.includes('[학습자 결과분석') && rd.startsWith('## 학원 리포트 작성 기준'));

console.log(`\n=== ${pass}/${pass + fail} ===`);
if (fail > 0) process.exit(1);
