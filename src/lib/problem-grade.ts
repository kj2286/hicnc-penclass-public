/**
 * 문항 채점 — 인쇄 지문(정답 도출) + 학생 필기(오버레이 이미지)를 한 번에 보고
 * **맞았는지 틀렸는지**와 풀이 과정의 문제점을 판정한다.
 *
 * 설계 원칙
 *  - **문항당 비전 호출 1회.** 결과는 storage 캐시에 서명(sig)과 함께 저장하고,
 *    필기·영역이 그대로면 두 번 다시 호출하지 않는다 (사용자 요구, 2026-08-13).
 *  - 필기가 아예 없으면 호출조차 하지 않고 `blank` (안 푼 문제).
 *  - 정답은 **지문에서 모델이 직접 도출**한다. 학생 답을 정답처럼 믿지 않는다.
 */
import { recognizeImage } from '@/lib/api';
import { buildGradingPrompt, gradingSigExt, sameGradedSheetAnswer, sheetGradingSigExt } from './korean-grading';
import { repairModelJson } from './json-repair';
import { downloadJsonObject, uploadJsonObject } from '@/lib/strokes-io';
import {
  renderProblemRegionImage,
  subjectForNcodePage,
  type ProblemCluster,
} from './problem-detect';
import type { PaperSubject } from './paper-subject';
import type { Stroke } from '@/pen/live/model/stroke';
import {
  computeScore,
  gradeSignature,
  type GradeVerdict,
  type ProblemGrade,
  type ScoreSummary,
} from './grade-score';

export { computeScore, gradeSignature };
export type { GradeVerdict, ProblemGrade, ScoreSummary };



type Cached = ProblemGrade & { sig: string };

export type GradeCache = { v: 1; byProblem: Record<string, Cached> };

export function gradeCachePath(studentId: string, submissionId: string): string {
  return `${studentId}/${submissionId}.grade.json`;
}

export async function loadGradeCache(
  studentId: string,
  submissionId: string,
): Promise<GradeCache> {
  const doc = await downloadJsonObject<GradeCache | null>(
    gradeCachePath(studentId, submissionId),
  ).catch(() => null);
  return doc && doc.v === 1 ? doc : { v: 1, byProblem: {} };
}

export async function saveGradeCache(
  studentId: string,
  submissionId: string,
  cache: GradeCache,
): Promise<void> {
  await uploadJsonObject(gradeCachePath(studentId, submissionId), cache).catch(
    () => {},
  );
}



export function blankGrade(c: ProblemCluster): ProblemGrade {
  return {
    problemId: c.id,
    no: c.meta?.no ?? 0,
    label: c.label,
    points: c.meta?.points ?? 0,
    verdict: 'blank',
    studentAnswer: '',
    correctAnswer: '',
    explanation: '',
    work: '',
    issues: [],
  };
}

/**
 * 문항 하나 채점. 캐시에 유효한 결과가 있으면 그대로 돌려준다(호출 없음).
 * 반환 `fromCache` 로 호출 여부를 알 수 있다.
 */
