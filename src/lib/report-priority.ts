/**
 * 우선학습대상 문제 분류 — 순수 함수.
 *
 * 리포트 양식(첨부 PDF)의 5단계 그대로다. 오답을 한 덩어리로 보여주면
 * 선생님이 "무엇부터 손볼지" 를 다시 판단해야 한다. 실수인지, 개념이 한 조각
 * 빈 건지, 아예 단원을 다시 봐야 하는 건지에 따라 처방이 다르므로 나눈다.
 *
 * 판단 근거는 전부 펜 실측 + 채점 결과다(추측 아님):
 *  - mistake  : 아는데 틀림(과목별 단순 실수 — 계산·어휘·조건 확인 등)
 *  - guessed  : 찍음
 *  - attempts : 시도 횟수
 *  - difficulty: 문항 난이도
 */
import type { ReportDifficulty } from './learn-report';

export type PriorityInput = {
  label: string;
  verdict: 'correct' | 'wrong' | 'unknown';
  guessed: boolean;
  mistake: boolean;
  difficulty: ReportDifficulty;
  attempts: number;
};

export type PriorityRank = 1 | 2 | 3 | 4 | 5;

export const PRIORITY_LABEL: Record<PriorityRank, string> = {
  1: '실수 또는 개선 필요',
  2: '원포인트 개념 학습 필요',
  3: '단기 개념 학습 필요',
  4: '재풀이 후 평가',
  5: '중장기 개념 학습 필요',
};

/**
 * 문항 하나의 우선순위. 맞은 문제는 대상이 아니다(찍어서 맞은 건 예외).
 * null 이면 복습 목록에 넣지 않는다.
 */
export function priorityOf(p: PriorityInput): PriorityRank | null {
  // 찍어서 맞은 건 실력이 아니다 — 다시 풀려 확인해야 한다
  if (p.verdict === 'correct') return p.guessed ? 4 : null;
  if (p.verdict !== 'wrong') return null;

  // 아는데 틀린 것 — 개념이 아니라 습관(검산·조건 확인)을 고치면 바로 오른다
  if (p.mistake) return 1;

  const hard = p.difficulty === '어려움' || p.difficulty === '매우 어려움';
  // 어려운 문제의 오답은 단기 처방으로 안 된다
  if (hard) return 5;
  // 한 번에 끝낸 오답 = 막힌 줄도 모른 것. 개념 한 조각만 짚으면 된다
  if (p.attempts <= 1) return 2;
  return 3;
}

/** 순위별로 묶는다 — 비어 있는 순위도 자리를 지킨다(양식이 5칸 고정) */
export function groupByPriority(
  problems: readonly PriorityInput[],
): Record<PriorityRank, string[]> {
  const out: Record<PriorityRank, string[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  for (const p of problems) {
    const r = priorityOf(p);
    if (r) out[r].push(p.label);
  }
  return out;
}
