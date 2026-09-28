import { gradingSigExt, isCurrentGrading, KOREAN_GRADING_VERSION, needsKoreanSheetGrading, sheetGradingSigExt, currentGradingSubjects, type GradingSubjects, pruneSheetGrades } from './korean-grading';
import { ASSESSMENT_VERSION, isCurrentAssessment, preserveExistingReport } from './assessment';
/**
 * **수신 후 자동 AI 채점 파이프라인** (사용자 요구 2026-08-19).
 *
 * 크래들에서 필기를 받으면 선생님이 학생 기록을 하나하나 열어 채점이 끝나길
 * 기다릴 필요 없이, 저장이 끝난 문서부터 **백그라운드로 문항 인식 → 채점**을
 * 돌려 캐시에 남긴다. 나중에 문서를 열면 캐시가 그대로 보인다 — AI 재호출 없음.
 *
 * 원칙
 *  - **화면(ReviewPage)과 완전히 같은 계산**을 쓴다: detectProblemsForPage
 *    (캐시 우선) → assignStrokesToClusters(sanitizeStrokes(...)) → gradeProblem.
 *    특히 재배정을 화면과 똑같이 해야 채점 서명(sig)이 일치해 이중 채점이 없다.
 *  - **이미 채점된 문항은 건너뛴다** (sig 동일 = 캐시 히트). 새 필기가 들어와
 *    배정이 바뀐 문항만 다시 채점된다 — 증분 업데이트.
 *  - '단순노트' 교재와 미등록 연습장 페이지는 채점 대상이 아니다.
 *  - 기한 없음 · 사용자 취소 가능 (isCancelled 콜백).
 */
import {
  downloadJsonObject,
  downloadStrokes,
  strokesPath,
  uploadJsonObject,
} from './strokes-io';
import { buildPageKey } from './pen-event-bus';
import { lookupNcodeEntry } from '@/store/paper.store';
import { listMyPaperMeta, type PaperMeta } from './paper-owners';
import {
  effectiveSubject,
  subjectAnalysisDirective,
  type PaperSubject,
} from './paper-subject';
import { solutionDirective, solutionFor, type SolutionsDoc } from './solutions';
import { loadSolutionsDoc, solutionsSignature } from './solutions-io';
import {
  detectProblemsForPage,
  problemScopeStrokes,
  reassignClusters,
  type ProblemCluster,
} from './problem-detect';
import {
  blankGrade,
  gradeProblem,
  gradeKoreanSheetProblem,
  putKoreanSheetGrade,
  gradeSignature,
  loadGradeCache,
  putGrade,
  saveGradeCache,
  type ProblemGrade,
} from './problem-grade';
import { buildProblemsContextText } from './problems-context';
import { buildProblemTimelines } from './problem-timeline';
import { loadLearnReport, runLearnReport, saveLearnReport } from './learn-report';
import {
  loadProblemComparisons,
  loadProblemInsights,
  problemScopeKey,
} from './analysis-cache';
import { lookupPaperUnitEntry } from './paper-unit-map';
import { listPdfPagesFromIndex, type PdfIndexPage } from '@/store/paper.store';
import { analyzeWriting } from './api';
import {
  analysisDirective,
  gradeDirective,
  loadPaperPromptConfig,
  promptSigExt,
  reportDirective,
  type PaperPromptConfig,
} from './paper-prompts';
import { resolvePrintedAnswer } from './printed-answer';
import { AI_EPOCH } from './ai-epoch';
import { ENGLISH_ANALYSIS_VERSION } from './english-analysis';
import { carryStages } from './stage-carry';
import { useSessionStore } from '@/store/session.store';
import {
  cachedPageKinds,
  classifyPrintedPage,
  compareIdInfo,
  mergeSheetVerdict,
  readPageHeading,
  recognizeAnswerSheet,
  recognizeIdInfo,
  type AnswerSheetDoc,
} from './special-pages';
import {
  beginAutoGrade,
  endAutoGrade,
  markStudentAiDocDone,
  setAnalyzingProblem,
  setDocAiStatus,
  setStudentAiActivity,
} from './receive-state';
import type { Stroke } from '@/pen/live/model/stroke';

/** 문서별 AI 처리 결과 요약 — 필기 기록 리스트의 "완료" 배지 근거.
 *  strokeCount 가 문서와 다르면 "새 필기 분석 대기" 로 보인다. */
export type AiStatusDoc = {
  v: 1;
  /** 이 결과를 만든 규칙 세대 — 지금 세대와 다르면 **완료로 치지 않는다**
   *  (규칙이 바뀌면 옛 캐시가 계속 보이던 문제, 2026-08-25). */
  epoch?: string;
  strokeCount: number;
  totalNumbered: number;
  graded: number;
  /** 인쇄 문항 중 **풀이 획이 하나도 없는** 문항 수 — 학생이 아직 안 푼 것.
   *  (분석 대상에서 빼는 규칙과 같은 기준: `problemScopeStrokes` 가 비었는가.)
   *  구버전 요약에는 없다 — `undefined` 면 화면에서 감춘다. */
  unsolved?: number;
  /** 표지 본인정보의 이름이 이 기록의 학생과 맞는가 —
   *  true=일치 / false=불일치 / null=적히지 않아 판단 불가 / undefined=확인 안 함.
   *  "다른 학생의 필기"는 열어보기 전에 알아야 해서 요약에 함께 남긴다. */
  idNameMatch?: boolean | null;
  /** 시험지 표지에 적혀 있던 이름 (불일치 안내에 그대로 보여준다) */
  idName?: string;
  analyzed: number;
  failed: number;
  updatedAt: string;
  /** 분석을 마친 범위 `${scopeKey}|${채점서명}` — 다음 실행은 여기 있는 문항을
   *  **네트워크 왕복 없이** 건너뛴다 (캐시 확인 호출조차 "다시 갱신" 으로
   *  보인다는 사용자 지적 2026-08-19). 서명이 바뀌면(새 필기) 다시 분석된다. */
  analyzedScopes?: string[];
  /** 이 획 수 기준으로 학습분석 리포트를 만들어 뒀는가 — 같으면 재생성 안 함.
   *  문항 없는 문서(표지 등)도 획 수를 채워 "리포트 불필요·완료" 로 표시한다. */
  reportStrokeCount?: number;
  /**
   * 단계 라벨 재스탬프 세대 — 값이 GROUP_FIX_V 와 다르면(구버전 요약 포함)
   * catch-up 이 이 문서를 한 번 더 지나가며 리포트 문서의 group/label 을
   * 현재 보정된 클러스터로 다시 박는다 (LLM 재호출 없음).
   */
  groupFix?: number;
  /**
   * 이 요약을 만들 때 읽을 수 있던 **해설(모범 풀이) 전체 서명** — 해설이
   * 새로 올라오면(또는 정책 변경으로 처음 읽히면) 값이 달라져 catch-up 이
   * 이 문서를 한 번 더 지나간다. 실제 재분석은 해설이 걸린 문항만 돈다.
   */
  solSig?: string;
  /** 리포트 구성 세대 (REPORT_V) — 다르면 리포트를 다시 만든다 */
  reportV?: number;
  /** 이번 실행에서 모범 풀이가 붙은 문항 수 — 진단용 (0 이면 해설 미매칭/미로딩) */
  solHit?: number;
  gradingVersion?: string;
  englishAnalysisVersion?: string;
  gradingSubjects?: GradingSubjects;
};

