import { KOREAN_GRADING_SCOPE, boundedGradingScope } from './korean-grading';
import { ENGLISH_ANALYSIS_SCOPE, boundedEnglishAnalysisScope } from './english-analysis';
import { ASSESSMENT_VERSION, isCurrentAssessment } from './assessment';
/**
 * 문항 분석 캐시 읽기 — 리포트에 **모범 풀이 비교**를 옮겨 심는 데 쓴다
 * (사용자 요구 2026-09-02: 리포트의 AI 과정 분석에도 학생 풀이 vs 선생님 풀이
 * 비교가 들어가야 한다).
 *
 * 문항 분석은 `{studentId}/{submissionId}.analysis.q-{clusterId}.json` 에
 * 캐시된다(api/ai analyze). 리포트를 만들 때 LLM 을 다시 부르지 않고 이 캐시의
 * modelComparison 만 읽어 문서에 넣는다 — 화면(문항 분석 패널)과 리포트가
 * 같은 내용을 보여준다.
 */
import type { AnalysisReport, ModelComparison } from './api';
import type { ExamInsight } from './exam-insight';
import type { KoreanInsight } from './korean-analysis';
import type { PaperSubject } from './paper-subject';
import { downloadJsonObject } from './strokes-io';

/**
 * 과목 꼬리 (027) — 과목을 바꾸면 분석 프롬프트가 달라지므로 **다시 분석**해야
 * 한다. 수학은 빈 문자열이라 기존 캐시가 그대로 살아 있다.
 *
 * 🚨 ASCII 로만 적는다. 이 꼬리는 서명뿐 아니라 **스토리지 경로**에도 들어가는데,
 * 서버(api/ai analyze)가 scope.key 의 `[^a-zA-Z0-9_-]` 를 '-' 로 바꾼다.
 * 한글을 넣으면 클라이언트가 읽는 경로와 서버가 쓰는 경로가 갈리고,
 * 국어·영어·과학이 같은 칸에 겹친다.
 */
const SUBJECT_CODE: Record<string, string> = {
  수학: '',
  영어: 'en',
  국어: 'ko',
  과학: 'sci',
};

export function subjectSigExt(subject?: PaperSubject | null): string {
  const code = SUBJECT_CODE[subject ?? '수학'] ?? 'etc';
  return `${code ? `-s-${code}` : ''}-${ASSESSMENT_VERSION}${subject === '국어' ? KOREAN_GRADING_SCOPE : ''}${subject === '영어' ? ENGLISH_ANALYSIS_SCOPE : ''}`;
}

/** 문항 분석 스코프 키 — auto-grade·ReviewPage 와 같은 규칙 */
export function problemScopeKey(
  clusterId: string,
  subject?: PaperSubject | null,
): string {
  return boundedEnglishAnalysisScope(boundedGradingScope(`q-${clusterId.replace(/[^a-zA-Z0-9_-]/g, '-')}${subjectSigExt(subject)}`, subject), subject);
}

/** 문항 id → 모범 풀이 비교. 캐시가 없거나 비교가 없는 문항은 빠진다. */
export async function loadProblemComparisons(
  studentId: string,
  submissionId: string,
  clusterIds: readonly string[],
  subject?: PaperSubject | null,
): Promise<Record<string, ModelComparison>> {
  const out: Record<string, ModelComparison> = {};
  // 순차 — 문항 수만큼의 작은 GET. 병렬로 쏘면 스토리지 속도 제한에 걸린다.
  for (const id of clusterIds) {
    const rep = await downloadJsonObject<AnalysisReport>(
      `${studentId}/${submissionId}.analysis.${problemScopeKey(id, subject)}.json`,
    ).catch(() => null);
    if (rep && isCurrentAssessment(rep.assessment, subject ?? '수학') && rep.modelComparison) out[id] = rep.modelComparison;
  }
  return out;
}

/**
 * 문항 id → 국어 분석(5-Depth·행동 심리). 국어 교재에서만 부른다 —
 * 다른 과목은 분석 캐시에 korean 블록이 아예 없다.
 */
/**
 * 문항별 분석 캐시에서 **국어·수학 블록을 한 번에** 읽는다.
 * 캐시 파일을 두 번 훑지 않도록 한 루프에서 둘 다 꺼낸다(문항이 30개면 왕복이 두 배가 된다).
 */
export async function loadProblemInsights(
  studentId: string,
  submissionId: string,
  clusterIds: readonly string[],
  subject?: PaperSubject | null,
): Promise<{
  korean: Record<string, KoreanInsight>;
  exam: Record<string, ExamInsight>;
}> {
  const korean: Record<string, KoreanInsight> = {};
  const exam: Record<string, ExamInsight> = {};
  for (const id of clusterIds) {
    const rep = await downloadJsonObject<AnalysisReport>(
      `${studentId}/${submissionId}.analysis.${problemScopeKey(id, subject)}.json`,
    ).catch(() => null);
    if (rep && isCurrentAssessment(rep.assessment, subject ?? '수학') && rep.korean) korean[id] = rep.korean;
    if (rep && isCurrentAssessment(rep.assessment, subject ?? '수학') && rep.exam) exam[id] = rep.exam;
  }
  return { korean, exam };
}

export async function loadProblemKoreanInsights(
  studentId: string,
  submissionId: string,
  clusterIds: readonly string[],
  subject?: PaperSubject | null,
): Promise<Record<string, KoreanInsight>> {
  const out: Record<string, KoreanInsight> = {};
  for (const id of clusterIds) {
    const rep = await downloadJsonObject<AnalysisReport>(
      `${studentId}/${submissionId}.analysis.${problemScopeKey(id, subject)}.json`,
    ).catch(() => null);
    if (rep && isCurrentAssessment(rep.assessment, subject ?? '수학') && rep.korean) out[id] = rep.korean;
  }
  return out;
}