export async function gradeProblem(args: {
  page: { section: number; owner: number; noteId: number; pageNumber: number };
  cluster: ProblemCluster;
  strokes: Stroke[];
  cache: GradeCache;
  /** 학원 채점·평가 기준 (교재·문항별 프롬프트, paper-prompts.gradeDirective) */
  directive?: string;
  /** directive 의 서명 꼬리 (paper-prompts.promptSigExt) — 캐시 무효화 기준 */
  sigExt?: string;
  /** 교재 과목. 안 주면 ncode 로 교재를 찾아 읽고, 그래도 없으면 수학. */
  subject?: PaperSubject | null;
  /** 국어 별도 답안. 본문 필기와 분리하여 평가한다. */
  studentAnswerOverride?: string;
}): Promise<{ grade: ProblemGrade; fromCache: boolean }> {
  const { page, cluster, strokes, cache, directive, sigExt = '' } = args;
  const subject = args.subject ?? (await subjectForNcodePage(page));
  const override = subject === '국어' ? args.studentAnswerOverride : undefined;
  const sig = gradeSignature(cluster) + (override === undefined ? gradingSigExt(subject, sigExt) : sheetGradingSigExt(sigExt, override));
  const hit = cache.byProblem[override === undefined ? cluster.id : `${cluster.id}:sheet`];
  if (hit && hit.sig === sig && !(override !== undefined && hit.verdict === 'unknown')) {
    // ⚠️ 배정이 빈 문항의 캐시된 blank 는 신뢰하지 않는다 — 아래 영역 폴백이
    // 생기기 **전에** 저장된 "안 푼" 일 수 있다(2026-08-18 실사고: 3~8번).
    // 영역 검사로 획이 나오면 다시 채점하고, 없으면 어차피 blank 라 비용 0.
    const staleBlank =
      hit.verdict === 'blank' && cluster.strokeIds.length === 0;
    if (!staleBlank) {
      const { sig: _drop, ...grade } = hit;
      void _drop;
      return { grade, fromCache: true };
    }
  }
  // 필기 없음 = 안 푼 문제. 다만 **배정 누락 방어** — 문항 배정(strokeIds)이
  // 비어 있어도 영역 안에 실제 획이 있으면 그것으로 채점한다.
  // 실사고(2026-08-18): "모름"·답만 쓴 두세 획이 배정에서 빠져 3~8번이
  // 전부 "안 푼 문제" 로 남았다. 채점은 배정 결과가 아니라 **지면 위 실물**을
  // 기준으로 해야 한다.
  let gradeStrokeIds = cluster.strokeIds;
  if (gradeStrokeIds.length === 0) {
    const b = cluster.bbox;
    gradeStrokeIds = strokes
      .filter((st) => {
        const d = st.dots[Math.floor(st.dots.length / 2)];
        return (
          !!d && d.x >= b.minX && d.x <= b.maxX && d.y >= b.minY && d.y <= b.maxY
        );
      })
      .map((st) => st.id);
  }
  if (gradeStrokeIds.length === 0 && override === undefined) {
    return { grade: blankGrade(cluster), fromCache: false };
  }

  const dataUrl = await renderProblemRegionImage({
    page,
    bbox: cluster.bbox,
    strokes,
    includeStrokeIds: gradeStrokeIds,
    topLimit: cluster.meta?.numberY,
    maxWidth: 1100,
  });
  if (!dataUrl) {
    return {
      grade: { ...blankGrade(cluster), verdict: 'unknown' },
      fromCache: false,
    };
  }

  const meta = cluster.meta;
  // 과목을 안 주면 교재에서 찾는다 — "수학 시험지" 로 못박으면 국어·영어·과학
  // 문항을 수학 문제로 읽으려 들어 채점이 어긋난다.
  const prompt = buildGradingPrompt(subject, meta, directive, override);

  try {
    const { text } = await recognizeImage(dataUrl, prompt, {
      subject,
      question: [meta?.question ?? '', ...(meta?.choices ?? []).map((c, i) => `${i + 1}) ${c}`)].filter(Boolean).join('\n'),
    });
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();
    const p = JSON.parse(repairModelJson(cleaned)) as Partial<ProblemGrade> & {
      verdict?: string;
    };
    const verdict: GradeVerdict =
      p.verdict === 'correct' || p.verdict === 'wrong' || p.verdict === 'blank'
        ? p.verdict
        : 'unknown';
    return {
      grade: {
        ...blankGrade(cluster),
        verdict,
        studentAnswer: override ?? String(p.studentAnswer ?? ''),
        correctAnswer: String(p.correctAnswer ?? ''),
        explanation: String(p.explanation ?? ''),
        work: String(p.work ?? ''),
        issues: Array.isArray(p.issues) ? p.issues.map(String).slice(0, 5) : [],
      },
      fromCache: false,
    };
  } catch {
    return {
      grade: { ...blankGrade(cluster), verdict: 'unknown' },
      fromCache: false,
    };
  }
}

/** 채점 결과를 캐시에 반영 (서명 포함).
 *  sigExt: 학원 프롬프트 서명 꼬리(promptSigExt) — 지시문이 바뀌면 재채점되게 */
export function putGrade(
  cache: GradeCache,
  cluster: ProblemCluster,
  grade: ProblemGrade,
  sigExt = '',
): GradeCache {
  return {
    v: 1,
    byProblem: {
      ...cache.byProblem,
      [cluster.id]: { ...grade, sig: gradeSignature(cluster) + sigExt },
    },
  };
}



/** 별도 답안의 의미 채점. 같은 학생 답이면 최신 본문 판정을 그대로 재사용한다. */
export async function gradeKoreanSheetProblem(
  args: Omit<Parameters<typeof gradeProblem>[0], 'subject' | 'studentAnswerOverride'> & {
    sheetAnswer: string;
    bodyGrade?: ProblemGrade;
  },
): Promise<{ grade: ProblemGrade; fromCache: boolean }> {
  if (sameGradedSheetAnswer(args.bodyGrade, args.sheetAnswer)) {
    return { grade: args.bodyGrade!, fromCache: true };
  }
  try {
    const result = await gradeProblem({ ...args, subject: '국어', studentAnswerOverride: args.sheetAnswer });
    return { ...result, grade: { ...result.grade, studentAnswer: args.sheetAnswer.trim() } };
  } catch {
    return { fromCache: false, grade: { ...blankGrade(args.cluster), verdict: 'unknown',
      studentAnswer: args.sheetAnswer.trim(), explanation: '별도 답안을 읽지 못했습니다. 문항 이미지와 답안을 확인한 뒤 다시 시도하세요.' } };
  }
}

export function putKoreanSheetGrade(cache: GradeCache, cluster: ProblemCluster, grade: ProblemGrade, answer: string, ext = ''): GradeCache {
  return { v: 1, byProblem: { ...cache.byProblem,
    [`${cluster.id}:sheet`]: { ...grade, studentAnswer: answer.trim(), sig: gradeSignature(cluster) + sheetGradingSigExt(ext, answer) },
  } };
}
