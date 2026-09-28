/**
 * **같은 시험지를 푼 다른 학생들의 평균** — 리포트 레이더의 비교선.
 *
 * 지금까지 "학원 평균 비교선은 없습니다" 라고만 적혀 있었다. 집계를 아예
 * 만들지 않았기 때문이다(사용자 지적 2026-08-25). 재료는 이미 있다:
 * 학생별 `{studentId}/{submissionId}.learn-report.json` 에 문항별 단원과 정오가 들어 있다.
 *
 * 📌 범위는 **내가 볼 수 있는 학생**(listMyStudents)이다 — 저장소 접근 권한이
 *    거기까지다. 학원 전체가 필요하면 서버 집계가 따로 있어야 한다.
 * 📌 본인은 제외한다. 비교선이 자기 자신을 포함하면 비교가 되지 않는다.
 */
import { finalCachedGrades } from './korean-grading';
import { examSetTitle } from './exam-set';
import { finalVerdict, medianActiveMs, perceivedDifficulty10 } from './difficulty';
import { loadLearnReport } from './learn-report';
import { loadGradeCache } from './problem-grade';

export type ClassAverage = {
  /** 단원 → 평균 정답률(0~100) */
  byUnit: Record<string, number>;
  /** 문항 라벨 → **평균 체감 난이도(1~10)** — 난이도 그래프의 파란 선 */
  perceivedByLabel: Record<string, number>;
  /** 집계에 들어간 학생 수 (본인 제외) */
  students: number;
  /** 다른 학생들의 **맞은 개수** — 평균·표준편차·석차의 재료.
   *  **채점 결과(grade.json)** 만 있으면 들어온다 — 리포트 생성 여부와 무관하다. */
  correctCounts: number[];
  /** 맞은 개수 집계에 들어간 학생 수 (본인 제외) */
  scoredStudents: number;
  /** 다른 학생들의 **실수 문제 수** (풀이는 됐는데 최종 답이 틀린 것) */
  mistakeCounts: number[];
  /** 같은 시험지로 인정한 제목 */
  setTitle: string;
};

type StudentLike = { id: string; name: string };
type SubmissionLike = { id: string; title: string };

/**
 * @param selfStudentId 이 리포트의 학생 — 평균에서 뺀다
 * @param title 이 제출의 제목 (세트 이름으로 정규화해 비교한다)
 */
export async function loadClassAverage(args: {
  selfStudentId: string;
  title: string;
  listStudents: () => Promise<StudentLike[]>;
  listSubmissions: (studentId: string) => Promise<SubmissionLike[]>;
}): Promise<ClassAverage | null> {
  const setTitle = examSetTitle(args.title);
  if (!setTitle) return null;
  const students = await args.listStudents().catch(() => []);
  /** 단원 → [맞은 수, 채점된 수] 누적 (학생 단위 평균이 아니라 문항 단위) */
  const sum = new Map<string, { correct: number; judged: number }>();
  /** 문항 라벨 → 체감 난이도 합/개수 (학생마다 한 표) */
  const perceived = new Map<string, { total: number; n: number }>();
  let counted = 0;
  /** 맞은 개수 — **채점 결과 기준**(리포트 없어도 들어온다) */
  const scoreRows: number[] = [];
  const mistakeCounts: number[] = [];

  for (const st of students) {
    if (st.id === args.selfStudentId) continue;
    const subs = await args.listSubmissions(st.id).catch(() => []);
    const match = subs.filter((s) => examSetTitle(s.title) === setTitle);
    if (match.length === 0) continue;
    let used = false;
    /** 리포트가 없어도 **채점 결과만으로** 맞은 개수를 센다.
     *  🚨 예전에는 `learn-report.json` 이 있어야만 집계했다 — 리포트는 선생님이
     *  볼 때 만드는 것이라, 이미 제출·채점이 끝난 학생들이 통째로 빠져
     *  석차·평균·표준편차가 "자료 없음" 으로 남았다(사용자 지적 2026-08-27). */
    let okFromGrades = 0;
    let gradedAny = false;
    for (const sub of match) {
      const gc = await loadGradeCache(st.id, sub.id).catch(() => null);
      const rows = finalCachedGrades(gc);
      if (rows.length > 0) {
        gradedAny = true;
        okFromGrades += rows.filter(
          (g) => finalVerdict(g.verdict) === 'correct',
        ).length;
      }
    }
    if (gradedAny) scoreRows.push(okFromGrades);

    for (const sub of match) {
      const rep = await loadLearnReport(st.id, sub.id).catch(() => null);
      if (!rep) continue;
      const med = medianActiveMs(rep.problems);
      for (const p of rep.problems) {
        // 체감 난이도는 정오와 무관하게 **모든 문항**에서 잰다
        const pd = perceivedDifficulty10(
          {
            verdict: p.verdict,
            attempts: p.attempts,
            revisits: p.revisits,
            activeMs: p.activeMs,
          },
          { medianActiveMs: med },
        );
        const cell = perceived.get(p.label) ?? { total: 0, n: 0 };
        cell.total += pd;
        cell.n += 1;
        perceived.set(p.label, cell);
        used = true;

        const unit = p.unit?.trim();
        if (!unit) continue;
        if (p.verdict !== 'correct' && p.verdict !== 'wrong') continue;
        const cur = sum.get(unit) ?? { correct: 0, judged: 0 };
        cur.judged += 1;
        if (p.verdict === 'correct') cur.correct += 1;
        sum.set(unit, cur);
      }
    }
    if (used) {
      counted += 1;
      // 실수 문제 수는 **리포트에만 있는 판정**(mistake)이라 리포트가 있어야 한다
      let miss = 0;
      for (const sub of match) {
        const rep = await loadLearnReport(st.id, sub.id).catch(() => null);
        if (!rep) continue;
        for (const p of rep.problems) if (p.mistake) miss += 1;
      }
      mistakeCounts.push(miss);
    }
  }

  // 리포트가 하나도 없어도 **채점된 학생이 있으면** 석차·평균은 낼 수 있다
  if (counted === 0 && scoreRows.length === 0) return null;
  const byUnit: Record<string, number> = {};
  for (const [unit, v] of sum) {
    byUnit[unit] = Math.round((v.correct / v.judged) * 100);
  }
  const perceivedByLabel: Record<string, number> = {};
  for (const [label, v] of perceived) {
    perceivedByLabel[label] = Math.round((v.total / v.n) * 10) / 10;
  }
  return {
    byUnit,
    perceivedByLabel,
    students: counted,
    setTitle,
    correctCounts: scoreRows,
    mistakeCounts,
    scoredStudents: scoreRows.length,
  };
}