export function aiStatusPath(studentId: string, submissionId: string): string {
  return `${studentId}/${submissionId}.ai-status.json`;
}

export async function loadAiStatus(
  studentId: string,
  submissionId: string,
): Promise<AiStatusDoc | null> {
  const doc = await downloadJsonObject<AiStatusDoc | null>(
    aiStatusPath(studentId, submissionId),
  ).catch(() => null);
  return doc && doc.v === 1 ? doc : null;
}

export type AutoGradeJob = {
  studentId: string;
  submissionId: string;
  studentName: string;
  title: string;
};

export type AutoGradeProgress = {
  /** 처리 중인 문서 순번(1부터) / 전체 문서 수 */
  doc: number;
  docs: number;
  studentName: string;
  title: string;
  stage: '문항 인식' | '채점' | '문항 분석' | '리포트 생성';
  done: number;
  total: number;
};

export type AutoGradeDocResult = {
  job: AutoGradeJob;
  ok: boolean;
  /** 건너뛴 이유 ('단순노트' 등) — 있으면 채점 안 함 */
  skipped?: string;
  /** 이번에 새로 AI 를 호출해 채점한 문항 수 */
  gradedCalls: number;
  /** 번호 있는(=채점 대상) 문항 수 */
  totalNumbered: number;
  /** 채점 실패 문항 수 — 캐시에 안 남겨 다음 열람 때 자동 재시도된다 */
  failed: number;
  error?: string;
};

type PageGroup = {
  key: string;
  page: { section: number; owner: number; noteId: number; pageNumber: number };
  strokes: Stroke[];
};

function groupPages(strokes: Stroke[]): PageGroup[] {
  const map = new Map<string, PageGroup>();
  for (const s of strokes) {
    const key = buildPageKey(s.section, s.owner, s.noteId, s.pageNumber);
    const g = map.get(key);
    if (g) g.strokes.push(s);
    else
      map.set(key, {
        key,
        page: {
          section: s.section,
          owner: s.owner,
          noteId: s.noteId,
          pageNumber: s.pageNumber,
        },
        strokes: [s],
      });
  }
  return [...map.values()];
}

/**
 * 교재 전체 문항 수 — 리포트의 분모. 학생이 쓴 페이지의 인식 결과에 더해,
 * 안 쓴 페이지도 인식(캐시 우선)해 센다. 번호 있는 문항만 문제로 친다.
 * (ReviewPage 의 전수 인식 스윕과 같은 정의 — 결과는 같은 캐시에 남아
 * 화면에서 열어도 재인식하지 않는다.)
 */
/** 학생이 손대지 않은 교재 페이지에서 인식한 문항 — 정답지 판정·리포트 분모의 재료 */
type SweptPage = {
  pdfId: number;
  page: PdfIndexPage;
  clusters: ProblemCluster[];
};

async function sweepPdfPages(
  job: AutoGradeJob,
  pages: PageGroup[],
  clustersByPage: Map<string, ProblemCluster[]>,
  meta: Map<number, PaperMeta>,
): Promise<Map<string, SweptPage>> {
  const swept = new Map<string, SweptPage>();
  const counted = new Set<string>();
  for (const [key, cs] of clustersByPage) {
    if (cs.filter((c) => c.meta?.no != null).length > 0) counted.add(key);
  }
  const pdfIds = new Set<number>();
  for (const pg of pages) {
    const e = await lookupNcodeEntry(
      pg.page.section,
      pg.page.owner,
      pg.page.noteId,
      pg.page.pageNumber,
    ).catch(() => null);
    if (e?.pdfId != null) pdfIds.add(e.pdfId);
  }
  for (const pdfId of pdfIds) {
    const all = await listPdfPagesFromIndex(pdfId).catch(() => []);
    const m = meta.get(pdfId);
    const kinds = cachedPageKinds(pdfId);
    for (const ip of all) {
      // 정답지·본인정보 페이지는 문항이 아니다 (022) — 세지도, 인식하지도 않는다.
      // 교재 설정이 없어도 **이미 판별해 둔 결과**가 있으면 그것도 존중한다
      // (여기서 새로 AI 를 부르지는 않는다 — 교재 전체를 도는 자리라 비싸다).
      if (m?.answerPage === ip.pageIndex || m?.infoPage === ip.pageIndex) continue;
      const kindHere = kinds[ip.pageIndex];
      if (kindHere && (kindHere.kind === 'info' || kindHere.kind === 'answer'))
        continue;
      const key = buildPageKey(ip.section, ip.owner, ip.noteId, ip.pageNumber);
      if (counted.has(key) || swept.has(key)) continue;
      const cs = await detectProblemsForPage({
        studentId: job.studentId,
        submissionId: job.submissionId,
        pageKey: key,
        page: ip,
        strokes: [],
      }).catch(() => [] as ProblemCluster[]);
      swept.set(key, { pdfId, page: ip, clusters: cs ?? [] });
    }
  }
  return swept;
}


