/**
 * 채점 결과 타입 · 점수 계산 · 입력 서명 — **순수 모듈**(브라우저·네트워크 의존 없음).
 * node 에서 그대로 테스트한다 (scripts/detect-test.ts).
 */
import type { ProblemCluster } from './problem-detect';

export type GradeVerdict = 'correct' | 'wrong' | 'blank' | 'unknown';

export type ProblemGrade = {
  problemId: string;
  no: number;
  label: string;
  /** 배점 (0 이면 미지정 — 점수 계산에서 균등 배분) */
  points: number;
  verdict: GradeVerdict;
  /** 학생이 쓴 최종 답 */
  studentAnswer: string;
  /** 지문에서 도출한 정답 */
  correctAnswer: string;
  /** 정답 풀이 요약 */
  explanation: string;
  /** 학생 풀이 과정 요약 */
  work: string;
  /** 풀이 과정의 문제점 */
  issues: string[];
};

export type ScoreSummary = {
  /** 100점 만점 환산 점수 */
  score: number;
  total: number;
  correct: number;
  wrong: number;
  blank: number;
  /** 채점 완료 문항 수 / 전체 문항 수 */
  graded: number;
  problems: number;
};

/**
 * 채점 입력 서명 — 이 값이 같으면 결과가 같으므로 재호출하지 않는다.
 * 필기(획 id 집합)·영역·문제 번호가 바뀌면 값이 달라진다.
 */
export function gradeSignature(c: ProblemCluster): string {
  const ids = [...c.strokeIds].sort().join(',');
  const b = c.bbox;
  const box = [b.minX, b.minY, b.maxX, b.maxY]
    .map((v) => Math.round(v * 10))
    .join('_');
  return `${c.meta?.no ?? c.label}|${box}|${c.strokeIds.length}|${hash(ids)}`;
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * 100점 만점 점수. 배점이 지정된 문항은 그 배점, 없으면 남은 점수를 균등 배분한다.
 * (시험지에 "각 문항 10점" 표기가 없어도 항상 100점 만점으로 환산)
 */
export function computeScore(grades: ProblemGrade[]): ScoreSummary {
  const problems = grades.length;
  const specified = grades.filter((g) => g.points > 0);
  const specifiedSum = specified.reduce((a, g) => a + g.points, 0);
  const rest = Math.max(0, 100 - specifiedSum);
  const unspecified = problems - specified.length;
  const evenPoints = unspecified > 0 ? rest / unspecified : 0;

  let score = 0;
  let correct = 0;
  let wrong = 0;
  let blank = 0;
  for (const g of grades) {
    const pts = g.points > 0 ? g.points : evenPoints;
    // **정답이 아니면 무조건 틀림** (사용자 지시 2026-08-26). 판정 불가를 남기면
    // 화면에 "—" 가 떠서 채점 결과가 없는 문항처럼 보인다.
    // 손도 안 댄 문항은 blank 로 **함께** 세어 "미응시" 표시에만 쓴다.
    if (g.verdict === 'correct') {
      score += pts;
      correct += 1;
    } else {
      wrong += 1;
      if (g.verdict === 'blank') blank += 1;
    }
  }
  // 배점 합이 100 을 넘거나 모자라면 100점 만점으로 정규화
  const totalPoints = grades.reduce(
    (a, g) => a + (g.points > 0 ? g.points : evenPoints),
    0,
  );
  const normalized =
    totalPoints > 0 ? Math.round((score / totalPoints) * 100) : 0;
  return {
    score: normalized,
    total: 100,
    correct,
    wrong,
    blank,
    graded: grades.filter((g) => g.verdict !== 'unknown').length,
    problems,
  };
}
