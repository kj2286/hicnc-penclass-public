/**
 * AI 분석 근거 텍스트(problemsContext) 빌더.
 *
 * 화면(ReviewPage)과 수신 후 자동 분석 파이프라인(auto-grade)이 **같은
 * 문맥**을 만들어야 한다 — 분석 결과는 서버 캐시(.analysis.{scope}.json)에
 * 처음 만든 것이 남으므로, 파이프라인이 빈약한 문맥으로 먼저 만들면 화면에서
 * 열어도 그 빈약한 결과가 보인다. (원래 ReviewPage 인라인 useMemo 였던 것을
 * 2026-08-19 파이프라인 공유를 위해 추출 — 내용 변경 없음.)
 */
import {
  buildProblemTimelines,
  formatProblemsContext,
} from './problem-timeline';
import type { ProblemCluster } from './problem-detect';
import type { ProblemGrade } from './grade-score';
import type { Stroke } from '@/pen/live/model/stroke';

export function buildProblemsContextText(args: {
  strokes: Stroke[];
  clusters: ProblemCluster[];
  grades: Record<string, ProblemGrade>;
  selectedClusterId?: string | null;
}): string {
  const { strokes: allStrokes, clusters: allClusters, grades } = args;
  if (allStrokes.length === 0 || allClusters.length === 0) return '';
  const t0 = Math.min(...allStrokes.map((st) => st.startedAt));
  const timelines = buildProblemTimelines(allStrokes, allClusters, t0);
  const base = formatProblemsContext(timelines, args.selectedClusterId ?? null);
  // 채점 결과를 분석의 근거로 함께 넘긴다 — AI 가 정오를 다시 추측하지 않고
  // "왜 틀렸는지·어디서 막혔는지"에 집중하게 한다 (사용자 요구 2026-08-13)
  const contextClusters = args.selectedClusterId
    ? allClusters.filter(c => c.id === args.selectedClusterId)
    : allClusters;
  const gradeLines = contextClusters
    .map((c) => grades[c.id])
    .filter((g): g is ProblemGrade => !!g && g.verdict !== 'blank')
    .map(
      (g) =>
        `- ${g.label}: ${
          g.verdict === 'correct' ? '정답' : g.verdict === 'wrong' ? '오답' : '판정 불가'
        }` +
        (g.correctAnswer ? ` · 정답 ${g.correctAnswer}` : '') +
        (g.studentAnswer ? ` · 학생 답 ${g.studentAnswer}` : '') +
        (g.work ? ` · 풀이 ${g.work}` : '') +
        (g.issues.length > 0 ? ` · 문제점 ${g.issues.join(' / ')}` : ''),
    );
  // 교재에서 읽어낸 **문제 지문·보기**를 함께 넘긴다 — 이게 없으면 AI 는
  // 학생 필기만 보고 "무슨 문제를 푼 건지" 모른 채 분석하게 된다
  // (사용자 요구 2026-08-17: OCR 로 읽은 문제 내용이 과정분석에 있어야 함).
  const questionLines = contextClusters
    .filter((c) => c.meta?.question)
    .sort((a, b) => (a.meta?.no ?? 0) - (b.meta?.no ?? 0))
    .map((c) => {
      const m = c.meta!;
      const ch =
        m.choices.length > 0
          ? ` / 보기: ${m.choices.map((x, i) => `${i + 1}) ${x}`).join(' ')}`
          : '';
      return `- ${m.no}번(${m.type}${m.points ? ` ${m.points}점` : ''}): ${m.question}${ch}`;
    });

  // 시험지는 [문제] / [풀이 공간] / [답란] 3구역으로 인쇄된다. 학생이 **어느
  // 구역에 썼는지**가 곧 "풀이를 남겼는지 / 답만 썼는지" 의 근거다.
  const zoneLines = contextClusters
    .filter((c) => c.meta)
    .sort((a, b) => (a.meta?.no ?? 0) - (b.meta?.no ?? 0))
    .map((c) => {
      const m = c.meta!;
      const inZone = (yTop: number, yBot: number) =>
        allStrokes.filter((st) => {
          if (!c.strokeIds.includes(st.id)) return false;
          const cy =
            st.dots.reduce((acc, d) => acc + d.y, 0) / Math.max(1, st.dots.length);
          return cy >= yTop && cy < yBot;
        }).length;
      const bottom = c.bbox.maxY;
      const work = inZone(m.workTopY, m.answerTopY ?? bottom);
      const ans = m.answerTopY != null ? inZone(m.answerTopY, bottom) : 0;
      const onQuestion = inZone(c.bbox.minY, m.workTopY);
      return `- ${m.no}번: 문제 위 ${onQuestion}획 / 풀이 공간 ${work}획 / 답란 ${ans}획`;
    });

  const extra: string[] = [];
  if (questionLines.length > 0) {
    extra.push(
      '',
      '## 교재에서 읽어낸 문제 (이 문제를 푼 것입니다 — 분석의 전제로 쓰세요)',
      ...questionLines,
    );
  }
  if (zoneLines.length > 0) {
    extra.push(
      '',
      '## 학생이 쓴 위치 (시험지 3구역: 문제 / 풀이 공간 / 답란)',
      '풀이 공간에 획이 없고 답란에만 있으면 **풀이 과정 없이 답만 썼다**는 뜻입니다.',
      ...zoneLines,
    );
  }
  if (gradeLines.length > 0) {
    extra.push(
      '',
      '## 채점 결과 (지문에서 정답을 도출해 학생 답과 대조한 결과 — 이 판정을 신뢰하세요)',
      ...gradeLines,
    );
  }
  return extra.length > 0 ? [base, ...extra].join('\n') : base;
}