async function autoGradeOne(
  job: AutoGradeJob,
  doc: number,
  docs: number,
  opts: {
    isCancelled?: () => boolean;
    onProgress?: (p: AutoGradeProgress) => void;
  },
): Promise<AutoGradeDocResult> {
  const base: AutoGradeDocResult = {
    job,
    ok: false,
    gradedCalls: 0,
    totalNumbered: 0,
    failed: 0,
  };
  const cancelled = () => opts.isCancelled?.() === true;
  const progress = (
    stage: AutoGradeProgress['stage'],
    done: number,
    total: number,
  ) => {
    // 필기 기록 리스트(문서별)·학생 관리 리스트(학생별)가 구독한다
    setDocAiStatus(job.submissionId, { stage, done, total });
    setStudentAiActivity(job.studentId, {
      stage,
      done,
      total,
      title: job.title,
    });
    opts.onProgress?.({
      doc,
      docs,
      studentName: job.studentName,
      title: job.title,
      stage,
      done,
      total,
    });
  };

  const strokes = await downloadStrokes(
    strokesPath(job.studentId, job.submissionId),
  );
  if (strokes.length === 0) return { ...base, ok: true, skipped: '필기 없음' };
  // 이전 처리 요약 — 이미 분석을 마친 문항은 확인 호출조차 하지 않기 위해
  const prevStatus = await loadAiStatus(job.studentId, job.submissionId);

  const meta = await listMyPaperMeta().catch(
    () => new Map<number, PaperMeta>(),
  );
  const pages = groupPages(strokes);

  // ── 1) 문항 인식 (detectProblemsForPage 가 스스로 storage 캐시를 읽고 쓴다) ──
  const clustersByPage = new Map<string, ProblemCluster[]>();
  /** 페이지 → 교재 pdfId (학원 프롬프트 적용 기준) */
  const pdfIdByPage = new Map<string, number>();
  /** 페이지 키 → 교재(PDF) 페이지 번호 — 내신 리포트의 페이지별 흐름에 쓴다 */
  const pageIndexByPage = new Map<string, number>();
  /** 페이지 → 교재(PDF) 제목. 표지 판별은 **문서 제목이 아니라 교재 제목**으로
   *  해야 한다 — 표지·문제지를 한 세트 문서로 묶으면서 문서 제목에서 "표지" 가
   *  사라졌다 (2026-08-25). */
  const paperTitleByPage = new Map<string, string>();
  const paperTitleByPdf = new Map<number, string>();
  /** 정답지 페이지 (022) — 정답지 기준 채점에 사용 */
  const sheetPageKeys = new Map<string, PageGroup>();
  /** 본인정보(표지) 페이지 — 이름 대조에 사용 */
  let infoPageGroup: PageGroup | null = null;
  let anyPaper = false;
  for (let i = 0; i < pages.length; i++) {
    if (cancelled()) return { ...base, error: '취소됨' };
    const pg = pages[i];
    progress('문항 인식', i + 1, pages.length);
    const entry = await lookupNcodeEntry(
      pg.page.section,
      pg.page.owner,
      pg.page.noteId,
      pg.page.pageNumber,
    ).catch(() => null);
    // 미등록 연습장 페이지 — 문제지가 아니므로 자동 채점 대상이 아니다
    if (entry?.pdfId == null) continue;
    pdfIdByPage.set(pg.key, entry.pdfId);
    if (entry.pageIndex != null) pageIndexByPage.set(pg.key, entry.pageIndex);
    if (entry.pdfTitle) {
      paperTitleByPage.set(pg.key, entry.pdfTitle);
      paperTitleByPdf.set(entry.pdfId, entry.pdfTitle);
    }
    const m = meta.get(entry.pdfId);
    // 정답지·본인정보 페이지는 문항이 아니다 — 디텍션에서 제외 (022)
    if (
      entry.pageIndex != null &&
      (m?.answerPage === entry.pageIndex || m?.infoPage === entry.pageIndex)
    ) {
      if (m?.answerPage === entry.pageIndex) sheetPageKeys.set(pg.key, pg);
      continue;
    }
    // 교재에 지정이 없어도 **인쇄 원본을 보고** 표지·정답지를 알아낸다
    // (사용자 요구 2026-08-24). 필기가 있는 페이지에만 물어보고, 결과는
    // 교재 단위 캐시라 같은 교재의 두 번째 학생부터는 호출이 없다.
    const kind = await classifyPrintedPage({
      pdfId: entry.pdfId,
      pageIndex: entry.pageIndex ?? null,
      page: pg.page,
    }).catch(() => null);
    if (kind?.kind === 'answer') {
      sheetPageKeys.set(pg.key, pg);
      continue;
    }
    // '단순노트' 교재는 문항·정답 개념이 없다 (ReviewPage 자동 인식과 동일 규칙)
    if (m?.kind === '단순노트') continue;
    anyPaper = true;
    const clusters = await detectProblemsForPage({
      studentId: job.studentId,
      submissionId: job.submissionId,
      pageKey: pg.key,
      page: pg.page,
      strokes: pg.strokes,
    }).catch(() => null);
    const numbered = (clusters ?? []).filter((c) => c.meta?.no != null).length;
    // 🚨 info/blank 판정은 **문항 인식으로 교차검증한 뒤에만** 믿는다.
    // AI 가 문제 페이지를 표지로 잘못 보면 그 페이지 채점이 통째로 사라진다 —
    // 번호 있는 문항이 실제로 하나도 없을 때만 표지·빈 페이지로 인정한다.
    if ((kind?.kind === 'info' || kind?.kind === 'blank') && numbered === 0) {
      // 본인정보 페이지 — 문항은 없지만 **본인 확인**을 여기서 한다
      if (kind.kind === 'info' && pg.strokes.length > 0) infoPageGroup = pg;
      continue;
    }
    if (!clusters || clusters.length === 0) continue;
    // 공용 헬퍼 — 화면(ReviewPage)·채점 루프와 **같은 배정**이어야 채점
    // 서명(sig)이 일치해 이중 채점이 없다.
    clustersByPage.set(pg.key, reassignClusters(clusters, pg.strokes));
  }
  if (!anyPaper) return { ...base, ok: true, skipped: '문제지 아님' };

  // ── 1.5) 안 쓴 쪽의 문항 병합 (사용자 신고 2026-09-02: "단계별 4문항") ──
  // sweepPdfPages 는 그동안 분모·정답지 판정에만 쓰였고, 리포트 문항은
  // **타임라인 = 필기한 쪽 클러스터**에서만 만들어 손도 안 댄 쪽의 문항이
  // 리포트에서 통째로 빠졌다. 여기서 본류(pages·clustersByPage)에 합친다 —
  //  · 채점: 획이 없어 blank (LLM 0회) → 정오 '틀림' + 화면 '미응시' 안내
  //  · 단계 이어받기·집계·분석 대상 제외·리포트·LT 표: 필기 문항과 동일 취급
  //  · 인식은 제출별 problems.json 캐시 — 리뷰 화면 전수 스윕과 공유(재호출 0)
  {
    const sweptPages = await sweepPdfPages(job, pages, clustersByPage, meta).catch(
      () => new Map<string, SweptPage>(),
    );
    for (const [key, sp] of sweptPages) {
      if (sp.clusters.filter((c) => c.meta?.no != null).length === 0) continue;
      pages.push({ key, page: sp.page, strokes: [] });
      clustersByPage.set(key, sp.clusters);
      pdfIdByPage.set(key, sp.pdfId);
      const t = paperTitleByPdf.get(sp.pdfId);
      if (t) paperTitleByPage.set(key, t);
    }
  }

  // 학원 교재·문항별 프롬프트 (토글 OFF/미설정이면 빈 설정 — 공통 프롬프트만).
  // 지시문 합성·서명은 paper-prompts 모듈로만 — 화면과 어긋나면 재채점이 부활한다.
  const academyId = useSessionStore.getState().profile?.academyId ?? null;
  const promptCfg: PaperPromptConfig = await loadPaperPromptConfig(
    academyId,
    [...new Set(pdfIdByPage.values())],
  );

  const gradeSubjectForPage = (key: string): PaperSubject => effectiveSubject(meta.get(pdfIdByPage.get(key) ?? -1)?.subject);

  // ── 2) 채점 — sig 가 같은(이미 채점된) 문항은 건너뛴다 (증분) ──
  let cache = await loadGradeCache(job.studentId, job.submissionId);
  const todo: Array<{
    pg: PageGroup;
    cluster: ProblemCluster;
    directive: string;
    sigExt: string;
  }> = [];
  let totalNumbered = 0;
  for (const pg of pages) {
    for (const c of clustersByPage.get(pg.key) ?? []) {
      if (c.meta?.no == null) continue; // 번호 없는 획 영역은 문제가 아니다
      totalNumbered++;
      const directive = gradeDirective(promptCfg, pdfIdByPage.get(pg.key), c.meta.no);
      const sigExt = gradingSigExt(gradeSubjectForPage(pg.key), promptSigExt(directive));
      const hit = cache.byProblem[c.id];
      if (hit && hit.sig === gradeSignature(c) + sigExt) continue;
      todo.push({ pg, cluster: c, directive, sigExt });
    }
  }
  let gradedCalls = 0;
  let failed = 0;
  for (let i = 0; i < todo.length; i++) {
    if (cancelled()) break; // 취소돼도 지금까지 채점분은 저장한다
    const { pg, cluster, directive, sigExt } = todo[i];
    progress('채점', i + 1, todo.length);
    try {
      const { grade, fromCache } = await gradeProblem({
        page: pg.page,
        cluster,
        strokes: pg.strokes,
        subject: gradeSubjectForPage(pg.key),
        cache,
        directive: directive || undefined,
        sigExt,
      });
      cache = putGrade(cache, cluster, grade, sigExt);
      if (!fromCache) gradedCalls++;
    } catch {
      // 일시 실패 — 캐시에 안 남겨 다음 열람/수신 때 자동 재시도
      failed++;
    }
  }
  if (gradedCalls > 0 || failed === 0) {
    await saveGradeCache(job.studentId, job.submissionId, cache);
  }

  // ── 3) 문항별 AI 과정 분석 — 사용자가 열어보지 않아도 미리 만들어 둔다
  //      (사용자 요구 2026-08-19: "안 보더라도 자동 문항분석"). 서버가 범위별로
  //      캐시하므로(.analysis.{scope}.json) **이미 분석된 문항은 LLM 호출 없이**
  //      바로 돌아온다 — 완료된 건 다시 만들지 않는다.
  const gradesById: Record<string, ProblemGrade> = {};
  for (const [key, cs] of clustersByPage) {
    const subject = gradeSubjectForPage(key);
    for (const c of cs) {
      const g = cache.byProblem[c.id];
      if (!g || !isCurrentGrading(g.sig, subject)) continue;
      const ext = gradingSigExt(subject, promptSigExt(gradeDirective(promptCfg, pdfIdByPage.get(key), c.meta?.no)));
      if (subject === '국어' && g.sig !== gradeSignature(c) + ext) continue;
      const { sig: _s, ...rest } = g;
      void _s;
      gradesById[c.id] = rest;
    }
  }

  // ── 정답지 기준 최종 판정 (022) — 리포트·분석 문맥의 정본 ──
  let sheetDoc: AnswerSheetDoc | null = null;
  const sheetEntry = [...sheetPageKeys.values()][0];
  if (sheetEntry && sheetEntry.strokes.length > 0) {
    const expected: number[] = [];
    for (const pg of pages) {
      for (const c of clustersByPage.get(pg.key) ?? []) {
        if (c.meta?.no != null) expected.push(c.meta.no);
      }
    }
    sheetDoc = await recognizeAnswerSheet({
      studentId: job.studentId,
      submissionId: job.submissionId,
      page: sheetEntry.page,
      strokes: sheetEntry.strokes,
      expectedNos: [...new Set(expected)].sort((a, b) => a - b),
    }).catch(() => null);
  }
  if (sheetDoc) {
    const next = pruneSheetGrades(cache, sheetDoc.answers);
    if (next !== cache) {
      cache = next;
      await saveGradeCache(job.studentId, job.submissionId, cache);
    }
  }
  const effectiveById: Record<string, ProblemGrade> = { ...gradesById };
  // 🚨 정답지 판정 대상은 **필기한 페이지의 문항이 아니라 교재 전체 문항**이다.
  // 본문에 아무것도 안 쓰고 정답지에만 답을 적은 문항이 바로 정답지로만
  // 판정되는 문항인데, 필기 페이지만 돌면 그게 통째로 빠진다 (사용자 신고
  // 2026-08-24, 화면 쪽도 같은 버그였다).
  // (안 쓴 쪽 문항은 1.5 에서 이미 본류에 병합됐다 — 별도 스윕 불필요)
  /** 문항 id → 그 문항이 실린 교재 제목 (없으면 문서 제목) */
  const paperTitleOfCluster = (clusterId: string): string => {
    const key = clusterId.split('#')[0];
    return paperTitleByPage.get(key) ?? job.title;
  };

  /** 정답지 판정을 돌릴 (문항, 페이지주소, pdfId) 전체 목록 */
  const judgeTargets: Array<{
    cluster: ProblemCluster;
    page: PageGroup['page'];
    pdfId: number | undefined;
  }> = [];
  for (const pg of pages) {
    for (const c of clustersByPage.get(pg.key) ?? []) {
      judgeTargets.push({ cluster: c, page: pg.page, pdfId: pdfIdByPage.get(pg.key) });
    }
  }
  if (sheetDoc) {
    for (const { cluster: c, page: judgePage, pdfId: judgePdfId } of judgeTargets) {
      if (c.meta?.no == null) continue;
      const sheetAns = sheetDoc.answers[String(c.meta.no)];
      if (!sheetAns) continue;
      let g = gradesById[c.id];
      if (needsKoreanSheetGrading(gradeSubjectForPage(c.id.split('#')[0]), c.meta.type)) {
        const key = c.id.split('#')[0];
        const directive = gradeDirective(promptCfg, judgePdfId, c.meta.no);
        const { grade, fromCache } = await gradeKoreanSheetProblem({
          page: judgePage, cluster: c, strokes: pages.find(pg => pg.key === key)?.strokes ?? [],
          cache, bodyGrade: g, sheetAnswer: sheetAns, directive,
          sigExt: gradingSigExt('국어', promptSigExt(directive)),
        });
        cache = putKoreanSheetGrade(cache, c, grade, sheetAns, gradingSigExt('국어', promptSigExt(directive)));
        effectiveById[c.id] = grade;
        if (!fromCache) gradedCalls++;
        if (grade.verdict === 'unknown') failed++;
        continue;
      }
      // 정답지에는 답이 있는데 본문 채점이 정답을 모르는 문항 — 학생이 본문에
      // 아무것도 안 써서 채점을 안 돌린 경우다. 인쇄 지문에서 정답을 구해
      // **정답지 기준으로 정오를 매긴다** (사용자 2026-08-24).
      if (judgePdfId != null && !g?.correctAnswer?.trim()) {
        const printed = await resolvePrintedAnswer({
          pdfId: judgePdfId,
          no: c.meta.no,
          page: judgePage,
          cluster: c,
        }).catch(() => '');
        if (printed) g = { ...(g ?? blankGrade(c)), correctAnswer: printed };
      }
      const sv = mergeSheetVerdict(g, sheetAns);
      if (sv.source !== 'sheet') continue;
      const base = effectiveById[c.id] ?? g ?? blankGrade(c);
      effectiveById[c.id] = {
        ...base,
        verdict: sv.verdict,
        studentAnswer: sv.sheetAnswer ?? base.studentAnswer,
      };
    }
  }
  if (sheetDoc) await saveGradeCache(job.studentId, job.submissionId, cache);
  // 단계 이어받기 — 두 쪽에 걸친 단계의 둘째 쪽 문항이 "5번" 으로 남아
  // 단계마다 번호가 겹치던 것을 화면과 **같은 규칙**으로 보정한다 (2026-08-25).
  {
    // 🚨 **교재별로** 끊어서 이어받는다. 섞으면 표지(계산력)가 앞 교재의
    // 마지막 단계를 물려받는다 — 표지 쪽번호가 문제지보다 뒤일 수 있다.
    const byPdf = new Map<number, PageGroup[]>();
    for (const pg of pages) {
      const pdfId = pdfIdByPage.get(pg.key);
      // 교재를 모르면 물려주지 않는다 — 잘못 붙이느니 그대로 둔다
      if (pdfId == null) continue;
      if (!byPdf.has(pdfId)) byPdf.set(pdfId, []);
      byPdf.get(pdfId)!.push(pg);
    }
    // 쪽에 인쇄된 묶음 제목("1단계"·"계산력")을 읽어 시드로 쓴다 —
    // 문항 인식이 group 을 못 읽은 쪽(둘째 쪽·표지)을 메운다 (2026-08-26).
    const headings: Record<string, string> = {};
    for (const pg of pages) {
      const pdfId = pdfIdByPage.get(pg.key);
      if (pdfId == null) continue;
      const e = await lookupNcodeEntry(
        pg.page.section,
        pg.page.owner,
        pg.page.noteId,
        pg.page.pageNumber,
      ).catch(() => null);
      headings[pg.key] = await readPageHeading({
        pdfId,
        pageIndex: e?.pageIndex ?? null,
        page: pg.page,
      }).catch(() => '');
    }
    for (const [, list] of byPdf) {
      const ordered = [...list]
        .sort((a, b) => a.page.pageNumber - b.page.pageNumber)
        .map((pg) => [pg.key, clustersByPage.get(pg.key) ?? []] as const)
        .filter(([, cs]) => cs.length > 0);
      for (const [key, cs] of carryStages(ordered, headings))
        clustersByPage.set(key, cs);
    }
  }

  const allClusters = [...clustersByPage.values()].flat();
  /**
   * 이 문서의 **과목** (027) — 문서가 걸친 교재 중 과목 지정이 있는 첫 값.
   * 화면(ReviewPage)과 같은 규칙이어야 분석 캐시가 갈리지 않는다.
   * 미지정은 수학 — 027 이전 교재는 전부 수학이었다.
   */
  const docSubject: PaperSubject = effectiveSubject(
    [...new Set(pdfIdByPage.values())]
      .map((pid) => meta.get(pid)?.subject)
      .find((v) => v != null) ?? null,
  );
  // 이미 분석을 마친 범위(서명 포함)는 목록에서 아예 뺀다 — 확인 왕복 0회
  // 세대가 다르면 **분석 캐시를 버린다** — 프롬프트가 바뀌었으니 다시 써야 한다
  const sameEpoch = prevStatus?.epoch === AI_EPOCH;
  const doneScopes = new Set(sameEpoch ? (prevStatus?.analyzedScopes ?? []) : []);
  const analyzedScopes = new Set(doneScopes);
  // 모범 풀이·답안 (교사 제공) — 있으면 문항 분석 프롬프트에 얹어 비교시킨다.
  // 서명에 포함되므로 해설이 새로 올라온 교재의 문항만 정확히 재분석된다.
  const solutionsByPdf = new Map<number, SolutionsDoc | null>();
  for (const pid of new Set(pdfIdByPage.values())) {
    solutionsByPdf.set(pid, await loadSolutionsDoc(pid).catch(() => null));
  }
  // 이 시점에 읽을 수 있던 해설 서명 — 요약에 남겨 게이트가 비교한다
  const solSig = await solutionsSignature().catch(() => 'none');
  // 세대(epoch)와 무관한 이전 분석 목록 — 같은 문항을 옛 서명으로 분석한
  // 적이 있는지(=서버 캐시가 낡았는지)를 판정하는 데 쓴다.
  const prevScopes = prevStatus?.analyzedScopes ?? [];
  const targets: Array<{
    pg: PageGroup;
    cluster: ProblemCluster;
    scopeKey: string;
    akey: string;
    aDir: string;
    /** 옛 서명으로 분석된 적이 있는 문항 — 서버 캐시를 버리고 다시 쓴다 */
    force: boolean;
  }> = [];
  let analyzed = 0;
  let solHit = 0; // 모범 풀이가 실제로 붙은 문항 수 — 상태 파일에 남긴다(진단)
  /** 분석 대상(풀이 획이 있는) 문항 id — 리포트에 비교를 심을 때 캐시를 읽는 목록 */
  const analyzableIds: string[] = [];
  /** 이 문서의 교재 중 하나라도 풀이+답안이 등록돼 있는가 */
  const solutionsAvailable = [...solutionsByPdf.values()].some(Boolean);
  for (const pg of pages) {
    for (const c of clustersByPage.get(pg.key) ?? []) {
      if (c.meta?.no == null) continue;
      // 풀이가 전혀 없는 문항은 분석 대상이 아니다 (화면과 같은 규칙)
      if (problemScopeStrokes(c, pg.strokes).length === 0) continue;
      // 과목이 서명·경로에 들어간다 — 과목을 바꾸면 다시 분석된다(수학은 그대로)
      const scopeKey = problemScopeKey(c.id, docSubject);
      analyzableIds.push(c.id);
      const pagePdfId = pdfIdByPage.get(pg.key);
      const sDir = solutionDirective(
        solutionFor(
          pagePdfId != null ? solutionsByPdf.get(pagePdfId) : null,
          c.meta.group,
          c.meta.no,
        ),
      );
      if (sDir) solHit++;
      // 과목 지시문 (026) — 수학은 빈 문자열이라 기존 교재의 서명(akey)이
      // 그대로다. 국어·영어에서만 붙으므로 재분석 비용이 생기지 않는다.
      const aDir = [
        subjectAnalysisDirective(docSubject),
        analysisDirective(promptCfg, pagePdfId, c.meta.no),
        sDir,
      ]
        .filter(Boolean)
        .join('\n\n');
      const sheetAnswer = sheetDoc?.answers[String(c.meta.no)];
      const analysisExt = gradingSigExt(gradeSubjectForPage(pg.key), promptSigExt(aDir));
      const akey = `${scopeKey}|${gradeSignature(c)}${sheetAnswer && needsKoreanSheetGrading(gradeSubjectForPage(pg.key), c.meta.type) ? sheetGradingSigExt(analysisExt, sheetAnswer) : analysisExt}`;
      if (doneScopes.has(akey)) {
        analyzed++; // 이미 완료 — 다시 부르지 않는다
        continue;
      }
      // 🚨 서버 분석 캐시는 scope 별 경로뿐이라 지시문·해설이 바뀐 걸 모른다.
      // 서명이 달라졌는데 force 없이 부르면 옛 캐시가 그대로 돌아오고, 그걸
      // 새 akey 로 "완료" 처리해 영영 안 고쳐진다. 이전에 분석된 적이 있는
      // 문항만 force 로 다시 쓴다 (처음 분석은 캐시가 없으니 force 불필요).
      const force = prevScopes.some((k) => k.startsWith(`${scopeKey}|`));
      targets.push({ pg, cluster: c, scopeKey, akey, aDir, force });
    }
  }
  for (let i = 0; i < targets.length; i++) {
    if (cancelled()) break;
    const { pg, cluster, scopeKey, akey, aDir, force } = targets[i];
    progress('문항 분석', i + 1, targets.length);
    // 문항 칩이 "이 문항 분석 중" 을 표시할 수 있게 발행 (진행 중만, 완료 표시 없음)
    setAnalyzingProblem(job.submissionId, cluster.id);
    try {
      // 범위 OCR 씨앗 — 채점이 이미 읽어낸 풀이·답을 재사용한다(추가 AI 0회).
      // 화면(자동화 3)과 같은 규칙·같은 저장 경로라 열람 때 재인식하지 않는다.
      const ocrPath = `${job.studentId}/${job.submissionId}.ocr.${scopeKey}.json`;
      let scopeOcr: string | undefined;
      const savedOcr = await downloadJsonObject<{ text?: string } | null>(
        ocrPath,
      ).catch(() => null);
      if (savedOcr && typeof savedOcr.text === 'string') {
        scopeOcr = savedOcr.text;
      } else {
        const g = gradesById[cluster.id];
        if (g && (g.work || g.studentAnswer)) {
          scopeOcr = [
            g.work ? `[풀이] ${g.work}` : '',
            g.studentAnswer ? `[학생 답] ${g.studentAnswer}` : '',
          ]
            .filter(Boolean)
            .join('\n');
          await uploadJsonObject(ocrPath, { text: scopeOcr }).catch(() => {});
        }
      }
      const base = buildProblemsContextText({
        strokes,
        clusters: allClusters,
        grades: effectiveById,
        selectedClusterId: cluster.id,
      });
      // 지시문(모범 풀이·학원 기준)을 **앞**에 — 서버 컷에 잘리지 않게 (2026-09-02)
      const context = [aDir, base].filter(Boolean).join('\n\n');
      const scopeStrokes = problemScopeStrokes(cluster, pg.strokes);
      await analyzeWriting(
        job.submissionId,
        force,
        { key: scopeKey, strokeIds: scopeStrokes.map((s) => s.id) },
        scopeOcr,
        context || undefined,
        docSubject,
      );
      analyzed++;
      analyzedScopes.add(akey);
    } catch {
      // 일시 실패 — 서버 캐시가 없으므로 화면에서 열면 자동 재시도된다
      failed++;
    }
  }
  setAnalyzingProblem(job.submissionId, null);

  // ── 4) 학습분석 리포트 — **누르지 않아도 미리** 만들어 둔다 (사용자 요구
  //      2026-08-19: "내가 누르지 않더라도 뒤에서 만들어놔야 돼"). 같은 획
  //      구성으로 이미 만든 리포트가 있으면 재생성하지 않는다.
  // 평가자료 세대만 바뀌었으면 기존 문서를 보존한다. 교사 편집본 재생성은 확인 후 진행한다.
  let reportStrokeCount = sameEpoch ? (prevStatus?.reportStrokeCount ?? 0) : 0;
  if (totalNumbered === 0) {
    // 표지 등 문항 없는 문서 — 리포트가 필요 없다. 완료로 표기해 재시도 방지.
    reportStrokeCount = strokes.length;
  } else if (
    !cancelled() &&
    (reportStrokeCount !== strokes.length || prevStatus?.reportV !== REPORT_V)
  ) {
    const existing = await loadLearnReport(job.studentId, job.submissionId).catch(
      () => null,
    );
    if (existing && preserveExistingReport(existing.assessment, prevStatus?.reportStrokeCount, strokes.length)) {
      // 기존 편집본은 평가자료 버전 변경만으로 덮지 않는다.
      reportStrokeCount = strokes.length;
    } else {
      progress('리포트 생성', 1, 1);
      try {
        // 리포트 분모 = 교재 전체 문항 수 — 1.5 병합으로 totalNumbered 가 곧 전체다
        const totalProblems = totalNumbered;
        const gradeByLabel: Record<string, 'correct' | 'wrong' | 'unknown'> = {};
        // 정답지로만 판정된 문항(본문 필기 0)도 리포트에 들어가야 한다 —
        // 정답지가 그 학생의 실제 정오다 (사용자 2026-08-24).
        const labelClusters = allClusters; // 1.5 병합으로 안 쓴 쪽 문항도 포함
        for (const c of labelClusters) {
          if (c.meta?.no == null) continue;
          const g = effectiveById[c.id];
          if (g && g.verdict !== 'blank') {
            gradeByLabel[g.label] = g.verdict as 'correct' | 'wrong' | 'unknown';
          }
        }
        const t0 = Math.min(...strokes.map((st) => st.startedAt));
        const timelines = buildProblemTimelines(strokes, allClusters, t0);
        // 모범 풀이 비교 — 방금 끝난 문항 분석 캐시에서 옮겨 심는다 (LLM 0회)
        const comparisonById = await loadProblemComparisons(
          job.studentId,
          job.submissionId,
          analyzableIds,
          docSubject,
        ).catch(() => ({}));
        // 과목별 블록(국어 5-Depth·수학 내신 행동)을 같은 캐시에서 옮겨 심는다 (LLM 0회).
        // 해당 과목에만 있는 블록이라 다른 과목에서는 빈 값이 온다.
        const insights =
          docSubject === '국어' || docSubject === '수학'
            ? await loadProblemInsights(
                job.studentId,
                job.submissionId,
                analyzableIds,
                docSubject,
              ).catch(() => ({ korean: {}, exam: {} }))
            : { korean: {}, exam: {} };
        const koreanById = docSubject === '국어' ? insights.korean : undefined;
        const examById = docSubject === '수학' ? insights.exam : undefined;
        await runLearnReport(job.studentId, {
          gradeByLabel,
          subject: docSubject,
          comparisonById,
          koreanById,
          examById,
          solutionsAvailable,
          submissionId: job.submissionId,
          studentName: job.studentName,
          submissionTitle: job.title,
          ocrText: '',
          timelines,
          problemsContext: [
            buildProblemsContextText({
              strokes,
              clusters: allClusters,
              grades: effectiveById,
              selectedClusterId: null,
            }),
            reportDirective(promptCfg, [...new Set(pdfIdByPage.values())]),
          ]
            .filter(Boolean)
            .join('\n\n'),
          totalProblems: totalProblems || undefined,
          studentId: job.studentId,
          // 정오의 정본 = 채점 결과(정답지 반영). AI 판정으로 덮이지 않게 한다.
          verdictById: Object.fromEntries(
            Object.entries(effectiveById).map(([id, g]) => [id, g.verdict]),
          ),
          // 문항 인식이 읽어낸 태그 — 리포트의 정오표·역량·취약 유형에 쓴다
          // 내신 리포트 — 배점은 문항 인식이 읽은 값, 페이지는 ncode 매핑에서
          pointsByLabel: Object.fromEntries(
            labelClusters
              .filter((c) => c.meta && c.meta.points > 0)
              .map((c) => [c.label, c.meta!.points]),
          ),
          pageByLabel: Object.fromEntries(
            labelClusters
              .map((c) => {
                const key = c.id.split('#')[0];
                const page = pageIndexByPage.get(key);
                return page != null ? ([c.label, page] as const) : null;
              })
              .filter((v): v is readonly [string, number] => v != null),
          ),
          tagsByLabel: Object.fromEntries(
            labelClusters
              .filter((c) => c.meta)
              .map((c) => [
                c.label,
                {
                  paperTitle: paperTitleOfCluster(c.id),
                  group: c.meta!.group,
                  unit: c.meta!.unit,
                  subUnit: c.meta!.subUnit,
                  concept: c.meta!.concept,
                  evalArea: c.meta!.evalArea,
                  behaviorArea: c.meta!.behaviorArea,
                },
              ]),
          ),
        });
        reportStrokeCount = strokes.length;
      } catch {
        // 일시 실패 — 다음 실행(catch-up)에서 자동 재시도
        failed++;
      }
    }
  }

  // ── 4.5) 리포트 재스탬프 ──
  // 단계 라벨 재스탬프 (사용자 신고 2026-09-02): 리포트가 단계 이어받기
  // 전 라벨로 생성되면 1단계가 4/4(첫 쪽만), 계산력이 통째로 빠진다.
  // 재생성은 LLM 비용이 크다 — 문서의 problemId = 클러스터 id 이므로,
  // **지금의 보정된 클러스터**에서 group·label 만 다시 박으면 표가 바로 선다.
  // 과목도 같은 자리에서 채운다 (027): 공유 링크는 교재 메타를 못 읽는다.
  let ltStamped = true;
  if (totalNumbered > 0 && reportStrokeCount === strokes.length && !cancelled()) {
    try {
      const loaded = await loadLearnReport(job.studentId, job.submissionId);
      // 옛 편집본은 과목·비교 결과를 다시 채우는 후처리에서도 보존한다.
      const doc = loaded?.assessment?.version === ASSESSMENT_VERSION
        && (!['국어', '영어'].includes(docSubject) || isCurrentAssessment(loaded.assessment, docSubject)) ? loaded : null;
      let dirty = false;
      if (doc && (doc.subject ?? '수학') !== docSubject) {
        if (docSubject === '수학') delete doc.subject;
        else doc.subject = docSubject;
        dirty = true;
      }
      if (doc) {
        const byId = new Map(
          allClusters.filter((c) => c.meta?.no != null).map((c) => [c.id, c]),
        );
        // ➕ 모범 풀이 비교·정본 핵심개념 재스탬프 (2026-09-02, GROUP_FIX_V=2):
        // 둘 다 문서 데이터만 고치면 되므로 재생성(LLM) 없이 심는다.
        const comparisons = await loadProblemComparisons(
          job.studentId,
          job.submissionId,
          analyzableIds,
          docSubject,
        ).catch(() => ({}) as Record<string, never>);
        if ((doc.solutionsAvailable ?? null) !== solutionsAvailable) {
          doc.solutionsAvailable = solutionsAvailable;
          dirty = true;
        }
        for (const pr of doc.problems) {
          const c = pr.problemId ? byId.get(pr.problemId) : undefined;
          if (!c) continue; // 옛 문서(problemId 없음)는 재생성만이 답이다
          const g = c.meta?.group?.trim() || undefined;
          if ((pr.group?.trim() || undefined) !== g || pr.label !== c.label) {
            if (g) pr.group = g;
            else delete pr.group;
            pr.label = c.label;
            dirty = true;
          }
          const cmp = comparisons[c.id] ?? null;
          if (JSON.stringify(pr.modelComparison ?? null) !== JSON.stringify(cmp)) {
            pr.modelComparison = cmp;
            dirty = true;
          }
          // 정리표(사람이 준 단원·세부내용)가 있으면 그것이 정본 — 세부내용은
          // 핵심 개념 열로 (learn-report generate 와 같은 규칙)
          const canon = lookupPaperUnitEntry(
            paperTitleOfCluster(c.id),
            c.meta?.group ?? '',
            c.meta?.no ?? 0,
          );
          if (canon) {
            const nextUnit = canon.unit;
            const nextSub = canon.sub ? '' : (pr.subUnit ?? '');
            const nextConcept = canon.sub ?? pr.concept ?? '';
            if (pr.unit !== nextUnit || pr.subUnit !== nextSub || pr.concept !== nextConcept) {
              pr.unit = nextUnit;
              pr.subUnit = nextSub;
              pr.concept = nextConcept;
              dirty = true;
            }
          }
        }
        if (dirty) {
          // 라벨이 바뀌었으니 겹침 목록도 다시 센다
          const cnt = new Map<string, number>();
          for (const pr of doc.problems) cnt.set(pr.label, (cnt.get(pr.label) ?? 0) + 1);
          const dups = [...cnt.entries()].filter(([, n]) => n > 1).map(([l]) => l);
          if (dups.length > 0) doc.duplicateLabels = dups;
          else delete doc.duplicateLabels;
          await saveLearnReport(job.studentId, job.submissionId, doc);
        }
      }
    } catch {
      // 일시 실패 — groupFix 를 남기지 않아야 다음 catch-up 이 다시 시도한다
      ltStamped = false;
    }
  }

  // 처리 요약을 남긴다 — 필기 기록 리스트의 "AI 분석 완료" 배지 근거.
  // strokeCount 를 함께 저장해, 이후 새 필기가 병합되면(획 수가 달라지면)
  // "새 필기 분석 대기" 로 구분해 보여줄 수 있다.
  let gradedCount = 0;
  let unsolvedCount = 0;
  for (const pg of pages) {
    for (const c of clustersByPage.get(pg.key) ?? []) {
      if (c.meta?.no == null) continue;
      // 풀이 획이 없는 문항 = 아직 안 푼 문항 (문항 분석에서 빼는 기준과 동일)
      if (problemScopeStrokes(c, pg.strokes).length === 0) unsolvedCount++;
      const hit = cache.byProblem[c.id];
      const ext = promptSigExt(
        gradeDirective(promptCfg, pdfIdByPage.get(pg.key), c.meta.no),
      );
      if (hit && hit.sig === gradeSignature(c) + gradingSigExt(gradeSubjectForPage(pg.key), ext)) gradedCount++;
    }
  }
  // ── 본인 확인 — 표지에 적힌 이름이 이 기록의 학생과 같은가 ──
  // (사용자 요구 2026-08-24). 인식 결과는 획 서명 캐시라 다시 열어도 재호출 없다.
  let idNameMatch: boolean | null | undefined;
  let idName: string | undefined;
  if (infoPageGroup) {
    const id = await recognizeIdInfo({
      studentId: job.studentId,
      submissionId: job.submissionId,
      page: infoPageGroup.page,
      strokes: infoPageGroup.strokes,
    }).catch(() => null);
    if (id) {
      idName = id.name;
      idNameMatch = compareIdInfo(id, { name: job.studentName }).nameMatch;
    }
  }

  const statusDoc: AiStatusDoc = {
    v: 1,
    epoch: AI_EPOCH,
    gradingVersion: KOREAN_GRADING_VERSION,
    englishAnalysisVersion: ENGLISH_ANALYSIS_VERSION,
    gradingSubjects: Object.fromEntries([...new Set(pdfIdByPage.values())].map(pid =>
      [String(pid), meta.has(pid) ? effectiveSubject(meta.get(pid)?.subject) : null])),
    strokeCount: strokes.length,
    totalNumbered,
    graded: gradedCount,
    unsolved: unsolvedCount,
    idNameMatch,
    idName,
    analyzed,
    failed,
    updatedAt: new Date().toISOString(),
    analyzedScopes: [...analyzedScopes],
    reportStrokeCount,
    reportV: REPORT_V,
    solHit,
    solSig,
    // 재스탬프가 실패했으면 서명을 비워 둔다 — 다음 catch-up 이 이 문서를 다시 태운다
    ...(ltStamped ? { groupFix: GROUP_FIX_V } : {}),
  };
  await uploadJsonObject(
    aiStatusPath(job.studentId, job.submissionId),
    statusDoc,
  ).catch(() => {});

  return {
    ...base,
    ok: !cancelled(),
    gradedCalls,
    totalNumbered,
    failed,
    error: cancelled() ? '취소됨' : undefined,
  };
}

