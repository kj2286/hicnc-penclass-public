/**
 * 내신 시험지(수학) 문항 행동 데이터의 클라이언트 타입 — 서버(api/_analysis.ts)와 1:1.
 * 계산은 `exam-report.ts`, 이 파일은 모양만 정한다.
 */
export type ExamInsight = {
  /** 지우거나 덧쓴 횟수 — 세지 못했으면 null (0 과 구분한다) */
  overwrites: number | null;
  overwriteNote: string;
  /** 서술형 부분 점수 — 배점을 모르면 null */
  partialPoints: number | null;
  /** 풀이가 멈춘 계산·논리 단계 */
  blockNote: string;
};
