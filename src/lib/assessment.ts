import { KOREAN_GRADING_VERSION } from './korean-grading';
import { ENGLISH_ANALYSIS_VERSION } from './english-analysis';
export const ASSESSMENT_VERSION = 'essay-2026-09-10-v1';
export type AssessmentMetadata = {
  version: string;
  subject: string;
  koreanGradingVersion?: string;
  englishAnalysisVersion?: string;
  applications?: Array<{ referenceId: string; criterion: string; application: string }>;
  /** 검색 후보이며 실제 채점 적용을 보장하지 않는다. */
  status: 'reference' | 'fallback';
  references: Array<{ id: string; subject: string; title: string; source: string; pages: number[] }>;
};

/** 전체 분석은 저장 경로가 같으므로 과목도 확인한다. */
export function isCurrentAssessment(assessment: AssessmentMetadata | undefined, subject: string): boolean {
  return assessment?.version === ASSESSMENT_VERSION && assessment.subject === subject
    && (subject !== '국어' || assessment.koreanGradingVersion === KOREAN_GRADING_VERSION)
    && (subject !== '영어' || assessment.englishAnalysisVersion === ENGLISH_ANALYSIS_VERSION);
}

/** 옛 리포트는 교사 편집 여부를 알 수 없어 명시적 재생성 전까지 보존한다. */
export function preserveExistingReport(
  assessment: AssessmentMetadata | undefined,
  previousStrokeCount: number | undefined,
  strokeCount: number,
): boolean {
  return !assessment || !isCurrentAssessment(assessment, assessment.subject)
    || previousStrokeCount == null
    || previousStrokeCount === strokeCount;
}

/** 메모리 전용 키. 서버 전체 분석과 수정본의 기존 저장 경로는 유지한다. */
export function fullAnalysisKey(subject: string): string {
  return `full-${ASSESSMENT_VERSION}-${subject}${subject === '국어' ? '-' + KOREAN_GRADING_VERSION : ''}${subject === '영어' ? '-' + ENGLISH_ANALYSIS_VERSION : ''}`;
}
export function isFullAnalysisKey(key: string): boolean {
  return key === 'full' || key.startsWith('full-');
}