/** 동시에 처리할 학생 수 상한 — 문서 안은 순차라 동시 LLM 호출 = 이 값.
 *  너무 크면 비전 API 가 요율 제한으로 실패를 뱉어 "일부 실패" 만 늘어난다. */
const STUDENT_CONCURRENCY = 8;

/** 단계 라벨 재스탬프 세대 — 로직을 또 고치면 +1 해서 전 문서를 한 번 더 태운다 */
const GROUP_FIX_V = 3; // 3 = 모범 풀이 블록 컷 사고 복구 — 해설 문항 재분석 유도 (2026-09-02 밤)
/** 리포트 **구성** 세대 — 문항 구성 규칙이 바뀌면 올린다. 2 = 안 쓴 쪽 문항
 *  포함(2026-09-02). 값이 다르면 catch-up 이 리포트를 다시 만든다(LLM 1회). */
const REPORT_V = 2;

// ── 따라잡기(catch-up): 앱 시작 시 미처리 문서를 찾아 이어서 처리 ──
//
// 파이프라인은 앱 메모리에서 돈다 — 앱을 껐다 켜면(업데이트 재시작 포함)
// 돌던 큐가 사라져 일부 학생만 처리된 채 남는다 (실사고 2026-08-19: 배포
// 재시작으로 7명 미처리). 시작할 때 ai-status 를 훑어 미완 문서만 다시
// 태운다 — 완료 문서는 상태 파일 확인만 하고 아무것도 부르지 않는다.