/**
 * 또래 **맞은 개수만** 빠르게 모은다 — 리포트 생성 시 스냅샷으로 저장할 값.
 * 화면에서 훑으면 몇 초씩 비므로, 생성 시점에 한 번만 계산한다
 * (사용자 요구 2026-08-27: "분석 리포트에 들어가면 기다리는 게 없어야 한다").
 */
export async function loadClassScores(
  selfStudentId: string | undefined,
  title: string,
): Promise<{
  correctCounts: number[];
  students: number;
  computedAt: string;
  /** 단원 → 다른 학생들의 평균 정답률(0~100) — 레이더의 점선 */
  byUnit?: Record<string, number>;
} | null> {
  const target = examSetTitle(title);
  if (!target) return null;
  const { listMyStudents, listStudentSubmissions } = await import('@/lib/api');
  const students = await listMyStudents().catch(() => []);
  const counts: number[] = [];
  /** 단원별 정오 누적 — 단원은 **리포트에만** 있는 값이라 있는 학생만 들어간다 */
  const unitSum = new Map<string, { correct: number; judged: number }>();
  for (const st of students) {
    if (st.id === selfStudentId) continue;
    const subs = await listStudentSubmissions(st.id).catch(() => []);
    const match = subs.filter((s) => examSetTitle(s.title) === target);
    if (match.length === 0) continue;
    let ok = 0;
    let any = false;
    for (const sub of match) {
      const gc = await loadGradeCache(st.id, sub.id).catch(() => null);
      const rows = finalCachedGrades(gc);
      if (rows.length > 0) {
        any = true;
        ok += rows.filter((g) => finalVerdict(g.verdict) === 'correct').length;
      }
      const rep = await loadLearnReport(st.id, sub.id).catch(() => null);
      for (const p of rep?.problems ?? []) {
        const unit = p.unit?.trim();
        if (!unit) continue;
        const cur = unitSum.get(unit) ?? { correct: 0, judged: 0 };
        cur.judged += 1;
        if (finalVerdict(p.verdict) === 'correct') cur.correct += 1;
        unitSum.set(unit, cur);
      }
    }
    if (any) counts.push(ok);
  }
  if (counts.length === 0 && unitSum.size === 0) return null;
  const byUnit: Record<string, number> = {};
  for (const [unit, v] of unitSum) {
    byUnit[unit] = Math.round((v.correct / v.judged) * 100);
  }
  return {
    correctCounts: counts,
    students: counts.length,
    computedAt: new Date().toISOString(),
    ...(Object.keys(byUnit).length > 0 ? { byUnit } : {}),
  };
}
