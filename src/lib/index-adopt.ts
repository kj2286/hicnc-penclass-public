/**
 * ncode 인덱스 캐시 채택 규칙 — 순수 함수 (paper.store 에서 사용).
 *
 * 인덱스 빌드는 교재 하나가 실패해도 나머지를 살린다(allSettled). 그래서 서버가
 * 반쯤 죽어 있으면 **일부만 담긴 인덱스**가 완성본처럼 돌아온다. 그대로 캐시에
 * 쓰면 멀쩡하던 캐시가 반쪽으로 덮여, 이미 보던 배경 교재까지 "PDF 로드 실패"
 * 로 사라진다 — 2026-08-13 NGS 인증서 만료 때 실제로 겪은 장애의 재발 경로다.
 */

export type BuildOutcome = {
  /** 이번에 만들어진 인덱스 항목 수 */
  size: number;
  /** 인덱싱에 실패한 교재 수 — 0 이 아니면 인덱스가 불완전하다 */
  failed: number;
};

/**
 * 새로 만든 인덱스를 기존 캐시 대신 채택해도 되는가.
 *
 * 실패가 하나도 없으면 그 인덱스가 곧 서버의 현재 상태이므로 항상 채택한다
 * (교재를 실제로 지워 줄어든 경우도 여기 해당). 실패가 있었다면 캐시보다
 * 빈약해진 결과는 장애의 산물로 보고 버린다.
 */
export function shouldAdoptIndex(
  result: BuildOutcome,
  cachedSize: number,
): boolean {
  if (result.failed === 0) return true;
  return result.size >= cachedSize;
}