let catchUpStarted = false;

export async function wireAutoGradeCatchUp(deps: {
  listStudents: () => Promise<Array<{ id: string; name: string }>>;
  listSubmissions: (
    studentId: string,
  ) => Promise<Array<{ id: string; title: string; strokeCount: number }>>;
  /** 이미 한 번 돌았어도 **다시** 훑는다 — 기록을 합친 직후처럼 문서 구성이
   *  바뀐 경우, 앱을 껐다 켜지 않아도 바로 채점·분석이 붙어야 한다. */
  force?: boolean;
}): Promise<void> {
  if (catchUpStarted && !deps.force) return;
  catchUpStarted = true;
  try {
    const students = await deps.listStudents();
    // 해설(모범 풀이) 서명 — 요약의 서명과 다르면(해설이 새로 올라왔거나
    // 처음 읽히게 된 경우) 그 문서를 한 번 더 태운다. 안에서는 문항별 akey 가
    // 갈라 주므로 실제 LLM 재호출은 해설이 걸린 문항뿐이다.
    const solSig = await solutionsSignature().catch(() => 'none');
    const paperMeta = await listMyPaperMeta();
    const jobs: AutoGradeJob[] = [];
    for (const st of students) {
      const subs = await deps.listSubmissions(st.id).catch(() => []);
      for (const sub of subs) {
        if (sub.strokeCount === 0) continue;
        const status = await loadAiStatus(st.id, sub.id);
        // 매번 현재 메타와 비교한다. 정책 버전이 같아도 교재 과목은 바뀔 수 있다.
        let subjects: GradingSubjects = {};
        if (status?.gradingSubjects && Object.keys(status.gradingSubjects).length > 0) {
          subjects = Object.fromEntries(Object.keys(status.gradingSubjects).map(pid =>
            [pid, paperMeta.has(Number(pid)) ? effectiveSubject(paperMeta.get(Number(pid))?.subject) : null]));
        } else if (status) {
          // 옛 요약은 실제 필기 페이지로 교재를 찾는다. 처리 당시 과목은 추정하지 않는다.
          try {
            const written = await downloadStrokes(strokesPath(st.id, sub.id));
            for (const pg of groupPages(written)) {
              const entry = await lookupNcodeEntry(pg.page.section, pg.page.owner, pg.page.noteId, pg.page.pageNumber);
              if (!entry) { subjects[pg.key] = null; continue; }
              subjects[String(entry.pdfId)] = paperMeta.has(entry.pdfId) ? effectiveSubject(paperMeta.get(entry.pdfId)?.subject) : null;
            }
          } catch { subjects = {}; }
        }
        const currentGrading = currentGradingSubjects(status?.gradingSubjects, subjects)
          && (!Object.values(subjects).includes('국어') || status?.gradingVersion === KOREAN_GRADING_VERSION)
          && (!Object.values(subjects).includes('영어') || status?.englishAnalysisVersion === ENGLISH_ANALYSIS_VERSION);
        if (
          status &&
          status.strokeCount === sub.strokeCount &&
          status.failed === 0 &&
          // 미풀이 집계·본인 확인이 들어오기 전(2026-08-24)에 만들어진 요약은
          // 숫자가 비어 있다 — 한 번은 다시 돌려 채운다. 채점·분석·리포트는
          // 각자 캐시가 있어 다시 부르지 않으므로 사실상 집계만 다시 한다.
          status.unsolved != null &&
          // 규칙 세대가 다르면 다시 만든다 — 옛 프롬프트·옛 라벨로 만든 결과다
          status.epoch === AI_EPOCH &&
          status.reportStrokeCount === sub.strokeCount &&
          // 단계 라벨 재스탬프 세대 — 다르면 group/label 을 다시 박아야 한다
          status.groupFix === GROUP_FIX_V &&
          // 해설 서명이 그때와 같아야 완료 — 다르면 해설 문항 재분석이 필요하다
          status.solSig === solSig &&
          // 리포트 구성 세대 — 다르면(안 쓴 쪽 문항 미포함 등) 리포트를 다시 만든다
          status.reportV === REPORT_V &&
          currentGrading
        )
          continue; // 채점·분석·리포트까지 완료 — 아무것도 하지 않는다
        jobs.push({
          studentId: st.id,
          submissionId: sub.id,
          studentName: st.name,
          title: sub.title || '문제지',
        });
      }
    }
    if (jobs.length > 0) void runAutoGradeQueue(jobs);
  } catch {
    // 목록 조회 실패 — 다음 앱 시작 때 다시 시도된다
    catchUpStarted = false;
  }
}

/**
 * 수신이 끝난 문서들을 **학생별 병렬**로 자동 처리한다 (사용자 요구 2026-08-19:
 * "전부 한꺼번에 돌면 되잖아"). 같은 학생의 문서는 한 워커가 순차로 맡아
 * 학생당 진행 표시가 겹치지 않고, 서로 다른 학생은 동시에 돈다.
 * 실패한 문서는 건너뛰고 계속한다 (한 문서 오류가 나머지를 막으면 안 된다).
 */
export async function runAutoGradeQueue(
  jobs: AutoGradeJob[],
  opts: {
    isCancelled?: () => boolean;
    onProgress?: (p: AutoGradeProgress) => void;
  } = {},
): Promise<AutoGradeDocResult[]> {
  // 같은 문서가 두 번 들어오면(표지+문제 병합 등) 한 번만
  const seen = new Set<string>();
  const unique = jobs.filter((j) =>
    seen.has(j.submissionId) ? false : (seen.add(j.submissionId), true),
  );
  // 학생별 큐 — 한 학생의 문서들은 같은 워커가 순서대로
  const byStudent = new Map<string, AutoGradeJob[]>();
  for (const j of unique) {
    const q = byStudent.get(j.studentId);
    if (q) q.push(j);
    else byStudent.set(j.studentId, [j]);
  }
  const queues = [...byStudent.values()];
  const out: AutoGradeDocResult[] = [];
  let nextQueue = 0;
  let started = 0;
  const worker = async () => {
    for (;;) {
      if (opts.isCancelled?.()) return;
      if (nextQueue >= queues.length) return;
      const mine = queues[nextQueue++];
      for (const job of mine) {
        if (opts.isCancelled?.()) return;
        started++;
        beginAutoGrade(job.submissionId);
        try {
          const res = await autoGradeOne(job, started, unique.length, opts);
          out.push(res);
          markStudentAiDocDone(job.studentId, !res.ok || res.failed > 0);
        } catch (e) {
          out.push({
            job,
            ok: false,
            gradedCalls: 0,
            totalNumbered: 0,
            failed: 0,
            error: e instanceof Error ? e.message : String(e),
          });
          markStudentAiDocDone(job.studentId, true);
        } finally {
          setStudentAiActivity(job.studentId, null);
          setAnalyzingProblem(job.submissionId, null);
          endAutoGrade(job.submissionId);
        }
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(STUDENT_CONCURRENCY, queues.length) },
      () => worker(),
    ),
  );
  return out;
}
