import { gradingSigExt, isCurrentGrading, boundedGradingScope, needsKoreanSheetGrading, sheetGradingSigExt, sameGradedSheetAnswer, answerSheetRequestSig, pruneSheetGrades } from '@/lib/korean-grading';
import { isCurrentAssessment, fullAnalysisKey, isFullAnalysisKey } from '@/lib/assessment';
/**
 * 제출 리뷰 — (a) 필기 타임라인 재생 (b) OCR 인식/교정 (c) 피드백 작성·공개.
 * 재생은 PDF(교재)별 그룹 → [전체/페이지] 로 선택해 본다.
 * AI 과정 분석은 결과를 직접 수정·복원할 수 있고, 피드백은 AI 초안 생성을 지원한다.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Skeleton } from '@seed-design/react';
import {
  ArrowLeft,
  BoxSelect,
  RotateCcw,
  ScanText,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { ActionButton } from 'seed-design/ui/action-button';
import { Callout } from 'seed-design/ui/callout';
import { ChipLabel, RadioChipItem, RadioChipRoot } from 'seed-design/ui/chip';
import { Switch } from 'seed-design/ui/switch';
import {
  listMyStudents,
  analyzeWriting,
  generateFeedbackDraft,
  getFeedback,
  getSubmission,
  recognizeImage,
  notifyFeedbackPublished,
  updateSubmission,
  upsertFeedback,
  type AnalysisIssue,
  type AnalysisReport,
  type SubmissionRow,
} from '@/lib/api';
import {
  detectProblemsForPage,
  loadProblemsCache,
  problemScopeStrokes,
  reassignClusters,
  renderProblemRegionImage,
  saveProblems,
  type ProblemCluster,
} from '@/lib/problem-detect';
import { buildProblemsContextText } from '@/lib/problems-context';
import { AI_EPOCH } from '@/lib/ai-epoch';
import { normalizeUnitName } from '@/lib/curriculum';
import { finalVerdict } from '@/lib/difficulty';
import { isCoverPaper } from '@/lib/exam-set';
import { carryStages, pageNoOfKey } from '@/lib/stage-carry';
import {
  solutionDirective,
  solutionFor,
  type SolutionEntry,
  type SolutionsDoc,
} from '@/lib/solutions';
import { loadSolutionsDoc, solutionImageUrl } from '@/lib/solutions-io';
import {
  loadProblemComparisons,
  loadProblemInsights,
  problemScopeKey,
  subjectSigExt,
} from '@/lib/analysis-cache';
import { SolutionImage } from '../components/SolutionImage';
import { lookupPaperUnitEntry } from '@/lib/paper-unit-map';
import {
  effectiveSubject,
  subjectAnalysisDirective,
  type PaperSubject,
} from '@/lib/paper-subject';
import { resolvePrintedAnswer } from '@/lib/printed-answer';
import {
  classifyPrintedPage,
  compareIdInfo,
  crossCheckIdInfo,
  mergeSheetVerdict,
  recognizeAnswerSheet,
  readPageHeading,
  recognizeIdInfo,
  type AnswerSheetDoc,
  type IdCheckDoc,
  type PageKindDoc,
  type SheetVerdict,
} from '@/lib/special-pages';
import {
  analysisDirective,
  gradeDirective,
  loadPaperPromptConfig,
  promptFor,
  promptSigExt,
  reportDirective,
  EMPTY_PROMPT_CONFIG,
  type PaperPromptConfig,
} from '@/lib/paper-prompts';
import { useSessionStore } from '@/store/session.store';
import {
  downloadJsonObject,
  downloadStrokes,
  uploadJsonObject,
} from '@/lib/strokes-io';
import { buildPageKey } from '@/lib/pen-event-bus';
import { buildProblemTimelines } from '@/lib/problem-timeline';
import {
  listPdfPagesFromIndex,
  lookupNcodeEntry,
  usePaperStore,
  type PaperOverride,
  type PdfIndexPage,
} from '@/store/paper.store';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  listMyPaperMeta,
  type PaperMeta,
  type PaperKind,
} from '@/lib/paper-owners';
import { clampRectToPaper, sanitizeStrokes } from '@/lib/stroke-sanitize';
import {
  computeScore,
  blankGrade,
  gradeProblem,
  gradeKoreanSheetProblem,
  putKoreanSheetGrade,
  gradeSignature,
  loadGradeCache,
  putGrade,
  saveGradeCache,
  type GradeCache,
  type ProblemGrade,
} from '@/lib/problem-grade';
import { LatexText } from '@/components/LatexText';
import { MathTextArea } from '../components/MathTextArea';
import { loadLearnReport, runLearnReport } from '@/lib/learn-report';
import { loadAiStatus, runAutoGradeQueue } from '@/lib/auto-grade';
import {
  getAnalyzingProblem,
  isAutoGrading,
  isReceiving,
  receiveStateVersion,
  subscribeReceiveState,
} from '@/lib/receive-state';
import { strokeBounds, type Stroke } from '@/pen/live/model/stroke';
import { renderStrokeGroupToPng } from '@/pen/live/model/stroke-image';
import { usePlayback } from '@/pen/offline/hooks/usePlayback';
import { PlaybackView } from '../components/PlaybackView';
import { AnalysisPanel } from '../components/AnalysisPanel';
import { PaperPromptDialog } from '../components/PaperPromptDialog';
import { Editable } from '../components/Editable';
import { SubmissionStatusBadge } from '../components/SubmissionBits';
import { useToast } from '../components/toast';
import { formatDateTime } from '../format';

type PageEntry = {
  key: string;
  label: string;
  strokes: Stroke[];
  section: number;
  owner: number;
  noteId: number;
  pageNumber: number;
};

type PdfGroup = { id: string; pages: PageEntry[] };

function noteGroupId(p: PageEntry): string {
  return `${p.section}_${p.owner}_${p.noteId}`;
}

function groupByPage(strokes: Stroke[]): PageEntry[] {
  const map = new Map<string, Stroke[]>();
  for (const s of strokes) {
    const key = buildPageKey(s.section, s.owner, s.noteId, s.pageNumber);
    const list = map.get(key);
    if (list) list.push(s);
    else map.set(key, [s]);
  }
  const entries = [...map.entries()].map(([key, list]) => ({
    key,
    strokes: list,
    first: list[0],
  }));
  // 페이지 번호 오름차순 — PDF 안에서의 순서대로 (필기 시작 시간순 아님)
  entries.sort(
    (a, b) =>
      a.first.noteId - b.first.noteId || a.first.pageNumber - b.first.pageNumber,
  );
  return entries.map((e, i) => ({
    key: e.key,
    strokes: e.strokes,
    // 교재 인덱스가 뜨면 실제 PDF 페이지(p.4 등)로 대체된다. 그 전까지는
    // **필기한 순서**로 표시 — ncode 페이지 번호(236 등)를 그대로 쓰면
    // "없는 페이지"처럼 보인다 (2026-08-13 사용자 신고).
    label: `p.${i + 1}`,
    section: e.first.section,
    owner: e.first.owner,
    noteId: e.first.noteId,
    pageNumber: e.first.pageNumber,
  }));
}

/** 피드백 '학생에게 공개' 노출 여부 — 안 쓰기로 해서 꺼 둔다(2026-08-17).
 *  기능 자체는 남아 있으므로 true 로 바꾸면 그대로 돌아온다. */
const SHOW_STUDENT_VISIBILITY = false;

/**
 * 뒤로가기 즉시 복원용 스냅샷 (모듈 레벨 — 라우트를 오가도 살아 있다).
 *
 * 리포트에서 뒤로 오면 컴포넌트가 새로 마운트돼 6번의 네트워크 로드를 처음부터
 * 다시 했다(사용자 지적 2026-08-19: "변경된 게 없는데 왜 다시 불러오냐").
 * 같은 세션에서 본 문서는 스냅샷으로 **즉시** 그리고, 갱신은 스피너 없이
 * 백그라운드로 이어서 한다 — 새 수거분이 있으면 곧 반영된다.
 */
type ReviewSnapshot = {
  sub: SubmissionRow;
  pages: PageEntry[];
  problems: Record<string, ProblemCluster[]>;
  /**
   * AI 파생 상태도 함께 보존한다 (사용자 요구 2026-08-19: "이미 분석이 끝난 건
   * 다시 분석하지 말고 보존해서 보여줘"). 없으면 각 로더가 storage 캐시에서
   * 복원하지만, 세션 안 재방문은 네트워크 없이 **즉시** 그려져야 한다.
   */
  grades?: Record<string, ProblemGrade>;
  analysisByScope?: Record<string, AnalysisReport>;
  editedByScope?: Record<string, boolean>;
  ocrByScope?: Record<string, string>;
  ocrText?: string;
  ocrEdited?: string;
  body?: string;
  pdfPageProblemCount?: Record<string, number>;
  groupTitles?: Record<string, string>;
  pageLabels?: Record<string, string>;
  groupPdfIds?: Record<string, number>;
  groupAllPages?: Record<string, PdfIndexPage[]>;
};

const reviewSnapshots = new Map<string, ReviewSnapshot>();

/** 스냅샷 상한 — 세션에서 많이 열어도 메모리가 무한히 늘지 않게 */
function trimSnapshots() {
  while (reviewSnapshots.size > 8) {
    const oldest = reviewSnapshots.keys().next().value;
    if (oldest === undefined) return;
    reviewSnapshots.delete(oldest);
  }
}

export function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [submission, setSubmission] = useState<SubmissionRow | null>(null);
  const [pages, setPages] = useState<PageEntry[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [strokesError, setStrokesError] = useState<string | null>(null);

  // ── 크래들 수신·자동 채점 진행 구독 (2026-08-19) ──
  // 수신 중에는 필기 기록이 아직 **불완전**할 수 있다 — 그 위에서 채점·분석이
  // 돌면 안 된다. 진행 중이면 자동 AI 작업을 보류하고 배너로 알린 뒤, 끝나면
  // 자동으로 새 데이터를 반영한다.
  useSyncExternalStore(subscribeReceiveState, receiveStateVersion);
  const receivingNow = isReceiving();
  const autoGradingThis = id ? isAutoGrading(id) : false;

  /**
   * 이 문서의 AI 처리 요약 — **완료·최신이면 채점 루프를 아예 돌리지 않는다.**
   * 실사고(2026-08-19): 리스트엔 "AI 완료" 인데 상세를 열면 "채점 진행 중"
   * 배너가 떴다. 완료 문서는 캐시가 정답이므로, 서명 재계산이 어떤 이유로든
   * 어긋나도 재채점하지 않는 것이 맞다. 새 필기(획 수 변화)면 false 가 된다.
   */
  const [aiDone, setAiDone] = useState(false);
  useEffect(() => {
    if (!submission || !id || pages.length === 0) return;
    if (autoGradingThis) {
      setAiDone(false);
      return;
    }
    let alive = true;
    void loadAiStatus(submission.studentId, id).then((st) => {
      if (!alive) return;
      const strokeCount = pages.reduce((a, p) => a + p.strokes.length, 0);
      // 규칙 세대가 다르면 완료로 치지 않는다 — 옛 캐시를 그대로 보여주지 않는다
      setAiDone(
        !!st &&
          st.strokeCount === strokeCount &&
          st.failed === 0 &&
          st.epoch === AI_EPOCH,
      );
    });
    return () => {
      alive = false;
    };
  }, [submission, id, pages, autoGradingThis]);

  // 피드백/OCR 상태 (진입 시 getFeedback 으로 복원)
  const [body, setBody] = useState('');
  const [ocrText, setOcrText] = useState('');
  const [ocrEdited, setOcrEdited] = useState('');
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [visibleUpdating, setVisibleUpdating] = useState(false);
  const [draftLoading, setDraftLoading] = useState(false);

  // ---------- 문항(문제) 단위 ----------
  const [problems, setProblems] = useState<Record<string, ProblemCluster[]>>({});

  // 문항 캐시 복원 후 현재 획으로 **재배정** — 디텍션 캐시는 그 시점의 배정만
  // 담고 있어, 이후 재수신으로 늘어난 획(낙서 포함)이 "풀이 없음"으로 남는
  // 실사고 방지 (2026-08-13 중1-1 1·2·4·5번).
  //
  // 🚨 가드의 역사: "1회만" 가드는 스냅샷 복원과 충돌했고(2026-08-19 회귀),
  // 그다음의 "페이지 획수 서명" 가드는 **백그라운드 새로고침이 problems 를
  // 원시 캐시로 되돌린 뒤** 서명이 그대로라 배정이 빠진 채 남는 구멍이 있었다
  // (배정이 빠지면 채점 서명이 흔들려 이미 채점한 문항을 또 채점한다 —
  // 2026-08-19 사용자: "끝난 건 다시 분석하지 마"). 그래서 가드를 없애고
  // **결과 불변 비교**로 무한 루프를 막는다: 배정은 결정적·멱등이라 두 번째
  // 계산부터는 결과가 같고, 같으면 상태를 건드리지 않아 이펙트가 멈춘다.
  useEffect(() => {
    if (pages.length === 0) return;
    if (Object.keys(problems).length === 0) return;
    setProblems((m) => {
      let changed = false;
      const next = { ...m };
      for (const pg of pages) {
        const cs = next[pg.key];
        if (cs && cs.length > 0) {
          // 공용 헬퍼 — 자동 채점 파이프라인·채점 서명 계산과 **같은 배정**.
          // 여기가 갈라지면 서명이 어긋나 이미 채점한 문항을 또 채점한다.
          const assigned = reassignClusters(cs, pg.strokes);
          const same =
            assigned.length === cs.length &&
            assigned.every(
              (c, i) => c.strokeIds.join(',') === cs[i].strokeIds.join(','),
            );
          if (!same) {
            next[pg.key] = assigned;
            changed = true;
          }
        }
      }
      // 같으면 기존 참조를 그대로 돌려줘 리렌더·재실행이 멈춘다
      return changed ? next : m;
    });
  }, [pages, problems]);
  const [detecting, setDetecting] = useState(false);
  /** 진입 시 전 페이지 자동 인식 — 1회 */
  const autoDetectRef = useRef(false);
  const [autoDetectRunning, setAutoDetectRunning] = useState(false);
  /** 문항 영역 수동 편집 모드 */
  const [regionEditing, setRegionEditing] = useState(false);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);

  // ---------- 범위별 OCR (문항 = 지문+풀이 자동 인식) ----------
  const [ocrByScope, setOcrByScope] = useState<Record<string, string>>({});
  const [scopeOcrRunning, setScopeOcrRunning] = useState(false);
  const scopeOcrAutoRef = useRef(new Set<string>());
  const fullOcrAutoRef = useRef(false);
  /** 범위별 자동 분석 1회 가드 (실패 시 무한 재시도 방지) */
  const analysisAutoRef = useRef(new Set<string>());

  // ---------- AI 과정 분석 (범위별 캐시 + 인라인 편집·복원) ----------
  const [analysisByScope, setAnalysisByScope] = useState<
    Record<string, AnalysisReport>
  >({});
  /** 범위별 "수정됨" 여부 — 수정본은 storage 에 범위별 파일로 영속 */
  const [editedByScope, setEditedByScope] = useState<Record<string, boolean>>({});
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  /** 범위별 분석 수정본 저장 경로 (full 은 기존 경로 유지 — 서버 초안도 참조) */
  const editPathFor = useCallback(
    (scopeKey: string) =>
      submission
        ? isFullAnalysisKey(scopeKey)
          ? `${submission.studentId}/${submission.id}.analysis-edit.json`
          : `${submission.studentId}/${submission.id}.analysis-edit.${scopeKey}.json`
        : null,
    [submission],
  );

  const backToNotes = useCallback(() => {
    if (submission?.studentId) {
      navigate(`/t/students/${submission.studentId}/notes`);
    } else {
      navigate('/t/students');
    }
  }, [navigate, submission?.studentId]);

  const load = useCallback(async () => {
    if (!id) return;
    const snap = reviewSnapshots.get(id);
    if (snap) {
      // 즉시 복원 — 스피너 없이. 아래 네트워크 로드는 계속 돌아 조용히 갱신한다.
      setSubmission(snap.sub);
      setProblems(snap.problems);
      setPages(snap.pages);
      setSelectedKey((prev) =>
        prev ?? (snap.pages[0] ? `all:${noteGroupId(snap.pages[0])}` : null),
      );
      // AI 파생 상태 복원 — 있으면 채점·분석·OCR 이 즉시 그려지고, 자동 실행
      // 이펙트들은 "이미 있음" 으로 판단해 **다시 돌지 않는다** (재분석 방지).
      if (snap.grades) setGrades(snap.grades);
      if (snap.analysisByScope) setAnalysisByScope(snap.analysisByScope);
      if (snap.editedByScope) setEditedByScope(snap.editedByScope);
      if (snap.ocrByScope) setOcrByScope(snap.ocrByScope);
      if (snap.ocrText) setOcrText(snap.ocrText);
      if (snap.ocrEdited) setOcrEdited(snap.ocrEdited);
      if (snap.body) setBody(snap.body);
      if (snap.pdfPageProblemCount)
        setPdfPageProblemCount(snap.pdfPageProblemCount);
      if (snap.groupTitles) setGroupTitles(snap.groupTitles);
      if (snap.pageLabels) setPageLabels(snap.pageLabels);
      if (snap.groupPdfIds) setGroupPdfIds(snap.groupPdfIds);
      if (snap.groupAllPages) setGroupAllPages(snap.groupAllPages);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);
    setStrokesError(null);
    try {
      const sub = await getSubmission(id);
      if (!sub) {
        setError('제출을 찾을 수 없습니다. 삭제되었거나 잘못된 주소일 수 있어요.');
        return;
      }
      setSubmission(sub);

      // 배경 교재 수동 교정 복원 — 페이지가 렌더되기 전에 스토어에 넣어야
      // 첫 화면부터 교정된 배경으로 보인다 (NGS 범위 재사용 사고 복구).
      // 학생 전역(_global) 교정을 먼저 깔고 문서별 교정을 덮는다 — 같은
      // ncode 페이지를 다시 쓰는 새 문서(실사고: 8/12 김경수)에 자동 적용.
      try {
        const [globalFix, subFix] = await Promise.all([
          downloadJsonObject<{
            v: 1;
            map: Record<string, PaperOverride>;
          } | null>(`${sub.studentId}/_global.paperfix.json`).catch(() => null),
          downloadJsonObject<{
            v: 1;
            map: Record<string, PaperOverride>;
          } | null>(`${sub.studentId}/${sub.id}.paperfix.json`).catch(() => null),
        ]);
        const map = {
          ...(globalFix?.v === 1 ? globalFix.map : {}),
          ...(subFix?.v === 1 ? subFix.map : {}),
        };
        if (Object.keys(map).length > 0) {
          usePaperStore.getState().setPaperOverrides(map);
        }
      } catch {
        /* 교정 없음 — 무시 */
      }

      // 피드백 복원 — 실패해도 재생은 가능해야 하므로 개별 try/catch
      try {
        const fb = await getFeedback(id);
        if (fb) {
          setBody(fb.body ?? '');
          setOcrText(fb.ocrText ?? '');
          // 교정본이 비어 있으면 인식 원문을 바로 보여주고 그 자리에서 수정하게 한다
          setOcrEdited(fb.ocrEdited || fb.ocrText || '');
        }
      } catch {
        /* 피드백 테이블 미준비 등 — 새로 작성 가능하므로 무시 */
      }

      // 저장된 분석 수정본 복원 (없으면 분석 버튼으로 생성)
      try {
        const edited = await downloadJsonObject<AnalysisReport | null>(
          `${sub.studentId}/${sub.id}.analysis-edit.json`,
        );
        if (edited?.assessment && isCurrentAssessment(edited.assessment, edited.assessment.subject) && edited.headline) {
          const restoredKey = fullAnalysisKey(edited.assessment.subject);
          setAnalysisByScope((m) => ({ ...m, [restoredKey]: edited }));
          setEditedByScope((m) => ({ ...m, [restoredKey]: true }));
        }
      } catch {
        /* 수정본 없음 */
      }

      // 문항 인식 캐시 복원
      let cacheByPage: Record<string, ProblemCluster[]> = {};
      try {
        const cache = await loadProblemsCache(sub.studentId, sub.id);
        if (cache) {
          cacheByPage = cache.byPage;
          setProblems(cache.byPage);
        }
      } catch {
        /* 캐시 없음 */
      }

      // 필기 데이터
      try {
        const strokes = await downloadStrokes(sub.strokesPath);
        const grouped = groupByPage(strokes);
        setPages(grouped);
        // 뒤로가기 복원 중이면 보던 페이지·문항 선택을 유지한다
        setSelectedKey((prev) =>
          snap && prev ? prev : grouped[0] ? `all:${noteGroupId(grouped[0])}` : null,
        );
        // 기존 스냅샷의 AI 파생 상태(채점·분석 등)를 잃지 않게 **병합**한다
        reviewSnapshots.set(id, {
          ...reviewSnapshots.get(id),
          sub,
          pages: grouped,
          problems: cacheByPage,
        });
        trimSnapshots();
      } catch (err) {
        setStrokesError(
          err instanceof Error ? err.message : '필기 데이터를 불러오지 못했습니다.',
        );
      }
    } catch (err) {
      // 스냅샷으로 이미 그려져 있으면 배경 갱신 실패로 화면을 지우지 않는다
      if (!snap) {
        setError(
          err instanceof Error ? err.message : '제출 정보를 불러오지 못했습니다.',
        );
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // 수신이 **끝나는 순간** 조용히 다시 불러온다 — 새로 수거된 획이 있으면
  // 스냅샷 위에 자동 반영된다 (새 데이터가 온 경우에만 이후 채점이 증분으로 돈다)
  const prevReceivingRef = useRef(false);
  useEffect(() => {
    if (prevReceivingRef.current && !receivingNow) void load();
    prevReceivingRef.current = receivingNow;
  }, [receivingNow, load]);

  // ── 열기만 해도 남은 채점·문항분석이 이어진다 (사용자 요구 2026-08-19:
  // "버튼을 클릭하지 않아도 분석 중인 건 분석 중이라고 표시"). 처리 요약
  // (ai-status)이 이미 완료·최신이면 **아무것도 다시 부르지 않는다**. 미완이면
  // 이 문서만 파이프라인에 태운다 — 문항 칩에 채점·"분석" 스피너가 문항을
  // 옮겨가며 실시간으로 표시된다.
  const autoPipelineTriedRef = useRef(false);
  useEffect(() => {
    if (!submission || !id || pages.length === 0) return;
    if (receivingNow || autoGradingThis) return;
    if (autoPipelineTriedRef.current) return;
    autoPipelineTriedRef.current = true;
    const sub = submission;
    void (async () => {
      const st = await loadAiStatus(sub.studentId, id);
      const strokeCount = pages.reduce((a, p) => a + p.strokes.length, 0);
      if (
        st &&
        st.strokeCount === strokeCount &&
        st.failed === 0 &&
        st.reportStrokeCount === strokeCount
      )
        return; // 채점·분석·리포트까지 완료 — 아무것도 부르지 않는다
      await runAutoGradeQueue([
        {
          studentId: sub.studentId,
          submissionId: id,
          studentName: sub.studentName ?? '학생',
          title: sub.title || '문제지',
        },
      ]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submission, id, pages.length, receivingNow, autoGradingThis]);

  // ---------- PDF(교재)별 그룹 ----------
  const groups: PdfGroup[] = useMemo(() => {
    const map = new Map<string, PageEntry[]>();
    for (const p of pages) {
      const gid = noteGroupId(p);
      const list = map.get(gid);
      if (list) list.push(p);
      else map.set(gid, [p]);
    }
    return [...map.entries()].map(([gid, list]) => ({ id: gid, pages: list }));
  }, [pages]);

  // 그룹 제목(=원본 PDF 제목)·페이지 라벨(=PDF 실제 페이지 번호) —
  // ncode 인덱스에서 비동기 매칭. ncode 페이지 번호(p.247 등)가 아니라
  // 업로드한 PDF 안에서의 몇 번째 페이지인지로 표기한다.
  const [groupTitles, setGroupTitles] = useState<Record<string, string>>({});
  const [pageLabels, setPageLabels] = useState<Record<string, string>>({});
  // 교재 종류 (015): gid → pdfId → kind. '단순노트'는 문항 디텍션을 건너뛰고
  // "적힌 내용 안내" 분석을 쓴다. 종류 로드가 끝나야 자동 디텍션을 시작한다.
  const [groupPdfIds, setGroupPdfIds] = useState<Record<string, number>>({});
  /** 필기가 있는 페이지 → 그 페이지가 속한 교재(PDF) id.
   *  한 노트에 여러 교재가 인쇄될 수 있어 gid 하나로는 못 담는다. */
  const [pdfIdByPageKey, setPdfIdByPageKey] = useState<Record<string, number>>({});
  /** pdfId → 교재 제목 */
  const [pdfTitles, setPdfTitles] = useState<Record<number, string>>({});
  /** pdfId → 그 교재의 전체 페이지 (필기 없는 페이지 포함) */
  const [pdfAllPages, setPdfAllPages] = useState<Record<number, PdfIndexPage[]>>(
    {},
  );
  const [paperMetaMap, setPaperMetaMap] = useState<Map<number, PaperMeta>>(
    new Map(),
  );
  const [paperKinds, setPaperKinds] = useState<Map<number, PaperKind>>(
    new Map(),
  );
  const [kindsLoaded, setKindsLoaded] = useState(false);
  useEffect(() => {
    void listMyPaperMeta()
      .then((m) => {
        setPaperMetaMap(m);
        const kinds = new Map<number, PaperKind>();
        for (const [id, meta] of m) if (meta.kind) kinds.set(id, meta.kind);
        setPaperKinds(kinds);
      })
      .catch(() => {})
      .finally(() => setKindsLoaded(true));
  }, []);
  /**
   * 이 문서의 **과목** (027) — 문서가 걸친 교재 중 과목 지정이 있는 첫 값.
   * 미지정은 수학(027 이전 교재는 전부 수학이었다). 문항 분석 프롬프트·리포트
   * 구성·분석 캐시 키가 전부 이 값을 따른다 — 백그라운드 파이프라인
   * (auto-grade)과 같은 규칙이라 한쪽이 분석한 것을 다른 쪽이 다시 하지 않는다.
   */
  const docSubject: PaperSubject = useMemo(
    () =>
      effectiveSubject(
        [...new Set(Object.values(groupPdfIds))]
          .map((pid) => paperMetaMap.get(pid)?.subject)
          .find((v) => v != null) ?? null,
      ),
    [groupPdfIds, paperMetaMap],
  );
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const g of groups) {
        for (const page of g.pages) {
          try {
            const entry = await lookupNcodeEntry(
              page.section,
              page.owner,
              page.noteId,
              page.pageNumber,
            );
            if (!alive) return;
            if (entry?.pageIndex != null) {
              setPageLabels((m) => ({ ...m, [page.key]: `p.${entry.pageIndex}` }));
            }
            if (entry?.pdfId != null) {
              const pdfId = entry.pdfId;
              setGroupPdfIds((m) =>
                m[g.id] != null ? m : { ...m, [g.id]: pdfId },
              );
              // 🔑 **한 노트에 여러 교재가 인쇄될 수 있다.** 표지 PDF 와 문제
              // PDF 가 같은 ncode 노트(3_54_0)에 찍혀 있으면 gid 가 같아,
              // gid→pdfId 하나만 두던 종전 방식은 표지를 통째로 놓쳤다
              // (박다민A 합친 문서에서 실제로 그랬다 — 2026-08-25).
              // 페이지마다 pdfId 를 기록해 문서가 걸친 교재를 전부 잡는다.
              setPdfIdByPageKey((m) =>
                m[page.key] != null ? m : { ...m, [page.key]: pdfId },
              );
              if (entry.pdfTitle) {
                setPdfTitles((t) =>
                  t[pdfId] ? t : { ...t, [pdfId]: entry.pdfTitle! },
                );
              }
            }
            setGroupTitles((t) =>
              t[g.id] ? t : { ...t, [g.id]: entry?.pdfTitle ?? '연습장 노트' },
            );
          } catch {
            if (!alive) return;
            setGroupTitles((t) => (t[g.id] ? t : { ...t, [g.id]: '연습장 노트' }));
          }
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [groups]);

  const isAllMode = selectedKey?.startsWith('all:') ?? false;

  // ── 교재 전체 페이지 목록 (필기 없는 페이지 포함) ──
  // gid → PDF 의 모든 페이지. 필기 없는 페이지도 칩으로 노출해 "총 몇 페이지
  // 중 어디에 필기가 있는지"가 한눈에 보이게 한다.
  const [groupAllPages, setGroupAllPages] = useState<
    Record<string, PdfIndexPage[]>
  >({});

  // ── 학원 교재·문항별 프롬프트 (토글 OFF 면 빈 설정 = 공통 프롬프트만) ──
  // 합성·서명은 paper-prompts 모듈로만 — 파이프라인과 어긋나면 재채점이 부활한다.
  const academyIdForPrompts = useSessionStore((st) => st.profile?.academyId) ?? null;
  const [promptCfg, setPromptCfg] = useState<PaperPromptConfig>(EMPTY_PROMPT_CONFIG);
  /** 프롬프트를 이 화면에서 고치면(아래 다이얼로그) 올려 다시 읽는다 */
  const [promptRev, setPromptRev] = useState(0);
  /** 프롬프트 편집 다이얼로그 — 지금 보고 있는 교재/문항으로 연다 */
  const [promptDlg, setPromptDlg] = useState<{
    pdf: { id: number; title: string | null };
    focusNo: number | null;
  } | null>(null);
  useEffect(() => {
    const ids = [...new Set(Object.values(groupPdfIds))];
    if (ids.length === 0) return;
    let alive = true;
    void loadPaperPromptConfig(academyIdForPrompts, ids).then((cfg) => {
      if (alive) setPromptCfg(cfg);
    });
    return () => {
      alive = false;
    };
  }, [groupPdfIds, academyIdForPrompts, promptRev]);
  useEffect(() => {
    let alive = true;
    for (const [gid, pdfId] of Object.entries(groupPdfIds)) {
      if (groupAllPages[gid]) continue;
      void listPdfPagesFromIndex(pdfId)
        .then((list) => {
          if (alive && list.length > 0) {
            setGroupAllPages((m) => (m[gid] ? m : { ...m, [gid]: list }));
          }
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupPdfIds]);

  /** 이 문서가 걸친 **모든 교재**의 전체 페이지를 읽어 둔다 (표지 + 문제지) */
  useEffect(() => {
    let alive = true;
    for (const pdfId of new Set(Object.values(pdfIdByPageKey))) {
      if (pdfAllPages[pdfId]) continue;
      void listPdfPagesFromIndex(pdfId)
        .then((list) => {
          if (alive && list.length > 0) {
            setPdfAllPages((m) => (m[pdfId] ? m : { ...m, [pdfId]: list }));
          }
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfIdByPageKey]);

  // ── 페이지 유형 AI 판별 (사용자 요구 2026-08-24) ──
  // 교재 만들기에서 표지·정답지를 **지정하지 않아도** 인쇄 원본만 보고 알아낸다.
  // 대상은 **필기가 있는 페이지**뿐 — 안 쓴 페이지까지 부르면 AI 호출만 늘고
  // 얻는 게 없다. 결과는 교재 단위 캐시라 같은 교재는 한 번만 판별된다.
  const [pageKinds, setPageKinds] = useState<Record<string, PageKindDoc>>({});
  /** pageKey → 그 쪽에 인쇄된 묶음 제목("1단계"·"계산력"). 단계 이어받기의 시드. */
  const [pageHeadings, setPageHeadings] = useState<Record<string, string>>({});
  /** pageKey → 이 페이지가 어느 교재의 몇 쪽인가 + ncode 주소.
   *  **필기가 없는 페이지까지** 담는다 — 정답지 채점은 학생이 손대지 않은
   *  문항도 판정해야 하므로 그 페이지의 주소가 필요하다 (2026-08-24). */
  const pageAddrInfo = useMemo(() => {
    const m = new Map<
      string,
      {
        pdfId: number;
        pageIndex: number;
        addr: { section: number; owner: number; noteId: number; pageNumber: number };
      }
    >();
    const put = (pdfId: number, ip: PdfIndexPage) => {
      m.set(ip.key, {
        pdfId,
        pageIndex: ip.pageIndex,
        addr: {
          section: ip.section,
          owner: ip.owner,
          noteId: ip.noteId,
          pageNumber: ip.pageNumber,
        },
      });
    };
    // 교재별 전체 페이지가 정본 — 한 노트에 여러 교재가 있어도 전부 담긴다
    for (const [pdfIdStr, list] of Object.entries(pdfAllPages)) {
      for (const ip of list ?? []) put(Number(pdfIdStr), ip);
    }
    for (const [gid, pdfId] of Object.entries(groupPdfIds)) {
      for (const ip of groupAllPages[gid] ?? []) {
        if (!m.has(ip.key)) put(pdfId, ip);
      }
    }
    return m;
  }, [pdfAllPages, groupPdfIds, groupAllPages]);
  useEffect(() => {
    if (pages.length === 0) return;
    let alive = true;
    void (async () => {
      for (const pg of pages) {
        if (!alive) return;
        if (pageKinds[pg.key]) continue;
        const addr = pageAddrInfo.get(pg.key) ?? null;
        const doc = await classifyPrintedPage({
          pdfId: addr?.pdfId ?? null,
          pageIndex: addr?.pageIndex ?? null,
          page: pg,
        }).catch(() => null);
        if (!alive) return;
        if (doc) setPageKinds((m) => (m[pg.key] ? m : { ...m, [pg.key]: doc }));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, pageAddrInfo]);

  /** 필기가 있는 페이지의 **묶음 제목**을 읽어 둔다 (교재 단위 캐시라 1회) */
  useEffect(() => {
    if (pages.length === 0) return;
    let alive = true;
    void (async () => {
      for (const pg of pages) {
        if (!alive) return;
        if (pageHeadings[pg.key] !== undefined) continue;
        const addr = pageAddrInfo.get(pg.key) ?? null;
        const h = await readPageHeading({
          pdfId: addr?.pdfId ?? null,
          pageIndex: addr?.pageIndex ?? null,
          page: pg,
        }).catch(() => '');
        if (!alive) return;
        setPageHeadings((m) =>
          m[pg.key] !== undefined ? m : { ...m, [pg.key]: h },
        );
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, pageAddrInfo]);

  // ── 특수 페이지 (022: 표지 본인정보 / 별도 정답지) ──
  // 선생님이 교재에 지정한 것 **∪** AI 가 판별한 것. 어느 쪽으로 잡히든 문항
  // 인식·채점에서 빠지고, 표지는 본인정보 대조로 넘어간다.
  const specialKeys = useMemo(() => {
    const answer = new Set<string>();
    const info = new Set<string>();
    for (const [gid, pdfId] of Object.entries(groupPdfIds)) {
      const meta = paperMetaMap.get(pdfId);
      if (!meta) continue;
      for (const ip of groupAllPages[gid] ?? []) {
        if (meta.answerPage != null && ip.pageIndex === meta.answerPage)
          answer.add(ip.key);
        if (meta.infoPage != null && ip.pageIndex === meta.infoPage)
          info.add(ip.key);
      }
    }
    for (const [key, d] of Object.entries(pageKinds)) {
      if (d.kind === 'answer') {
        // 정답지는 번호 그리드가 문항처럼 잡히므로 인식 결과로 뒤집지 않는다
        answer.add(key);
        continue;
      }
      // 🚨 표지 판정은 **문항 인식으로 교차검증**한 뒤에만 믿는다 — AI 가 문제
      // 페이지를 표지로 잘못 보면 그 페이지 문항이 화면에서 통째로 사라진다.
      if (
        d.kind === 'info' &&
        (problems[key] ?? []).every((c) => c.meta?.no == null)
      ) {
        info.add(key);
      }
    }
    return { answer, info };
  }, [groupPdfIds, paperMetaMap, groupAllPages, pageKinds, problems]);

  // 정답지 인식 — 정답지 페이지에 필기가 있으면 답을 읽는다 (획 서명 캐시)
  const [sheet, setSheet] = useState<AnswerSheetDoc | null>(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const sheetSigRef = useRef('');
  useEffect(() => {
    if (!submission) return;
    const entry = pages.find((pg) => specialKeys.answer.has(pg.key));
    if (!entry) {
      setSheet(null);
      sheetSigRef.current = '';
      setSheetBusy(false);
      return;
    }
    const expected: number[] = [];
    for (const pg of pages) {
      if (specialKeys.answer.has(pg.key) || specialKeys.info.has(pg.key)) continue;
      for (const c of problems[pg.key] ?? [])
        if (c.meta?.no != null) expected.push(c.meta.no);
    }
    const expectedNos = [...new Set(expected)].sort((a, b) => a - b);
    const sig = `${submission.id}:${answerSheetRequestSig(entry, entry.strokes.map(st => st.id), expectedNos)}`;
    if (sheetSigRef.current === sig) return;
    sheetSigRef.current = sig;
    let alive = true;
    let settled = false;
    setSheetBusy(true);
    void recognizeAnswerSheet({
      studentId: submission.studentId,
      submissionId: submission.id,
      page: entry,
      strokes: entry.strokes,
      expectedNos,
    })
      .then((d) => alive && setSheet(d))
      .catch(() => { if (alive) sheetSigRef.current = ''; })
      .finally(() => {
        if (!alive) return;
        settled = true;
        setSheetBusy(false);
      });
    return () => {
      alive = false;
      if (!settled && sheetSigRef.current === sig) sheetSigRef.current = '';
      setSheetBusy(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submission, pages, specialKeys, problems]);

  // 표지 본인정보 인식·대조
  const [idCheck, setIdCheck] = useState<IdCheckDoc | null>(null);
  const [studentInfo, setStudentInfo] = useState<{
    name: string;
    school: string | null;
    grade: number | null;
  } | null>(null);
  const idSigRef = useRef('');
  useEffect(() => {
    if (!submission) return;
    const entry = pages.find((pg) => specialKeys.info.has(pg.key));
    if (!entry) {
      setIdCheck(null);
      return;
    }
    const sig = `${entry.key}:${entry.strokes.length}`;
    if (idSigRef.current === sig) return;
    idSigRef.current = sig;
    let alive = true;
    void recognizeIdInfo({
      studentId: submission.studentId,
      submissionId: submission.id,
      page: entry,
      strokes: entry.strokes,
    })
      .then((d) => alive && setIdCheck(d))
      .catch(() => {});
    void listMyStudents()
      .then((list) => {
        const st = list.find((x) => x.id === submission.studentId);
        if (alive && st)
          setStudentInfo({ name: st.name, school: st.school, grade: st.grade });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submission, pages, specialKeys]);

  // 정답지에 적힌 본인정보 — 표지·등록 정보와 **다를 때만** 알린다
  // (사용자 요구 2026-08-24: 맞으면 굳이 안내 안 해도 된다).
  const [sheetIdInfo, setSheetIdInfo] = useState<IdCheckDoc | null>(null);
  const sheetIdSigRef = useRef('');
  useEffect(() => {
    if (!submission) return;
    const entry = pages.find((pg) => specialKeys.answer.has(pg.key));
    if (!entry || entry.strokes.length === 0) {
      setSheetIdInfo(null);
      return;
    }
    const sig = `${entry.key}:${entry.strokes.length}`;
    if (sheetIdSigRef.current === sig) return;
    sheetIdSigRef.current = sig;
    let alive = true;
    void recognizeIdInfo({
      studentId: submission.studentId,
      submissionId: submission.id,
      page: entry,
      strokes: entry.strokes,
      slot: 'sheet',
      pageLabel: '시험지의 **정답지(답안 기입) 페이지**',
    })
      .then((d) => alive && setSheetIdInfo(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submission, pages, specialKeys]);

  /** 필기 없는 페이지 선택(`empty:{pageKey}`) → ncode 좌표 (배경 렌더용) */
  const emptyPagePaper = useMemo(() => {
    if (!selectedKey?.startsWith('empty:')) return null;
    const parts = selectedKey.slice(6).split('_').map(Number);
    if (parts.length !== 4 || parts.some(Number.isNaN)) return null;
    return {
      section: parts[0],
      owner: parts[1],
      noteId: parts[2],
      pageNumber: parts[3],
    };
  }, [selectedKey]);

  // 문항 선택 — selectedKey = `prob:${pageKey}#${i}`
  const selectedProblem = useMemo(() => {
    if (!selectedKey?.startsWith('prob:')) return null;
    const cid = selectedKey.slice(5);
    const pageKey = cid.split('#')[0];
    const cluster = problems[pageKey]?.find((c) => c.id === cid) ?? null;
    return cluster ? { pageKey, cluster } : null;
  }, [selectedKey, problems]);

  // 현재 문항 칩을 보여줄 페이지 (페이지 선택 또는 그 페이지의 문항 선택 시)
  const currentPageEntry = useMemo(() => {
    if (selectedProblem) {
      return pages.find((p) => p.key === selectedProblem.pageKey) ?? null;
    }
    if (selectedKey && !selectedKey.startsWith('all:')) {
      return pages.find((p) => p.key === selectedKey) ?? null;
    }
    return null;
  }, [selectedKey, selectedProblem, pages]);

  // ── 자동 채점 — 문항마다 "지문에서 정답 도출 + 학생 답 비교"를 **1회만** ──
  // 결과는 storage 캐시(서명 포함)에 남아, 필기·영역이 그대로면 재호출하지 않는다.
  const [storedGrades, setGrades] = useState<Record<string, ProblemGrade>>({});
  const gradeCacheRef = useRef<GradeCache>({ v: 1, byProblem: {} });
  // 과목을 확인하기 전에는 옛 결과를 화면·분석·정답지 비교에 흘리지 않는다.
  const grades = useMemo(() => {
    if (!kindsLoaded) return {};
    const out: Record<string, ProblemGrade> = {};
    for (const [key, cs] of Object.entries(problems)) {
      const pg = pages.find((p) => p.key === key);
      const pdfId = pageAddrInfo.get(key)?.pdfId ?? (pg ? groupPdfIds[noteGroupId(pg)] : undefined);
      if (pdfId == null) continue;
      const subject = effectiveSubject(paperMetaMap.get(pdfId)?.subject);
      const clusters = pg ? reassignClusters(cs ?? [], pg.strokes) : (cs ?? []);
      for (const c of clusters) {
        const g = storedGrades[c.id];
        if (!g) continue;
        const sig = gradeCacheRef.current.byProblem[c.id]?.sig;
        if (!isCurrentGrading(sig, subject)) continue;
        if (subject === '국어' && sig !== gradeSignature(c) + gradingSigExt(subject,
          promptSigExt(gradeDirective(promptCfg, pdfId, c.meta?.no)))) continue;
        out[c.id] = g;
      }
    }
    return out;
  }, [storedGrades, kindsLoaded, problems, pages, pageAddrInfo, groupPdfIds, paperMetaMap, promptCfg]);
  // 리포트 생성이 채점 완료를 기다릴 때 최신값을 보기 위한 ref (클로저 고정 방지)
  const gradesRef = useRef(grades);
  useEffect(() => {
    gradesRef.current = grades;
  }, [grades]);

  /** 인쇄 지문에서 구한 정답 (문항 id → 정답). 학생이 본문에 아무것도 안 쓴
   *  문항은 채점을 돌리지 않아 정답을 모르는데, **정답지에는 답이 적혀 있을 수
   *  있다** — 그때 정오를 매기려면 정답이 필요하다 (사용자 요구 2026-08-24). */
  const [printedAnswers, setPrintedAnswers] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!sheet) return;
    let alive = true;
    void (async () => {
      // 🚨 **필기가 있는 페이지만 돌면 안 된다.** 학생이 본문에 아무것도 안 쓴
      // 문항이야말로 정답지로만 판정되는 문항이다 — 인식된 문항 전체를 돈다.
      for (const [key, cs] of Object.entries(problems)) {
        if (specialKeys.answer.has(key) || specialKeys.info.has(key)) continue;
        const info = pageAddrInfo.get(key);
        const addr =
          info?.addr ?? pages.find((pg) => pg.key === key) ?? null;
        if (!info || !addr) continue;
        for (const c of cs ?? []) {
          if (!alive) return;
          const no = c.meta?.no;
          if (no == null) continue;
          // 정답지에 답이 있는데 정답을 모르는 문항만 — 그 외엔 부르지 않는다
          if (!sheet.answers[String(no)]) continue;
          if (grades[c.id]?.correctAnswer?.trim()) continue;
          if (printedAnswers[c.id] != null) continue;
          const ans = await resolvePrintedAnswer({
            pdfId: info.pdfId,
            no,
            page: addr,
            cluster: c,
          }).catch(() => '');
          if (!alive) return;
          setPrintedAnswers((m) => (m[c.id] != null ? m : { ...m, [c.id]: ans }));
        }
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, pages, problems, grades, specialKeys, pageAddrInfo]);

  const [semanticSheetGrades, setSemanticSheetGrades] = useState<Record<string, { sig: string; grade: ProblemGrade }>>({});
  const [semanticSheetBusy, setSemanticSheetBusy] = useState(false);

  // 정답지 기준 최종 판정 — **표시·리포트·분석 문맥의 정본** (캐시는 본문 채점 그대로)
  const sheetMerge = useMemo(() => {
    if (!sheet || !kindsLoaded) return null;
    const semanticById: Record<string, ProblemGrade> = {};
    let pending = false;
    const byId: Record<string, SheetVerdict> = {};
    // 필기 유무와 무관하게 **인식된 문항 전체** — 정답지가 정오의 정본이다
    for (const [key, cs] of Object.entries(problems)) {
      if (specialKeys.answer.has(key) || specialKeys.info.has(key)) continue;
      for (const c of cs ?? []) {
        if (c.meta?.no == null) continue;
        const g = grades[c.id];
        const pdfId = pageAddrInfo.get(key)?.pdfId;
        const subject = effectiveSubject(pdfId != null ? paperMetaMap.get(pdfId)?.subject : null);
        const answer = sheet.answers[String(c.meta.no)];
        if (answer && needsKoreanSheetGrading(subject, c.meta.type)) {
          const pg = pages.find(p => p.key === key);
          const current = pg ? reassignClusters(cs ?? [], pg.strokes).find(item => item.id === c.id)! : c;
          const sig = gradeSignature(current) + sheetGradingSigExt(gradingSigExt(subject,
            promptSigExt(gradeDirective(promptCfg, pdfId, c.meta.no))), answer);
          const cached = semanticSheetGrades[c.id];
          const graded = sameGradedSheetAnswer(g, answer) ? g
            : cached?.sig === sig ? cached.grade : undefined;
          if (!graded) pending = true;
          const result = graded ?? { ...blankGrade(c), verdict: 'unknown' as const,
            studentAnswer: answer, explanation: '별도 답안을 채점 중입니다.' };
          semanticById[c.id] = result;
          byId[c.id] = {
            ...mergeSheetVerdict(result, answer, true),
            transcriptionError: !!g?.studentAnswer && g.studentAnswer.trim() !== answer.trim(),
            correctBodyButSheetWrong: g?.verdict === 'correct' && result.verdict === 'wrong',
          };
          continue;
        }
        // 본문 채점이 정답을 못 채웠으면 인쇄 지문에서 구한 정답으로 메운다
        const fallback = printedAnswers[c.id]?.trim();
        const withAnswer =
          g && !g.correctAnswer?.trim() && fallback
            ? { ...g, correctAnswer: fallback }
            : !g && fallback
              ? { ...blankGrade(c), correctAnswer: fallback }
              : g;
        byId[c.id] = mergeSheetVerdict(
          withAnswer,
          sheet.answers[String(c.meta.no)],
        );
      }
    }
    return { byId, semanticById, pending, sheetCount: Object.keys(sheet.answers).length };
  }, [sheet, problems, grades, specialKeys, printedAnswers, kindsLoaded, pageAddrInfo, paperMetaMap, pages, promptCfg, semanticSheetGrades]);
  const effectiveGrades = useMemo(() => {
    if (!sheetMerge) return grades;
    const out = { ...grades, ...sheetMerge.semanticById };
    const clusterById = new Map<string, ProblemCluster>();
    for (const cs of Object.values(problems)) {
      for (const c of cs ?? []) clusterById.set(c.id, c);
    }
    for (const [cid, sv] of Object.entries(sheetMerge.byId)) {
      if (sv.source !== 'sheet') continue;
      // 본문 채점 결과가 없어도(필기 0) 정답지 판정은 살아 있어야 한다 —
      // 정답지가 그 학생의 실제 정오다 (사용자 2026-08-24).
      const c = clusterById.get(cid);
      const g = out[cid] ?? (c ? blankGrade(c) : null);
      if (!g) continue;
      out[cid] = {
        ...g,
        verdict: sv.verdict,
        studentAnswer: sv.sheetAnswer ?? g.studentAnswer,
      };
    }
    return out;
  }, [grades, sheetMerge, problems]);
  const effectiveGradesRef = useRef(effectiveGrades);
  useEffect(() => {
    effectiveGradesRef.current = effectiveGrades;
  }, [effectiveGrades]);


  const [grading, setGrading] = useState(false);
  /** 리포트 생성 취소 — 사용자가 [취소]를 누르면 대기를 멈춘다 */
  const reportCancelRef = useRef(false);
  const problemsRef = useRef(problems);
  useEffect(() => {
    problemsRef.current = problems;
  }, [problems]);
  const gradingRef = useRef(grading);
  useEffect(() => {
    gradingRef.current = grading || semanticSheetBusy || !!sheetMerge?.pending || (docSubject === '국어' && sheetBusy);
  }, [grading, semanticSheetBusy, sheetMerge, docSubject, sheetBusy]);

  const gradeTriedRef = useRef(new Set<string>());
  /** 채점 캐시가 storage 에서 도착했는가 — **도착 전에 채점 루프가 출발하면
   *  전부 캐시 미스로 보여 이미 채점한 문항에 AI 를 또 태운다** (2026-08-19
   *  사용자 지적: "완료된 걸 또 채점, 토큰 낭비"). */
  const [gradeCacheLoaded, setGradeCacheLoaded] = useState(false);
  useEffect(() => {
    if (!submission) return;
    setGradeCacheLoaded(false);
    void loadGradeCache(submission.studentId, submission.id).then((c) => {
      gradeCacheRef.current = c;
      const restored: Record<string, ProblemGrade> = {};
      for (const [id, g] of Object.entries(c.byProblem)) {
        const { sig: _s, ...rest } = g;
        void _s;
        restored[id] = rest;
      }
      setGrades(restored);
      setGradeCacheLoaded(true);
    });
    // autoGradingThis 가 false 로 바뀌는 순간(백그라운드 자동 채점 완료)에도
    // 다시 읽는다 — 파이프라인이 채워 둔 채점을 그대로 쓰고 재호출하지 않는다.
  }, [submission, autoGradingThis]);

  useEffect(() => {
    if (!submission || pages.length === 0 || grading) return;
    // 수신 중(데이터 불완전)·자동 채점 중(파이프라인이 담당)에는 돌지 않는다
    if (receivingNow || autoGradingThis) return;
    // **완료 문서는 재채점 금지** — 처리 요약(ai-status)이 이 획 구성으로
    // 완료라면 캐시가 정답이다 (2026-08-19: 완료 문서에 채점 배너 실사고)
    if (!kindsLoaded) return;
    // 캐시 도착 전에는 출발하지 않는다 — 미스로 오인해 재채점하는 것 방지
    if (!gradeCacheLoaded) return;
    // 아직 채점 안 한(또는 서명이 바뀐) 문항 모으기 — 페이지 순서대로.
    // 🚨 서명은 **상태의 배정이 아니라 지금 획으로 직접 배정**해 계산한다 —
    // 상태는 재배정 이펙트 적용 전(원시 캐시)일 수 있고, 그 원시 배정으로
    // 서명을 내면 캐시와 어긋나 문서를 열 때마다 전 문항이 재채점됐다.
    const todo: Array<{
      page: PageEntry;
      subject: PaperSubject;
      cluster: ProblemCluster;
      directive: string;
      sigExt: string;
    }> = [];
    for (const pg of pages) {
      const raw = problems[pg.key] ?? [];
      if (raw.length === 0) continue;
      const pdfIdOfPg = groupPdfIds[noteGroupId(pg)];
      if (pdfIdOfPg == null) continue;
      const subject = effectiveSubject(paperMetaMap.get(pdfIdOfPg)?.subject);
      if (aiDone && subject !== '국어' && !raw.some((c) =>
        !isCurrentGrading(gradeCacheRef.current.byProblem[c.id]?.sig, subject))) continue;
      for (const c of reassignClusters(raw, pg.strokes)) {
        // 번호 없는 획 영역은 문제가 아니다 — 채점하지 않는다 (2026-08-18)
        if (c.meta?.no == null) continue;
        // 학원 채점 기준 — 지시문이 바뀌면 서명이 바뀌어 그 문항만 재채점
        const directive = gradeDirective(promptCfg, pdfIdOfPg, c.meta.no);
        const sigExt = gradingSigExt(subject, promptSigExt(directive));
        const sig = gradeSignature(c) + sigExt;
        const cached = gradeCacheRef.current.byProblem[c.id];
        if (cached && cached.sig === sig) continue;
        if (gradeTriedRef.current.has(c.id + sig)) continue;
        todo.push({ page: pg, subject, cluster: c, directive, sigExt });
      }
    }
    if (todo.length === 0) return;
    setGrading(true);
    void (async () => {
      try {
        for (const { page, subject, cluster, directive, sigExt } of todo) {
          gradeTriedRef.current.add(cluster.id + gradeSignature(cluster) + sigExt);
          try {
            const { grade } = await gradeProblem({
              page,
              subject,
              cluster,
              strokes: page.strokes,
              cache: gradeCacheRef.current,
              directive: directive || undefined,
              sigExt,
            });
            gradeCacheRef.current = putGrade(
              gradeCacheRef.current,
              cluster,
              grade,
              sigExt,
            );
            setGrades((m) => ({ ...m, [cluster.id]: grade }));
          } catch {
            // 한 문항 실패(일시적 API 오류 등)가 나머지 채점을 끊으면
            // 문제지 전체가 "채점 중" 에 갇힌다 — 실패 문항만 건너뛴다.
            // 🚨 다만 **빈자리로 두면 안 된다**: 리포트 대기가 "모든 문항의
            // 결과" 를 요구해 영원히 "채점 중" 이 된다(2026-08-19 실사고).
            // 판정 불가로 화면에만 기록한다 — 캐시에는 안 넣어 다음 열람 때
            // 자동 재시도된다.
            setGrades((m) => ({
              ...m,
              [cluster.id]: {
                ...blankGrade(cluster),
                verdict: 'unknown',
                explanation:
                  '채점 호출이 일시 실패했습니다 — 문서를 다시 열면 재시도됩니다.',
              },
            }));
          }
        }
        await saveGradeCache(
          submission.studentId,
          submission.id,
          gradeCacheRef.current,
        );
      } finally {
        setGrading(false);
      }
    })();
    // grading 이 false 로 풀릴 때 다시 돌아, 그 사이 새로 인식된 문항도 채점한다.
    // receivingNow/autoGradingThis 가 풀릴 때도 다시 돌아 보류분을 이어간다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submission, pages, problems, grading, receivingNow, autoGradingThis, gradeCacheLoaded, aiDone, promptCfg, kindsLoaded, groupPdfIds, paperMetaMap]);

  useEffect(() => {
    if (!submission || !sheet || !kindsLoaded || !gradeCacheLoaded || grading
      || receivingNow || autoGradingThis) return;
    let alive = true;
    setSemanticSheetBusy(true);
    void (async () => {
      try {
        const next = pruneSheetGrades(gradeCacheRef.current, sheet.answers);
        if (next !== gradeCacheRef.current) {
          gradeCacheRef.current = next;
          setSemanticSheetGrades(m => Object.fromEntries(Object.entries(m)
            .filter(([cid]) => !!next.byProblem[`${cid}:sheet`])));
          await saveGradeCache(submission.studentId, submission.id, next);
        }
        for (const [key, raw] of Object.entries(problems)) {
          if (!alive) break;
          if (specialKeys.answer.has(key) || specialKeys.info.has(key)) continue;
          const info = pageAddrInfo.get(key);
          if (!info) continue;
          const subject = effectiveSubject(paperMetaMap.get(info.pdfId)?.subject);
          const pg = pages.find(p => p.key === key);
          const page = pg ?? info.addr;
          const clusters = pg ? reassignClusters(raw ?? [], pg.strokes) : (raw ?? []);
          for (const c of clusters) {
            if (!alive) break;
            const answer = sheet.answers[String(c.meta?.no)];
            if (!answer || !needsKoreanSheetGrading(subject, c.meta?.type)) continue;
            const directive = gradeDirective(promptCfg, info.pdfId, c.meta?.no);
            const ext = gradingSigExt(subject, promptSigExt(directive));
            const { grade } = await gradeKoreanSheetProblem({
              page, cluster: c, strokes: pg?.strokes ?? [], cache: gradeCacheRef.current,
              bodyGrade: grades[c.id], sheetAnswer: answer, directive, sigExt: ext,
            });
            if (!alive) break;
            gradeCacheRef.current = putKoreanSheetGrade(gradeCacheRef.current, c, grade, answer, ext);
            const sig = gradeSignature(c) + sheetGradingSigExt(ext, answer);
            setSemanticSheetGrades(m => ({ ...m, [c.id]: { sig, grade } }));
          }
        }
        if (alive) await saveGradeCache(submission.studentId, submission.id, gradeCacheRef.current);
      } finally { if (alive) setSemanticSheetBusy(false); }
    })();
    return () => { alive = false; setSemanticSheetBusy(false); };
  }, [submission, sheet, kindsLoaded, gradeCacheLoaded, grading, receivingNow, autoGradingThis,
    problems, pages, pageAddrInfo, paperMetaMap, specialKeys, promptCfg, grades]);

  /**
   * **PDF 전체의 문항 수** — 학생이 필기한 페이지만 세면 "20문제 중 3개" 를
   * 못 만든다(사용자 요구 2026-08-17). 교재의 모든 페이지를 인식해 문항을
   * 센다. 손대지 않은 페이지도 인쇄 문제는 그대로 읽히므로 셀 수 있다.
   * 결과는 문항 캐시에 남아 다음부터는 호출이 없다.
   */
  const [pdfPageProblemCount, setPdfPageProblemCount] = useState<
    Record<string, number>
  >({});
  useEffect(() => {
    if (!submission?.studentId || !id) return;
    const targets = Object.values(groupAllPages)
      .flat()
      .filter((pg) => {
        const key = buildPageKey(pg.section, pg.owner, pg.noteId, pg.pageNumber);
        if (specialKeys.answer.has(key) || specialKeys.info.has(key)) return false;
        return !(key in pdfPageProblemCount) && !(problems[key]?.length > 0);
      });
    if (targets.length === 0) return;
    let alive = true;
    void (async () => {
      // 순차 처리 — 한 페이지씩. 동시에 던지면 비전 API 를 두드린다.
      for (const pg of targets) {
        if (!alive) return;
        const key = buildPageKey(pg.section, pg.owner, pg.noteId, pg.pageNumber);
        try {
          const cs = await detectProblemsForPage({
            studentId: submission.studentId,
            submissionId: id,
            pageKey: key,
            page: pg,
            strokes: [],
          });
          if (!alive) return;
          setPdfPageProblemCount((m) => ({ ...m, [key]: cs.length }));
          // 개수만 세고 끝내면 **리포트가 필기한 문항만** 담는다 —
          // 리포트 문항 수와 문제지 문항 수가 어긋난다(사용자 지적 2026-08-17).
          // 인식한 문항을 목록에도 넣어 "안 푼 문제" 까지 리포트에 들어가게 한다.
          if (cs.length > 0) {
            setProblems((m) => (m[key]?.length ? m : { ...m, [key]: cs }));
          }
        } catch {
          if (!alive) return;
          setPdfPageProblemCount((m) => ({ ...m, [key]: 0 }));
        }
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupAllPages, problems, submission?.studentId, id]);

  // ── 스냅샷 write-through — 채점·분석·OCR 등 AI 파생 상태를 세션 보존 ──
  // 뒤로 갔다 와도(리포트 ↔ 리뷰 등) 이미 끝난 분석·채점이 즉시 그려지고
  // **다시 실행되지 않는다** (사용자 요구 2026-08-19). load() 가 만든 스냅샷
  // 객체를 제자리 갱신한다 — 최초 로드 전에는 아무것도 하지 않는다.
  useEffect(() => {
    if (!id) return;
    const snap = reviewSnapshots.get(id);
    if (!snap) return;
    snap.grades = grades;
    snap.analysisByScope = analysisByScope;
    snap.editedByScope = editedByScope;
    snap.ocrByScope = ocrByScope;
    snap.ocrText = ocrText;
    snap.ocrEdited = ocrEdited;
    snap.body = body;
    snap.pdfPageProblemCount = pdfPageProblemCount;
    snap.groupTitles = groupTitles;
    snap.pageLabels = pageLabels;
    snap.groupPdfIds = groupPdfIds;
    snap.groupAllPages = groupAllPages;
  }, [
    id,
    grades,
    analysisByScope,
    editedByScope,
    ocrByScope,
    ocrText,
    ocrEdited,
    body,
    pdfPageProblemCount,
    groupTitles,
    pageLabels,
    groupPdfIds,
    groupAllPages,
  ]);

  /**
   * 교재 전수 인식이 **끝났는가**. 끝나기 전에 숫자를 보여주면 페이지를 옮길
   * 때마다 값이 달라져 "데이터가 틀렸나" 로 읽힌다(사용자 지적 2026-08-17).
   * 사용자가 보는 숫자는 **최종값 하나**여야 한다 — 그전에는 '계산 중' 을 쓴다.
   */
  const pdfCountReady = useMemo(() => {
    const all = Object.values(groupAllPages).flat();
    if (all.length === 0) return false;
    return all.every((pg) => {
      const key = buildPageKey(pg.section, pg.owner, pg.noteId, pg.pageNumber);
      if (specialKeys.answer.has(key) || specialKeys.info.has(key)) return true;
      return key in pdfPageProblemCount || (problems[key]?.length ?? 0) > 0;
    });
  }, [groupAllPages, pdfPageProblemCount, problems, specialKeys]);

  /** 교재 전체 문항 수 — 필기한 페이지는 인식 결과, 나머지는 위 스윕 결과 */
  const totalProblemsInPdf = useMemo(() => {
    const seen = new Map<string, number>();
    for (const [key, cs] of Object.entries(problems)) {
      if (specialKeys.answer.has(key) || specialKeys.info.has(key)) continue;
      // **문제번호가 있는 문항만** 센다 — 획 폴백("영역 N")은 문제가 아니다
      // (사용자 정의 2026-08-18: 개수 = PDF 에 문제번호+문제가 있는 경우).
      const numbered = (cs ?? []).filter((c) => c.meta?.no != null).length;
      if (numbered > 0) seen.set(key, numbered);
    }
    for (const [key, n] of Object.entries(pdfPageProblemCount)) {
      if (!seen.has(key)) seen.set(key, n);
    }
    let sum = 0;
    for (const n of seen.values()) sum += n;
    return sum;
  }, [problems, pdfPageProblemCount, specialKeys]);

  /** 화면에 쓰는 문제지 전체 문항 수 (인식 완료 후에만 의미 있다) */
  const totalProblems = Math.max(totalProblemsInPdf, 0);

  /** 이 제출 전체의 채점 요약 (100점 만점) */
  /** 정오 확정 — 정답이 아니면 무조건 틀림 (사용자 지시 2026-08-26) */
  const scoreSummary = useMemo(() => {
    // 필기 페이지만 세면 **정답지로만 맞힌 문항이 빠진다** — 학생이 본문에
    // 아무것도 안 쓰고 정답지에만 답을 적는 경우가 그렇다 (2026-08-24).
    const all = Object.entries(problems).flatMap(([key, cs]) =>
      specialKeys.answer.has(key) || specialKeys.info.has(key)
        ? []
        : (cs ?? []).map((c) => effectiveGrades[c.id]).filter(Boolean),
    ) as ProblemGrade[];
    return all.length > 0 ? computeScore(all) : null;
  }, [problems, effectiveGrades, specialKeys]);

  // 문항 보기 영역 = 인식된 사각형 ∪ 배정된 필기 범위 — 영역 밖으로 나간
  // 풀이(멀리 떨어진 답란 등)도 포커스·하이라이트에 전부 들어온다
  const problemViewRect = useMemo(() => {
    if (!selectedProblem) return null;
    const page = pages.find((p) => p.key === selectedProblem.pageKey);
    let r = { ...selectedProblem.cluster.bbox };
    if (page) {
      // 페이지 범위 = 이 페이지 전 문항 박스의 합집합(항상 용지 안).
      // 용지 밖 노이즈 dot 을 이 범위로 걸러야 영역이 페이지 밖으로 폭발하지
      // 않는다 (2026-08-13 박시원 p.1 1번 — dot 4개가 박스를 3배로 키움).
      const all = problems[selectedProblem.pageKey] ?? [];
      const paper = all.length
        ? {
            Xmin: Math.min(...all.map((c) => c.bbox.minX)),
            Xmax: Math.max(...all.map((c) => c.bbox.maxX)),
            Ymin: Math.min(...all.map((c) => c.bbox.minY)),
            Ymax: Math.max(...all.map((c) => c.bbox.maxY)),
          }
        : null;
      const ids = new Set(selectedProblem.cluster.strokeIds);
      const mine = sanitizeStrokes(
        page.strokes.filter((s) => ids.has(s.id)),
        paper,
      );
      const b = strokeBounds(mine);
      if (b) {
        // 배정된 획까지 감싸 넓히되, **자기 문제 번호 줄 위로는 올라가지 않는다.**
        // 위로 넓히면 앞 문제의 풀이·답란까지 선택 영역에 들어와, 3번을 골랐는데
        // 2번 필기가 함께 표시된다 (2026-08-17 사용자 지적).
        const meta = selectedProblem.cluster.meta;
        const ceiling = meta && Number.isFinite(meta.numberY)
          ? Math.max(r.minY, meta.numberY)
          : r.minY;
        r = {
          minX: Math.min(r.minX, b.minX),
          minY: Math.max(ceiling, Math.min(r.minY, b.minY)),
          maxX: Math.max(r.maxX, b.maxX),
          maxY: Math.max(r.maxY, b.maxY),
        };
      }
      if (paper) r = clampRectToPaper(r, paper);
    }
    return r;
  }, [selectedProblem, pages, problems]);

  const verdictMarks = useMemo(() => {
    if (!currentPageEntry) return undefined;
    const out: Array<{
      id: string;
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
      verdict: 'correct' | 'wrong';
    }> = [];
    for (const c of problems[currentPageEntry.key] ?? []) {
      const v = effectiveGrades[c.id]?.verdict;
      if (v !== 'correct' && v !== 'wrong') continue;
      // 채점 표시는 **인쇄된 문제 번호 옆**에 찍는다 (사용자 지정 2026-08-17).
      // 영역 좌상단을 쓰면 안 된다 — 영역은 용지를 빈틈없이 덮으므로 좌상단이
      // 왼쪽 여백이라, 표시가 문제와 상관없는 빈 곳에 떠 버린다.
      const m = c.meta;
      const at =
        m && Number.isFinite(m.numberX) && Number.isFinite(m.numberY)
          ? { minX: m.numberX, minY: m.numberY, maxX: m.numberX, maxY: m.numberY }
          : c.bbox;
      out.push({ id: c.id, ...at, verdict: v });
    }
    return out.length > 0 ? out : undefined;
  }, [currentPageEntry, problems, effectiveGrades]);

  const currentStrokes: Stroke[] = useMemo(() => {
    if (!selectedKey) return [];
    if (selectedKey.startsWith('empty:')) return []; // 필기 없는 페이지 — 배경만
    if (selectedProblem) {
      const page = pages.find((p) => p.key === selectedProblem.pageKey);
      if (!page) return [];
      // 배정 + **영역 안 실물** 합집합 — 공용 헬퍼(파이프라인 문항분석과 동일
      // 집합이어야 분석 범위가 일치한다). 채점의 영역 폴백과 같은 규칙.
      return problemScopeStrokes(selectedProblem.cluster, page.strokes);
    }
    if (selectedKey.startsWith('all:')) {
      const gid = selectedKey.slice(4);
      const g = groups.find((x) => x.id === gid);
      if (!g) return [];
      return g.pages
        .flatMap((p) => p.strokes)
        .sort((a, b) => a.startedAt - b.startedAt);
    }
    return pages.find((p) => p.key === selectedKey)?.strokes ?? [];
  }, [selectedKey, selectedProblem, groups, pages]);

  // 분석 범위 — 전체 제출(null) / PDF·페이지·문항(스트로크 부분집합)
  const scopeInfo = useMemo(() => {
    if (!selectedKey) return null;
    if (selectedKey.startsWith('empty:')) return null; // 필기 없음 — 분석 대상 아님
    // 캐시 키에 **과목 꼬리**가 붙는다 (027) — 과목을 바꾸면 프롬프트가 달라져
    // 다시 분석해야 한다. 수학은 꼬리가 없어 기존 캐시가 그대로 살아 있다.
    const sub = subjectSigExt(docSubject);
    if (selectedProblem) {
      return {
        key: problemScopeKey(selectedProblem.cluster.id, docSubject),
        label: selectedProblem.cluster.label,
      };
    }
    if (selectedKey.startsWith('all:')) {
      if (groups.length <= 1) return null; // 유일 그룹 전체 = 제출 전체
      return { key: boundedGradingScope(`g-${selectedKey.slice(4)}${sub}`, docSubject), label: 'PDF 전체' };
    }
    return { key: boundedGradingScope(`p-${selectedKey}${sub}`, docSubject), label: '페이지' };
  }, [selectedKey, selectedProblem, groups.length, docSubject]);
  const scopeCacheKey = scopeInfo?.key ?? fullAnalysisKey(docSubject);
  const scopeAnalysis = analysisByScope[scopeCacheKey];
  const analysis = scopeAnalysis && isCurrentAssessment(scopeAnalysis.assessment, docSubject)
    ? scopeAnalysis : null;

  // 재생 컨트롤을 페이지가 직접 쥐어, 분석 타임라인 클릭 → 해당 시점으로 점프
  const playback = usePlayback(currentStrokes);

  // 현재 범위의 시작 시각 — 분석 fromMs 의 기준점
  const analysisT0 = useMemo(() => {
    let min = Infinity;
    for (const s of currentStrokes) if (s.startedAt < min) min = s.startedAt;
    return Number.isFinite(min) ? min : 0;
  }, [currentStrokes]);

  const jumpToStage = (fromMs: number) => {
    // 압축 타임라인이 공백을 제거하므로 실제 시각으로 직접 시크한다
    playback.seekToTs(analysisT0 + fromMs);
  };

  /**
   * **멈춘 구간** — 지금 보고 있는 범위의 획들 사이에서 8초 이상 끊긴 자리.
   * 문항 상세에서 시간 단계 목록 대신 이걸 버튼으로 보여준다(사용자 요구
   * 2026-08-24). 8초는 문항 타임라인이 "시도"를 가르는 기준과 같은 값이다.
   */
  const delaySpans = useMemo(() => {
    const sorted = [...currentStrokes].sort((a, b) => a.startedAt - b.startedAt);
    const out: Array<{ fromMs: number; toMs: number }> = [];
    for (let i = 1; i < sorted.length; i++) {
      const prevEnd = sorted[i - 1].endedAt ?? sorted[i - 1].startedAt;
      const gap = sorted[i].startedAt - prevEnd;
      if (gap >= 8000) {
        out.push({
          fromMs: prevEnd - analysisT0,
          toMs: sorted[i].startedAt - analysisT0,
        });
      }
    }
    // 긴 것부터 — 선생님이 먼저 볼 곳이 위로 온다
    out.sort((a, b) => b.toMs - b.fromMs - (a.toMs - a.fromMs));
    return out.slice(0, 6);
  }, [currentStrokes, analysisT0]);

  /** 멈춘 구간 자동 재생 — 멈추기 직전 필기부터 다시 시작한 필기까지 */
  const playUntilRef = useRef<number | null>(null);
  const playDelay = (d: { fromMs: number; toMs: number }) => {
    // 조금 앞에서 시작해야 "쓰다가 멈췄다" 가 보인다
    playback.seekToTs(analysisT0 + Math.max(0, d.fromMs - 3000));
    playUntilRef.current = analysisT0 + d.toMs + 3000;
    if (!playback.isPlaying) playback.togglePlay();
  };
  useEffect(() => {
    const until = playUntilRef.current;
    if (until == null) return;
    if (!playback.isPlaying) {
      playUntilRef.current = null;
      return;
    }
    if (playback.currentTs >= until) {
      playUntilRef.current = null;
      playback.togglePlay();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playback.currentTs, playback.isPlaying]);

  // 분석 문제점(issues) 시간 구간에 걸친 스트로크 — 캔버스에서 **형광펜**으로 표시.
  // (빨간색은 채점 ○/✗ 전용이라 뜻이 겹치지 않게 분리했다 — 2026-08-16)
  //
  // 문항 범위에는 아직 그 범위의 분석이 없을 수 있다 — **페이지/전체 분석의
  // 형광펜을 물려받는다**. 페이지에서 보이던 강조가 문항으로 들어가면 사라지던
  // 문제(사용자 지적 2026-08-18). 시간 기준(t0)은 각 분석 범위의 시작 시각.
  // 어떤 이슈가 이 문항의 획에 닿았는지(= 왜 칠했는지)도 함께 수집한다.
  const { markedStrokeIds, markedIssues } = useMemo(() => {
    const sources: Array<{ issues: AnalysisIssue[]; t0: number }> = [];
    const add = (
      a: AnalysisReport | null | undefined,
      scopeStrokes: { startedAt: number }[],
    ) => {
      if (!a?.issues?.length || !isCurrentAssessment(a.assessment, docSubject) || scopeStrokes.length === 0) return;
      let min = Infinity;
      for (const st of scopeStrokes) if (st.startedAt < min) min = st.startedAt;
      if (Number.isFinite(min)) sources.push({ issues: a.issues, t0: min });
    };
    add(analysis, currentStrokes);
    if (selectedProblem) {
      const pg = pages.find((x) => x.key === selectedProblem.pageKey);
      if (pg) add(analysisByScope[boundedGradingScope(`p-${pg.key}${subjectSigExt(docSubject)}`, docSubject)], pg.strokes);
      add(analysisByScope[fullAnalysisKey(docSubject)], pages.flatMap((x) => x.strokes));
    }
    const ids = new Set<string>();
    const hit: AnalysisIssue[] = [];
    for (const { issues, t0 } of sources) {
      for (const it of issues) {
        let matched = false;
        for (const st of currentStrokes) {
          const rel = st.startedAt - t0;
          if (rel >= it.fromMs && rel <= Math.max(it.toMs, it.fromMs + 1)) {
            ids.add(st.id);
            matched = true;
          }
        }
        if (
          matched &&
          !hit.some((h) => h.title === it.title && h.why === it.why)
        ) {
          hit.push(it);
        }
      }
    }
    return {
      markedStrokeIds: ids.size > 0 ? ids : undefined,
      markedIssues: hit,
    };
  }, [analysis, analysisByScope, currentStrokes, selectedProblem, pages, docSubject]);

  // ── 파생: 활성 교재(PDF)·문항 정렬·좌/우 단·보는 중 라벨 ──
  const activeGroupId = useMemo(() => {
    if (!selectedKey) return groups[0]?.id ?? null;
    if (selectedKey.startsWith('all:')) return selectedKey.slice(4);
    if (selectedKey.startsWith('empty:')) {
      // `empty:{s_o_b_p}` — 그룹 id 는 앞 세 성분
      return selectedKey.slice(6).split('_').slice(0, 3).join('_');
    }
    const pk = selectedProblem ? selectedProblem.pageKey : selectedKey;
    const pg = pages.find((p) => p.key === pk);
    return pg ? noteGroupId(pg) : (groups[0]?.id ?? null);
  }, [selectedKey, selectedProblem, pages, groups]);

  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? null;

  /** gid → 교재 종류 (없으면 null = 종류 미지정, 기존 동작) */
  const kindOfGroup = useCallback(
    (gid: string | null): PaperKind | null => {
      if (!gid) return null;
      const pdfId = groupPdfIds[gid];
      return pdfId != null ? (paperKinds.get(pdfId) ?? null) : null;
    },
    [groupPdfIds, paperKinds],
  );
  const isNoteGroup = kindOfGroup(activeGroupId) === '단순노트';

  /**
   * **문서 전체의 페이지** — 표지와 문제지를 한 시험지로 합쳤으면 페이지도
   * 한 줄로 이어져야 한다(사용자 2026-08-25: "표지 2쪽이 1·2, 문제지가 3쪽부터").
   * 표지 교재를 앞에 놓고, 각 교재의 페이지를 차례로 붙인 뒤 **연속 번호**를 매긴다.
   * 교재가 하나뿐이면 종전과 같은 목록·같은 번호다.
   */
  const allPagesOrdered = useMemo(() => {
    // 문서가 걸친 교재 전부 — 표지 교재를 앞에 놓고 페이지를 이어붙인다.
    const ids = Object.keys(pdfAllPages).map(Number);
    if (ids.length === 0) {
      // 교재별 목록이 아직 없으면 gid 기준(단일 교재)으로 폴백
      const gids = Object.keys(groupAllPages);
      const out: Array<{ ip: PdfIndexPage; no: number }> = [];
      for (const gid of gids) {
        for (const ip of groupAllPages[gid] ?? []) out.push({ ip, no: out.length + 1 });
      }
      return out;
    }
    ids.sort((a, b) => {
      const ta = pdfTitles[a] ?? '';
      const tb = pdfTitles[b] ?? '';
      const ca = isCoverPaper(ta) ? 0 : 1;
      const cb = isCoverPaper(tb) ? 0 : 1;
      return ca - cb || ta.localeCompare(tb);
    });
    const out: Array<{ ip: PdfIndexPage; no: number }> = [];
    for (const pdfId of ids) {
      for (const ip of pdfAllPages[pdfId] ?? []) {
        out.push({ ip, no: out.length + 1 });
      }
    }
    return out;
  }, [pdfAllPages, pdfTitles, groupAllPages]);

  /**
   * **단계 이어받기 정규화** — 인식 결과를 화면에 쓰기 전에 한 번 보정한다.
   * 단계형 테스트지는 한 단계가 두 쪽에 걸쳐 8문항인데 단계 제목은 첫 쪽에만
   * 인쇄돼, 둘째 쪽 문항은 "5번" 처럼 단계 없이 남는다. 그러면 단계마다 번호가
   * 겹쳐 리포트에서 같은 번호가 여러 번 나오고 AI 코멘트까지 복제된다
   * (박다민A 실데이터로 확인, 2026-08-25).
   * 여기서 한 번만 고쳐 두면 화면·채점·리포트가 모두 같은 라벨을 본다.
   */
  useEffect(() => {
    const keys = Object.keys(problems);
    if (keys.length === 0) return;
    // 🚨 **교재별로** 끊어서 이어받는다 — 섞으면 표지(계산력)가 앞 교재의
    // 마지막 단계를 물려받는다(표지 쪽번호가 문제지보다 뒤일 수 있다).
    // 🚨 정렬은 **pageKey 의 쪽 번호**로 한다. 페이지 인덱스(allPagesOrdered)가
    //    아직 안 실렸을 때 정렬이 무력화돼 객체 키 순서(319,318,317,314…)대로
    //    이어받는 사고가 났다 — 317 의 5~8번이 3단계로 붙었다(2026-08-25 실측).
    const byPdf = new Map<number, string[]>();
    for (const k of keys) {
      const pdfId = pageAddrInfo.get(k)?.pdfId;
      // 어느 교재인지 모르면 **물려주지 않는다** — 잘못 붙이느니 그대로 둔다
      if (pdfId == null) continue;
      if (!byPdf.has(pdfId)) byPdf.set(pdfId, []);
      byPdf.get(pdfId)!.push(k);
    }
    const fixed: Array<[string, (typeof problems)[string]]> = [];
    for (const [, list] of byPdf) {
      list.sort((a, b) => pageNoOfKey(a) - pageNoOfKey(b));
      fixed.push(
        ...carryStages(
          list.map((k) => [k, problems[k] ?? []] as const),
          pageHeadings,
        ),
      );
    }
    const changed = fixed.some(([k, cs]) =>
      cs.some((c, i) => c.label !== (problems[k] ?? [])[i]?.label),
    );
    if (!changed) return;
    setProblems((m) => ({ ...m, ...Object.fromEntries(fixed) }));
  }, [problems, allPagesOrdered, pageAddrInfo, pageHeadings]);

  /**
   * 페이지 칩에 붙일 **그 페이지의 문제 번호** (사용자 요구 2026-08-25).
   * 문항 인식이 이미 페이지별 번호를 알고 있으므로 OCR 을 새로 돌리지 않는다.
   * 예: "1단계 1~4번" / "1·3·5번" / 문항이 없으면 빈 문자열.
   */
  const problemRangeOfPage = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [key, cs] of Object.entries(problems)) {
      const nos = (cs ?? [])
        .map((c) => c.meta?.no)
        .filter((n): n is number => n != null)
        .sort((a, b) => a - b);
      if (nos.length === 0) continue;
      const stage = (cs ?? []).find((c) => c.meta?.group?.trim())?.meta?.group?.trim();
      const contiguous =
        nos.length > 1 && nos[nos.length - 1] - nos[0] === nos.length - 1;
      const body = contiguous
        ? `${nos[0]}~${nos[nos.length - 1]}번`
        : `${nos.join('·')}번`;
      out[key] = stage ? `${stage} ${body}` : body;
    }
    return out;
  }, [problems]);

  /** 현재 페이지의 문항 — 번호 오름차순 ("5번" → 5) */
  const sortedClusters = useMemo(() => {
    if (!currentPageEntry) return [];
    // 정답지·본인정보 페이지는 문항이 아니다 — 번호 그리드가 문항으로 잡혀도 숨김
    if (
      specialKeys.answer.has(currentPageEntry.key) ||
      specialKeys.info.has(currentPageEntry.key)
    )
      return [];
    const list = [...(problems[currentPageEntry.key] ?? [])];
    // 🐞 예전에는 라벨의 **첫 숫자**를 번호로 읽었다 — "1단계-2번" 에서 단계
    // 숫자 1 을 집어 전부 같은 값이 되고, y 순서로만 갈려 2단 레이아웃에서
    // 1,3,4,2 처럼 뒤엉켰다(사용자 신고 2026-08-25).
    // 이제 meta.no 를 쓰고, 없으면 라벨 **끝의 "N번"** 을 읽는다.
    const num = (c: ProblemCluster) => {
      if (c.meta?.no != null) return c.meta.no;
      const m = /(\d+)\s*번\s*$/.exec(c.label.trim());
      return m ? parseInt(m[1], 10) : 999;
    };
    const stage = (c: ProblemCluster) => c.meta?.group ?? '';
    list.sort(
      (a, b) =>
        stage(a).localeCompare(stage(b)) ||
        num(a) - num(b) ||
        a.bbox.minY - b.bbox.minY,
    );
    return list;
  }, [currentPageEntry, problems, specialKeys]);

  /** 선택 문항이 시험지 왼쪽 단인지 오른쪽 단인지 — 분석 패널 배치 기준 */
  const problemSide: 'L' | 'R' = useMemo(() => {
    if (!selectedProblem) return 'L';
    const clusters = problems[selectedProblem.pageKey] ?? [];
    const xs = clusters.flatMap((c) => [c.bbox.minX, c.bbox.maxX]);
    if (xs.length === 0) return 'L';
    const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
    const b = selectedProblem.cluster.bbox;
    return (b.minX + b.maxX) / 2 <= mid ? 'L' : 'R';
  }, [selectedProblem, problems]);

  const viewingLabel = useMemo(() => {
    const title = activeGroupId ? (groupTitles[activeGroupId] ?? '교재') : '';
    if (!selectedKey) return title;
    if (selectedProblem) {
      const pl =
        pageLabels[selectedProblem.pageKey] ??
        pages.find((p) => p.key === selectedProblem.pageKey)?.label ??
        '';
      return `${title} · ${pl} · ${selectedProblem.cluster.label}`;
    }
    if (selectedKey.startsWith('all:')) return `${title} · 전체`;
    if (selectedKey.startsWith('empty:')) {
      const k = selectedKey.slice(6);
      const hit = allPagesOrdered.find((x) => x.ip.key === k);
      return `${title}${hit ? ` · p.${hit.no}` : ''} · 필기 없음`;
    }
    const pl = pageLabels[selectedKey] ?? pages.find((p) => p.key === selectedKey)?.label ?? '';
    return `${title} · ${pl} · 페이지 전체`;
  }, [activeGroupId, groupTitles, allPagesOrdered, selectedKey, selectedProblem, pageLabels, pages]);

  // ── 이 화면에서 AI 프롬프트 열람·수정 (사용자 요구 2026-08-24) ──
  // "지금 이 교재·이 문항에 무엇이 적용 중인가" 를 그대로 보여주고, 같은 자리에서
  // 고친다. 표시 문구는 실제 합성 함수(promptFor)로 만든다 — 화면에 보이는 것과
  // AI 에 들어가는 것이 다르면 이 기능은 의미가 없다.
  const activePdfId = activeGroupId ? (groupPdfIds[activeGroupId] ?? null) : null;

  // ── 모범 풀이·답안 (교사 제공, 2026-09-02) ──
  // solutions/{pdfId}.json 이 있으면: 문항 분석 프롬프트에 비교 지시를 얹고,
  // 문항 줄에 [풀이·답안] 버튼을 띄운다.
  const [solutionsByPdf, setSolutionsByPdf] = useState<
    Map<number, SolutionsDoc | null>
  >(new Map());
  useEffect(() => {
    const ids = [...new Set(Object.values(groupPdfIds))];
    if (ids.length === 0) return;
    let alive = true;
    void (async () => {
      const m = new Map<number, SolutionsDoc | null>();
      for (const pid of ids) m.set(pid, await loadSolutionsDoc(pid).catch(() => null));
      if (alive) setSolutionsByPdf(m);
    })();
    return () => {
      alive = false;
    };
  }, [groupPdfIds]);
  /** 지금 고른 문항의 모범 풀이 — 그 문항이 실린 교재의 해설에서 찾는다 */
  const selectedSolution: SolutionEntry | null = useMemo(() => {
    if (!selectedProblem) return null;
    const pid = pageAddrInfo.get(selectedProblem.pageKey)?.pdfId;
    if (pid == null) return null;
    return solutionFor(
      solutionsByPdf.get(pid),
      selectedProblem.cluster.meta?.group,
      selectedProblem.cluster.meta?.no,
    );
  }, [selectedProblem, pageAddrInfo, solutionsByPdf]);
  const [solutionOpen, setSolutionOpen] = useState(false);
  const [solutionImg, setSolutionImg] = useState<string | null>(null);
  useEffect(() => {
    // 문항을 고르면 곧바로 해설 이미지를 받아 둔다 — 비교 칸에 바로 보이게
    // (예전엔 다이얼로그를 열 때만 받았다)
    if (!selectedProblem || !selectedSolution?.page) {
      setSolutionImg(null);
      return;
    }
    const pid = pageAddrInfo.get(selectedProblem.pageKey)?.pdfId;
    if (pid == null) return;
    let alive = true;
    void solutionImageUrl(pid, selectedSolution.page)
      .then((u) => {
        if (alive) setSolutionImg(u);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [selectedProblem, selectedSolution, pageAddrInfo]);
  const selectedNo = selectedProblem?.cluster.meta?.no ?? null;
  const promptView = useMemo(() => {
    if (activePdfId == null) return null;
    const set = promptCfg.byPdf[activePdfId];
    return {
      paper: set?.paper?.trim() ?? '',
      forNo: selectedNo != null ? (set?.byNo[selectedNo]?.trim() ?? '') : '',
      /** 실제로 이 문항에 들어가는 지시문 — 토글 OFF 면 빈 문자열이다 */
      applied: promptFor(promptCfg, activePdfId, selectedNo),
      count: Object.values(set?.byNo ?? {}).filter((v) => v.trim()).length,
    };
  }, [promptCfg, activePdfId, selectedNo]);

  /** 본인정보(표지) 페이지 — 어느 쪽이고, 어떻게 그렇게 판단했는가 */
  const infoPageView = useMemo(() => {
    const entry = pages.find((pg) => specialKeys.info.has(pg.key));
    if (!entry) return null;
    const addr = pageAddrInfo.get(entry.key) ?? null;
    const ai = pageKinds[entry.key];
    return {
      label: addr ? `p.${addr.pageIndex}` : (pageLabels[entry.key] ?? '표지'),
      /** AI 판별인가, 교재 설정인가 — 선생님이 근거를 알아야 고칠 수 있다 */
      bySource: ai?.kind === 'info' ? 'AI 판별' : '교재 설정',
      note: ai?.note ?? '',
      hasStrokes: entry.strokes.length > 0,
      key: entry.key,
    };
  }, [pages, specialKeys, pageAddrInfo, pageKinds, pageLabels]);

  /** pdfId → 교재(PDF) 제목. 세트로 묶은 뒤 문서 제목에는 "표지" 가 없으므로,
   *  표지 판별은 **문서가 아니라 교재 제목**으로 해야 한다 (2026-08-25). */
  const paperTitleByPdfId = useMemo(() => {
    const m = new Map<number, string>();
    for (const [gid, pdfId] of Object.entries(groupPdfIds)) {
      const t = groupTitles[gid];
      if (t) m.set(pdfId, t);
    }
    // 교재별 제목이 더 정확하다 — 같은 노트의 두 교재를 갈라 준다
    for (const [pdfIdStr, t] of Object.entries(pdfTitles)) {
      if (t) m.set(Number(pdfIdStr), t);
    }
    return m;
  }, [groupPdfIds, groupTitles, pdfTitles]);

  /** 문항이 속한 교재 제목 (없으면 문서 제목) */
  const paperTitleOfKey = useMemo(
    () => (key: string) =>
      paperTitleByPdfId.get(pageAddrInfo.get(key)?.pdfId ?? -1) ??
      submission?.title ??
      '',
    [paperTitleByPdfId, pageAddrInfo, submission],
  );

  /** 지금 고른 문항의 단원 — 사람이 정리한 시험지 단원표가 AI 추론보다 우선 */
  const selectedUnit = useMemo(() => {
    const c = selectedProblem?.cluster;
    if (!c?.meta?.no) return null;
    const canon = lookupPaperUnitEntry(
      paperTitleOfKey(selectedProblem!.pageKey),
      c.meta.group ?? '',
      c.meta.no,
    );
    const unit = canon?.unit ?? normalizeUnitName(c.meta.unit ?? '');
    const sub = canon?.sub ?? c.meta.subUnit ?? '';
    return unit ? { unit, sub } : null;
  }, [selectedProblem, paperTitleOfKey]);

  /** 지금 보고 있는 페이지가 **정답지**인가 — 문제가 없는 장이라
   *  "맞은 문제 N/30" 처럼 **문항 수를 분모로 쓰지 않는다** (사용자 2026-08-24). */
  const viewingAnswerPage = !!selectedKey && specialKeys.answer.has(selectedKey);

  /** 정답지 기준 문항별 정오 — 정답지 페이지에서 바로 보여준다 */
  const sheetResults = useMemo(() => {
    if (!sheetMerge) return [];
    const byId = new Map<string, ProblemCluster>();
    for (const cs of Object.values(problems)) {
      for (const c of cs ?? []) byId.set(c.id, c);
    }
    const rows = Object.entries(sheetMerge.byId)
      .filter(([, sv]) => sv.sheetAnswer)
      .map(([cid, sv]) => ({
        no: byId.get(cid)?.meta?.no ?? 0,
        label: byId.get(cid)?.label ?? cid,
        sv,
      }))
      .filter((r) => r.no > 0);
    rows.sort((a, b) => a.no - b.no);
    return rows;
  }, [sheetMerge, problems]);

  /** 정답지에 적힌 본인정보가 등록 정보·표지와 어긋나는가 — 어긋날 때만 값이 있다 */
  const sheetIdIssues = useMemo(() => {
    if (!sheetIdInfo) return null;
    const out: string[] = [];
    if (studentInfo) {
      const v = compareIdInfo(sheetIdInfo, studentInfo);
      if (v.nameMatch === false)
        out.push(`이름 — 정답지 "${sheetIdInfo.name}" · 등록 "${studentInfo.name}"`);
      if (v.schoolMatch === false)
        out.push(`학교 — 정답지 "${sheetIdInfo.school}" · 등록 "${studentInfo.school}"`);
      if (v.gradeMatch === false)
        out.push(`학년 — 정답지 "${sheetIdInfo.grade}" · 등록 "${studentInfo.grade}학년"`);
    }
    if (idCheck) {
      const x = crossCheckIdInfo(idCheck, sheetIdInfo);
      if (x.nameMatch === false)
        out.push(`이름 — 표지 "${idCheck.name}" · 정답지 "${sheetIdInfo.name}"`);
      if (x.schoolMatch === false)
        out.push(`학교 — 표지 "${idCheck.school}" · 정답지 "${sheetIdInfo.school}"`);
      if (x.gradeMatch === false)
        out.push(`학년 — 표지 "${idCheck.grade}" · 정답지 "${sheetIdInfo.grade}"`);
    }
    return out.length > 0 ? [...new Set(out)] : null;
  }, [sheetIdInfo, studentInfo, idCheck]);

  /** 지금 **보고 있는 페이지**가 본인정보 페이지인가 —
   *  문제가 없는 페이지라 채점 요약·AI 과정 분석을 띄우지 않는다
   *  (사용자 요구 2026-08-24: 경시대회·노트처럼 정보만 적는 장이 흔하다). */
  const viewingInfoPage = !!selectedKey && specialKeys.info.has(selectedKey);

  /** 표지 이름 대조 결과 — 화면 여러 곳에서 같은 판단을 쓴다 */
  const idVerdict = useMemo(() => {
    if (!idCheck || !studentInfo) return null;
    const cmp = compareIdInfo(idCheck, studentInfo);
    return {
      cmp,
      written: [
        idCheck.name,
        idCheck.school,
        idCheck.grade && `${idCheck.grade}학년`,
      ]
        .filter(Boolean)
        .join(' / '),
      registered: [
        studentInfo.name,
        studentInfo.school,
        studentInfo.grade != null ? `${studentInfo.grade}학년` : '',
      ]
        .filter(Boolean)
        .join(' / '),
    };
  }, [idCheck, studentInfo]);

  /** 이름 불일치 알림 — 화면 **상단 토스트**로 띄운다 (사용자 요구 2026-08-24).
   *  자동으로 사라지면 놓친다 — 닫기를 누를 때까지 남긴다. 제출이 바뀌면 다시 뜬다. */
  const [idToastClosed, setIdToastClosed] = useState(false);
  useEffect(() => {
    setIdToastClosed(false);
  }, [id]);

  // ── 문항별 타임라인 (펜 데이터) → AI 분석 근거 텍스트 ──
  // 공용 빌더(problems-context) — 자동 분석 파이프라인과 같은 문맥을 만든다
  const problemsContextText = useMemo(
    () =>
      buildProblemsContextText({
        strokes: pages.flatMap((p) => p.strokes),
        clusters: Object.values(problems).flat(),
        grades: effectiveGrades,
        selectedClusterId: selectedProblem?.cluster.id ?? null,
      }),
    [pages, problems, selectedProblem, effectiveGrades],
  );

  /** 범위별 OCR 저장 경로 (full 은 sp_feedback 의 기존 필드를 그대로 쓴다) */
  const scopeOcrPath = useCallback(
    (scopeKey: string) =>
      submission && !isFullAnalysisKey(scopeKey)
        ? `${submission.studentId}/${submission.id}.ocr.${scopeKey}.json`
        : null,
    [submission],
  );

  /** 현재 범위의 OCR 생성 — 문항이면 교재 배경+필기 합성으로 지문까지 인식 */
  const generateScopeOcr = useCallback(async (): Promise<string> => {
    try {
      if (selectedProblem && currentPageEntry) {
        const dataUrl = await renderProblemRegionImage({
          page: currentPageEntry,
          bbox: selectedProblem.cluster.bbox,
          strokes: currentPageEntry.strokes,
          includeStrokeIds: selectedProblem.cluster.strokeIds,
          topLimit: selectedProblem.cluster.meta?.numberY,
          maxWidth: 1100,
        });
        if (dataUrl) {
          const { text } = await recognizeImage(
            dataUrl,
            '이 이미지는 시험지의 한 문항입니다. 인쇄된 문제 지문은 손글씨를 읽는 맥락으로만 참고하고, **파란 선(학생이 손으로 쓴 풀이)만** 옮겨 적으세요. 인쇄된 지문·보기·번호는 출력에 포함하지 마세요. 수식·분수·기호는 LaTeX 로 적고 반드시 $...$ 로 감싸세요 (예: $\\frac{3}{4}$, $P(A|B)$).',
          );
          return text.trim();
        }
      }
      const bounds = strokeBounds(currentStrokes);
      if (!bounds || currentStrokes.length === 0) return '';
      const { base64 } = await renderStrokeGroupToPng(currentStrokes, bounds);
      const { text } = await recognizeImage(`data:image/png;base64,${base64}`);
      return text.trim();
    } catch {
      return '';
    }
  }, [selectedProblem, currentPageEntry, currentStrokes]);

  /** 현재 범위 OCR 수동 재인식 (버튼) */
  const runScopeOcr = async () => {
    if (scopeOcrRunning || isFullAnalysisKey(scopeCacheKey)) return;
    setScopeOcrRunning(true);
    try {
      const text = await generateScopeOcr();
      setOcrByScope((m) => ({ ...m, [scopeCacheKey]: text }));
      const path = scopeOcrPath(scopeCacheKey);
      if (path) await uploadJsonObject(path, { text }).catch(() => {});
      toast(
        text ? '이 범위의 필기를 인식했습니다.' : '인식된 텍스트가 없습니다.',
        text ? 'positive' : 'critical',
      );
    } finally {
      setScopeOcrRunning(false);
    }
  };

  /** 범위 OCR 인라인 수정 저장 (blur 시) */
  const saveScopeOcrEdit = (text: string) => {
    const path = scopeOcrPath(scopeCacheKey);
    if (path) void uploadJsonObject(path, { text }).catch(() => {});
  };

  // ── 자동화 1: 진입 시 전 페이지 문항 자동 인식 (캐시 우선) ──
  useEffect(() => {
    if (!submission || pages.length === 0 || !kindsLoaded || autoDetectRef.current)
      return;
    autoDetectRef.current = true;
    void (async () => {
      setAutoDetectRunning(true);
      try {
        for (const page of pages) {
          // 단순노트 교재는 문항 디텍션을 하지 않는다 (내용 안내 분석만)
          if (kindOfGroup(noteGroupId(page)) === '단순노트') continue;
          if ((problems[page.key] ?? []).length > 0) continue;
          try {
            const clusters = await detectProblemsForPage({
              studentId: submission.studentId,
              submissionId: submission.id,
              pageKey: page.key,
              page,
              strokes: page.strokes,
            });
            setProblems((m) => ({ ...m, [page.key]: clusters }));
          } catch {
            /* 페이지 하나 실패해도 다음 페이지 계속 */
          }
        }
      } finally {
        setAutoDetectRunning(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submission, pages]);

  // ── 자동화 2: 전체 OCR — 버튼 누르지 않아도 진입 시 1회 ──
  useEffect(() => {
    if (loading || pages.length === 0 || ocrText || fullOcrAutoRef.current) return;
    if (receivingNow) return; // 수신 중 — 불완전 데이터로 인식하지 않는다
    fullOcrAutoRef.current = true;
    void runOcr();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, pages.length, ocrText, receivingNow]);

  // ── 자동화 3: 범위(문항·페이지) OCR — 선택하면 자동 인식 ──
  useEffect(() => {
    if (!submission || currentStrokes.length === 0) return;
    // 수신 중(불완전 데이터)·자동 파이프라인 중(그쪽이 같은 파일을 쓴다)에는
    // 돌지 않는다 — 끝나면 파이프라인이 만든 캐시를 그대로 읽는다.
    if (receivingNow || autoGradingThis) return;
    const key = scopeCacheKey;
    if (isFullAnalysisKey(key)) return;
    if (ocrByScope[key] !== undefined || scopeOcrAutoRef.current.has(key)) return;
    scopeOcrAutoRef.current.add(key);
    void (async () => {
      setScopeOcrRunning(true);
      try {
        const path = scopeOcrPath(key);
        let text: string | null = null;
        if (path) {
          const saved = await downloadJsonObject<{ text?: string } | null>(path);
          if (saved && typeof saved.text === 'string') text = saved.text;
        }
        // 채점이 이미 이 문항 이미지를 읽었다면 그 결과를 재사용한다 —
        // 같은 문항을 두 번 AI 로 읽지 않는다 (사용자 요구 2026-08-13)
        if (text == null && selectedProblem) {
          const g = grades[selectedProblem.cluster.id];
          if (g && (g.work || g.studentAnswer)) {
            text = [
              g.work ? `[풀이] ${g.work}` : '',
              g.studentAnswer ? `[학생 답] ${g.studentAnswer}` : '',
            ]
              .filter(Boolean)
              .join('\n');
            if (path && text) await uploadJsonObject(path, { text }).catch(() => {});
          }
        }
        if (text == null) {
          text = await generateScopeOcr();
          if (path && text) await uploadJsonObject(path, { text }).catch(() => {});
        }
        setOcrByScope((m) => ({ ...m, [key]: text ?? '' }));
      } finally {
        setScopeOcrRunning(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeCacheKey, submission, currentStrokes.length, ocrByScope, receivingNow, autoGradingThis]);

  // 과목을 바꾸면 전체 범위의 자동 분석도 새 과목으로 다시 시도한다.
  useEffect(() => { analysisAutoRef.current.clear(); }, [docSubject]);

  // ── 자동화 4: AI 분석 — 범위 OCR 이 준비되면 자동 실행 (서버 캐시 우선) ──
  useEffect(() => {
    const key = scopeCacheKey;
    if (!id || currentStrokes.length === 0 || analysisLoading) return;
    // 수신 중·자동 파이프라인 중 — 완전한 필기 기록 위에서만, 중복 호출 없이
    if (receivingNow || autoGradingThis) return;
    if (playback.isPlaying || semanticSheetBusy || sheetBusy || sheetMerge?.pending
      || (grading && !(selectedProblem && grades[selectedProblem.cluster.id]))) return;
    // ⚠️ 예전에 여기서 `aiDone` 이면 건너뛰게 막은 적이 있다 — **잘못이었다.**
    // 사용자가 원한 건 "누르기 전에 이미 되어 있는 것"이지 "안 도는 것"이 아니다
    // (2026-08-25). runAnalysis(false) 는 **서버 캐시를 먼저** 보므로, 파이프라인이
    // 미리 만들어 둔 문항 분석은 AI 호출 없이 즉시 그려진다. 막으면 오히려
    // 선생님이 [분석]을 손으로 눌러야 한다.
    if (isCurrentAssessment(analysisByScope[key]?.assessment, docSubject) || analysisAutoRef.current.has(key)) return;
    const ocrReady = isFullAnalysisKey(key) || ocrByScope[key] !== undefined;
    if (!ocrReady) return;
    analysisAutoRef.current.add(key);
    void runAnalysis(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeCacheKey, docSubject, ocrByScope, analysisByScope, currentStrokes.length, id, analysisLoading, receivingNow, autoGradingThis, playback.isPlaying, semanticSheetBusy, sheetBusy, sheetMerge?.pending, grading, selectedProblem, grades]);

  // ── 문항 영역 수동 편집 ──
  const persistProblems = (next: Record<string, ProblemCluster[]>) => {
    setProblems(next);
    if (submission) {
      void saveProblems(submission.studentId, submission.id, next).catch(() =>
        toast('문항 영역 저장에 실패했습니다.', 'critical'),
      );
    }
  };

  const addRegion = (rect: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }) => {
    const page = currentPageEntry;
    if (!page) return;
    const list = problems[page.key] ?? [];
    const strokeIds = page.strokes
      .filter((st) => {
        const b = strokeBounds([st]);
        if (!b) return false;
        const cx = (b.minX + b.maxX) / 2;
        const cy = (b.minY + b.maxY) / 2;
        return cx >= rect.minX && cx <= rect.maxX && cy >= rect.minY && cy <= rect.maxY;
      })
      .map((st) => st.id);
    const cluster: ProblemCluster = {
      id: `${page.key}#m${Date.now() % 10_000_000}`,
      label: `영역 ${list.length + 1}`,
      strokeIds,
      bbox: rect,
    };
    persistProblems({ ...problems, [page.key]: [...list, cluster] });
    setSelectedRegionId(cluster.id);
    toast(`영역을 추가했습니다 (필기 ${strokeIds.length}획 포함).`, 'positive');
  };

  const deleteRegion = (clusterId: string) => {
    const page = currentPageEntry;
    if (!page) return;
    const list = (problems[page.key] ?? []).filter((c) => c.id !== clusterId);
    persistProblems({ ...problems, [page.key]: list });
    if (selectedRegionId === clusterId) setSelectedRegionId(null);
    if (selectedKey === `prob:${clusterId}`) setSelectedKey(page.key);
  };

  const renameRegion = (clusterId: string, label: string) => {
    const page = currentPageEntry;
    if (!page) return;
    const list = (problems[page.key] ?? []).map((c) =>
      c.id === clusterId ? { ...c, label } : c,
    );
    persistProblems({ ...problems, [page.key]: list });
  };

  /** 현재 페이지의 문항 인식 (캐시 우선, force 로 재인식) */
  const detectProblems = async (force = false) => {
    if (!submission || !currentPageEntry || detecting) return;
    setDetecting(true);
    try {
      const clusters = await detectProblemsForPage({
        studentId: submission.studentId,
        submissionId: submission.id,
        pageKey: currentPageEntry.key,
        page: currentPageEntry,
        strokes: currentPageEntry.strokes,
        force,
      });
      setProblems((m) => ({ ...m, [currentPageEntry.key]: clusters }));
      toast(`문항 ${clusters.length}개를 인식했습니다.`, 'positive');
    } catch (err) {
      toast(
        err instanceof Error ? err.message : '문항 인식에 실패했습니다.',
        'critical',
      );
    } finally {
      setDetecting(false);
    }
  };

  // ---------- 학습분석 리포트 생성 ----------
  const [reportBusy, setReportBusy] = useState(false);
  const makeReport = async (force = false) => {
    if (!submission || !id || reportBusy) return;
    // **이미 만든 리포트가 있으면 다시 만들지 않는다 — 그냥 연다**
    // (사용자 지적 2026-08-19: 수정한 것도 없는데 왜 또 생성하냐).
    // 재생성은 리포트 화면의 [다시 생성](force)으로만.
    if (!force) {
      const existing = await loadLearnReport(submission.studentId, id).catch(
        () => null,
      );
      if (existing) {
        navigate(`/t/submissions/${id}/report`);
        return;
      }
    }
    const allStrokes = pages.flatMap((p) => p.strokes);
    setReportBusy(true);
    reportCancelRef.current = false;
    try {
      // 문항 인식이 아직이면 **끝날 때까지 기다린다** — "먼저 디텍션 필요" 로
      // 튕기면 사용자는 "리포트가 안 만들어진다" 로 느낀다(2026-08-19 실사고:
      // 오늘 새로 푼 문서). 중단은 [취소] 버튼만.
      if (Object.values(problemsRef.current).flat().length === 0) {
        toast('문항 인식이 진행 중입니다 — 끝나는 대로 리포트를 자동 생성합니다. [취소]로 중단할 수 있어요.');
        while (Object.values(problemsRef.current).flat().length === 0) {
          if (reportCancelRef.current) {
            toast('리포트 생성을 취소했습니다.');
            return;
          }
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
      // 🚨 단계 이어받기를 **생성 직전에 직접** 건다 (실사고 2026-09-02:
      // 이어받기 전 라벨로 문서가 만들어져 1단계가 4/4, 계산력이 통째로 빠짐).
      // 화면의 보정 이펙트는 비동기라 [다시 생성] 플래그 직행 경로가 앞지를 수 있다.
      const carried: Record<string, ProblemCluster[]> = { ...problemsRef.current };
      {
        const byPdf = new Map<number, string[]>();
        for (const k of Object.keys(carried)) {
          const pid = pageAddrInfo.get(k)?.pdfId;
          if (pid == null) continue; // 교재를 모르면 물려주지 않는다
          if (!byPdf.has(pid)) byPdf.set(pid, []);
          byPdf.get(pid)!.push(k);
        }
        for (const [, list] of byPdf) {
          list.sort((a, b) => pageNoOfKey(a) - pageNoOfKey(b));
          for (const [k, cs] of carryStages(
            list.map((k) => [k, carried[k] ?? []] as const),
            pageHeadings,
          ))
            carried[k] = cs;
        }
      }
      const allClusters = Object.values(carried).flat();
      // 🚨 **채점이 끝나기 전에 리포트를 만들면 숫자가 전부 어긋난다**
      // (2026-08-18 실사고: 맞은 개수·정답률·정오분석 불일치). 채점 완료를
      // 기다린다 — 사용자에게는 기다리는 중임을 명확히 알린다.
      const numbered = allClusters.filter((c) => c.meta?.no != null);
      // 수신·백그라운드 자동 채점 중이면 아직 "완료" 가 아니다 — 함께 기다린다
      const gradingDone = () =>
        !isReceiving() &&
        !isAutoGrading(id) &&
        !gradingRef.current &&
        numbered.every((c) => gradesRef.current[c.id]);
      // **끝날 때까지 기다린다 — 기한 없음** (사용자 지시 2026-08-18:
      // "계속 기다릴 자신이 있다, 완료될 때까지 만들게 해줘"). 어중간한
      // 데이터로 만드는 것이 최악이다. 중단은 사용자의 [취소] 버튼만.
      if (!gradingDone()) {
        toast('AI 채점이 진행 중입니다 — 끝나는 대로 리포트를 자동 생성합니다. 아래 배너의 [취소]로 중단할 수 있어요.');
      }
      while (!gradingDone()) {
        if (reportCancelRef.current) {
          toast('리포트 생성을 취소했습니다.');
          return;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      const gradeByLabel: Record<string, 'correct' | 'wrong' | 'unknown'> = {};
      for (const c of numbered) {
        const g = effectiveGradesRef.current[c.id] ?? gradesRef.current[c.id];
        if (g && g.verdict !== 'blank') {
          gradeByLabel[g.label] = g.verdict as 'correct' | 'wrong' | 'unknown';
        }
      }
      const t0 = Math.min(...allStrokes.map((st) => st.startedAt));
      const timelines = buildProblemTimelines(allStrokes, allClusters, t0);
      // 과목은 **생성 직전에 새로 읽는다** — 화면의 paperMetaMap 은 마운트 때
      // 값이라, 다른 탭에서 방금 바꾼 과목을 모른 채 수학으로 박을 수 있다.
      const freshMeta = await listMyPaperMeta().catch(() => paperMetaMap);
      const reportSubject = effectiveSubject(
        [...new Set(Object.values(groupPdfIds))]
          .map((pid) => freshMeta.get(pid)?.subject)
          .find((v) => v != null) ?? null,
      );
      // 모범 풀이 비교 — 문항 분석 캐시에서 옮겨 심는다 (파이프라인과 같은 규칙)
      const comparisonById = await loadProblemComparisons(
        submission.studentId,
        id,
        numbered.map((c) => c.id),
        docSubject,
      ).catch(() => ({}));
      // 과목별 블록(국어 5-Depth·수학 내신 행동)도 같은 캐시에서 옮겨 심는다.
      // 이미 문항 분석을 돌린 결과라 LLM 호출이 늘지 않는다.
      const insights =
        reportSubject === '국어' || reportSubject === '수학'
          ? await loadProblemInsights(
              submission.studentId,
              id,
              numbered.map((c) => c.id),
              reportSubject,
            ).catch(() => ({ korean: {}, exam: {} }))
          : { korean: {}, exam: {} };
      await runLearnReport(submission.studentId, {
        gradeByLabel,
        comparisonById,
        koreanById: reportSubject === '국어' ? insights.korean : undefined,
        examById: reportSubject === '수학' ? insights.exam : undefined,
        solutionsAvailable: [...solutionsByPdf.values()].some(Boolean),
        submissionId: id,
        studentName: submission.studentName ?? '학생',
        submissionTitle:
          submission.title ||
          (activeGroupId ? (groupTitles[activeGroupId] ?? '문제지') : '문제지'),
        ocrText: ocrEdited || ocrText || '',
        timelines,
        problemsContext: [
          buildProblemsContextText({
            strokes: allStrokes,
            clusters: allClusters,
            grades: { ...gradesRef.current, ...effectiveGradesRef.current },
            selectedClusterId: null,
          }),
          reportDirective(promptCfg, [...new Set(Object.values(groupPdfIds))]),
        ]
          .filter(Boolean)
          .join('\n\n'),
        // 리포트의 분모는 **교재 전체 문항 수** — 학생이 푼 문항이 아니다
        totalProblems: totalProblemsInPdf || undefined,
        // 과목 — 문서가 걸친 교재 중 과목 지정이 있는 첫 교재의 값 (027)
        subject: reportSubject,
        studentId: submission.studentId,
        // 정오의 정본 = 화면과 같은 채점 결과(정답지 반영)
        verdictById: Object.fromEntries(
          Object.entries(effectiveGradesRef.current).map(([id, g]) => [
            id,
            g.verdict,
          ]),
        ),
        // 내신 리포트 — 배점(문항 인식)·페이지(ncode 매핑)
        pointsByLabel: Object.fromEntries(
          Object.values(problems)
            .flat()
            .filter((c) => c.meta && c.meta.points > 0)
            .map((c) => [c.label, c.meta!.points]),
        ),
        pageByLabel: Object.fromEntries(
          Object.entries(problems)
            .flatMap(([key, cs]) => (cs ?? []).map((c) => [key, c] as const))
            .map(([key, c]) => {
              const page = pageAddrInfo.get(key)?.pageIndex;
              return page != null ? ([c.label, page] as const) : null;
            })
            .filter((v): v is readonly [string, number] => v != null),
        ),
        // 문항 인식이 읽어낸 태그 — 리포트의 정오표·역량·취약 유형에 쓴다
        tagsByLabel: Object.fromEntries(
          Object.entries(problems)
            .flatMap(([key, cs]) => (cs ?? []).map((c) => [key, c] as const))
            .filter(([, c]) => c.meta)
            .map(([key, c]) => [
              c.label,
              {
                paperTitle: paperTitleOfKey(key),
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
      if (reportCancelRef.current) {
        toast('리포트가 저장됐습니다 — [학습분석 리포트]에서 확인하세요.');
        return;
      }
      navigate(`/t/submissions/${id}/report`);
    } catch (e) {
      toast(
        e instanceof Error ? e.message : '리포트 생성에 실패했습니다.',
        'critical',
      );
    } finally {
      setReportBusy(false);
    }
  };

  // 리포트 화면의 [다시 생성] — sessionStorage 플래그를 들고 돌아온다.
  // 데이터(문항·필기·채점)가 준비된 뒤 한 번만 강제 재생성.
  useEffect(() => {
    if (!id || reportBusy) return;
    if (pages.length === 0 || Object.values(problems).flat().length === 0) return;
    if (sessionStorage.getItem(`report-regen:${id}`) !== '1') return;
    // 🚨 **채점이 끝나기 전에 만들면 정오가 비어 다시 AI 판정으로 물러선다** —
    // 리포트가 채점과 갈리던 사고의 재발 경로다(2026-08-25). 번호 있는 문항이
    // 전부 채점될 때까지 기다렸다가 만든다.
    if (grading || semanticSheetBusy || sheetMerge?.pending || sheetBusy) return;
    const numbered = Object.values(problems)
      .flat()
      .filter((c) => c.meta?.no != null);
    if (numbered.length === 0) return;
    if (numbered.some((c) => !effectiveGrades[c.id])) return;
    sessionStorage.removeItem(`report-regen:${id}`);
    void makeReport(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, pages, problems, reportBusy, grading, effectiveGrades, semanticSheetBusy, sheetMerge, sheetBusy]);

  const runAnalysis = async (force = false) => {
    if (!id || analysisLoading || currentStrokes.length === 0) return;
    // 재생 중에는 돌리지 않는다 — 버튼을 흐리게 하는 것만으로는
    // "다시 분석"(analysis 가 이미 있을 때) 경로를 막지 못한다.
    // 채점 중이어도 **선택 문항의 채점이 끝났으면** 허용한다.
    if (playback.isPlaying) return;
    if (semanticSheetBusy || sheetBusy || sheetMerge?.pending || (grading && !(selectedProblem && grades[selectedProblem.cluster.id]))) return;
    const key = scopeCacheKey;
    const scope = scopeInfo
      ? { key: scopeInfo.key, strokeIds: currentStrokes.map((s) => s.id) }
      : undefined;
    setAnalysisLoading(true);
    setAnalysisError(null);
    try {
      // **서버 캐시를 클라이언트가 직접 먼저 읽는다** — 캐시가 있어도 서버리스
      // 왕복(콜드 스타트 포함)이 "또 분석하나?" 로 보였다(2026-08-19).
      // 있으면 API 호출 없이 그대로 쓴다. force(다시 분석)는 그대로 재생성.
      if (!force && submission) {
        const cachePath =
          isFullAnalysisKey(key)
            ? `${submission.studentId}/${submission.id}.analysis.json`
            : `${submission.studentId}/${submission.id}.analysis.${key}.json`;
        const cached = await downloadJsonObject<AnalysisReport | null>(
          cachePath,
        ).catch(() => null);
        if (cached && isCurrentAssessment(cached.assessment, docSubject) && cached.headline) {
          let show = cached;
          let edited = false;
          const editPath0 = editPathFor(key);
          if (editPath0) {
            const ov = await downloadJsonObject<AnalysisReport | null>(
              editPath0,
            ).catch(() => null);
            if (ov && isCurrentAssessment(ov.assessment, docSubject) && ov.headline) {
              show = ov;
              edited = true;
            }
          }
          setAnalysisByScope((m) => ({ ...m, [key]: show }));
          setEditedByScope((m) => ({ ...m, [key]: edited }));
          return;
        }
      }
      // 범위 전용 OCR(문항 지문+풀이)을 분석 근거로 전달 — 정답 판정·오류 검출
      const scopeOcrText =
        isFullAnalysisKey(key)
          ? ocrEdited || ocrText || undefined
          : ocrByScope[key] || undefined;
      // 단순노트: 문항·정답 분석 대신 "적힌 내용 안내" 지시를 컨텍스트에 얹는다
      const noteDirective = isNoteGroup
        ? '[주의] 이 종이는 문제지가 아니라 "단순 노트"입니다. 문항·정답 판정 대신 ' +
          '이 노트에 적힌 것들이 무엇인지(주제·정리한 개념·핵심 내용)를 선생님에게 ' +
          '안내하는 리포트를 작성하세요. solution.verdict 는 unknown 으로 두세요.'
        : '';
      // 학원 분석 기준 — 문항이면 그 문항, 아니면 관련 교재 전체 기준
      const academyDirective = (() => {
        if (!promptCfg.enabled) return '';
        if (selectedProblem) {
          const pg = pages.find((x) => x.key === selectedProblem.pageKey);
          const pdfId = pg ? groupPdfIds[noteGroupId(pg)] : undefined;
          return analysisDirective(
            promptCfg,
            pdfId ?? null,
            selectedProblem.cluster.meta?.no ?? null,
          );
        }
        const ids = [...new Set(Object.values(groupPdfIds))];
        return ids
          .map((pid) => analysisDirective(promptCfg, pid, null))
          .filter(Boolean)
          .join('\n');
      })();
      // 모범 풀이가 있는 문항이면 비교 지시를 얹는다 (auto-grade 와 같은 규칙)
      const modelDirective =
        !isFullAnalysisKey(key) && selectedProblem ? solutionDirective(selectedSolution) : '';
      // 과목 지시문 (026) — 수학이 아니면 "근거를 찾는 과정" 을 본다.
      // 수학이면 빈 문자열이라 기존 동작 그대로다.
      const subjectDir = subjectAnalysisDirective(docSubject);
      // 지시문을 앞에 두고 문항 컨텍스트를 뒤에 — 서버 컷에 지시문이 잘리지 않게
      const contextForAI = [
        subjectDir,
        modelDirective,
        academyDirective,
        noteDirective,
        problemsContextText,
      ]
        .filter(Boolean)
        .join('\n\n');
      const { report } = await analyzeWriting(
        id,
        force,
        scope,
        scopeOcrText,
        contextForAI || undefined,
        docSubject,
      );
      if (!isCurrentAssessment(report.assessment, docSubject)) {
        throw new Error('분석 과목이 일치하지 않습니다. 다시 분석해 주세요.');
      }
      let show = report;
      let edited = false;
      const editPath = editPathFor(key);
      if (force) {
        // 다시 분석 = 원본 재생성 — 이 범위의 수정본은 폐기한다
        if (editPath) await uploadJsonObject(editPath, null).catch(() => {});
      } else if (editPath) {
        // 저장된 수정본이 있으면 수정본을 보여준다
        const ov = await downloadJsonObject<AnalysisReport | null>(editPath).catch(
          () => null,
        );
        if (ov && isCurrentAssessment(ov.assessment, docSubject) && ov.headline) {
          show = ov;
          edited = true;
        }
      }
      setAnalysisByScope((m) => ({ ...m, [key]: show }));
      setEditedByScope((m) => ({ ...m, [key]: edited }));
    } catch (err) {
      setAnalysisError(
        err instanceof Error ? err.message : '분석에 실패했습니다.',
      );
    } finally {
      setAnalysisLoading(false);
    }
  };

  /** 인라인 수정 커밋 — 화면 즉시 반영 + 범위별 수정본 자동 저장 */
  const commitInline = (mutate: (r: AnalysisReport) => void) => {
    if (!analysis) return;
    const key = scopeCacheKey;
    const next = JSON.parse(JSON.stringify(analysis)) as AnalysisReport;
    mutate(next);
    setAnalysisByScope((m) => ({ ...m, [key]: next }));
    setEditedByScope((m) => ({ ...m, [key]: true }));
    const editPath = editPathFor(key);
    if (editPath) {
      void uploadJsonObject(editPath, next).catch(() =>
        toast('수정 내용 저장에 실패했습니다.', 'critical'),
      );
    }
  };

  const revertAnalysis = async () => {
    if (analysisLoading) return;
    const editPath = editPathFor(scopeCacheKey);
    if (editPath) await uploadJsonObject(editPath, null).catch(() => {});
    setEditedByScope((m) => ({ ...m, [scopeCacheKey]: false }));
    await runAnalysis(false); // 캐시된 원본 복원
    toast('AI 분석 원본으로 되돌렸습니다.', 'positive');
  };

  const runOcr = async () => {
    if (!id || ocrRunning || currentStrokes.length === 0) return;
    setOcrRunning(true);
    setOcrError(null);
    try {
      // 전체 모드면 페이지별로 각각 인식해 합친다 (페이지가 겹쳐 렌더되는 것 방지)
      const targets: Stroke[][] = isAllMode
        ? (groups
            .find((g) => `all:${g.id}` === selectedKey)
            ?.pages.map((p) => p.strokes) ?? [])
        : [currentStrokes];
      const parts: string[] = [];
      for (const strokes of targets) {
        const bounds = strokeBounds(strokes);
        if (!bounds || strokes.length === 0) continue;
        const { base64 } = await renderStrokeGroupToPng(strokes, bounds);
        const { text } = await recognizeImage(`data:image/png;base64,${base64}`);
        if (text.trim()) parts.push(text.trim());
      }
      if (parts.length === 0) {
        setOcrError('인식할 필기가 없습니다.');
        return;
      }
      const text = parts.join('\n\n');
      setOcrText(text);
      setOcrEdited(text); // 원문을 교정본에 바로 채워 그 자리에서 수정
      // 인식 결과는 바로 저장해 둔다 (실패해도 화면에는 남음)
      try {
        await upsertFeedback(id, { ocrText: text });
      } catch {
        /* 저장 실패는 아래 '저장' 버튼으로 재시도 가능 */
      }
      toast('필기 인식이 완료되었습니다.', 'positive');
    } catch (err) {
      setOcrError(
        err instanceof Error
          ? err.message
          : '필기 인식 중 오류가 발생했습니다.',
      );
    } finally {
      setOcrRunning(false);
    }
  };

  const makeDraft = async () => {
    if (!id || draftLoading) return;
    setDraftLoading(true);
    try {
      const { draft } = await generateFeedbackDraft(id, {
        analysis,
        ocrText: ocrEdited || ocrText || null,
      });
      setBody(draft);
      toast('AI 초안을 생성했습니다. 확인 후 다듬어 저장하세요.', 'positive');
    } catch (err) {
      toast(
        err instanceof Error ? err.message : 'AI 초안 생성에 실패했습니다.',
        'critical',
      );
    } finally {
      setDraftLoading(false);
    }
  };

  const save = async () => {
    if (!id || saving) return;
    setSaving(true);
    try {
      await upsertFeedback(id, {
        body,
        ocrText: ocrText || null,
        ocrEdited: ocrEdited || null,
      });
      toast('피드백을 저장했습니다.', 'positive');
    } catch (err) {
      toast(
        err instanceof Error ? err.message : '저장에 실패했습니다.',
        'critical',
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleVisible = async (next: boolean) => {
    if (!id || !submission || visibleUpdating) return;
    setVisibleUpdating(true);
    const prev = submission.feedbackVisible;
    setSubmission({ ...submission, feedbackVisible: next });
    try {
      await updateSubmission(id, { feedbackVisible: next });
      // 새로 공개하는 순간(비공개→공개)에만 학생에게 알림을 보낸다.
      if (next && !prev) {
        try {
          await notifyFeedbackPublished({ id });
        } catch {
          /* 알림 실패는 공개 자체를 막지 않는다 */
        }
      }
      toast(
        next ? '피드백을 공개했어요. 학생에게 알림이 갑니다.' : '피드백을 비공개로 전환했습니다.',
        'positive',
      );
    } catch (err) {
      setSubmission((s) => (s ? { ...s, feedbackVisible: prev } : s));
      toast(
        err instanceof Error ? err.message : '공개 설정 변경에 실패했습니다.',
        'critical',
      );
    } finally {
      setVisibleUpdating(false);
    }
  };

  const setStatus = async (status: SubmissionRow['status']) => {
    if (!id || !submission || statusUpdating) return;
    setStatusUpdating(true);
    try {
      await updateSubmission(id, { status });
      setSubmission({ ...submission, status });
      toast(
        status === 'reviewed'
          ? '검토 완료로 처리했습니다.'
          : '제출됨 상태로 되돌렸습니다.',
        'positive',
      );
    } catch (err) {
      toast(
        err instanceof Error ? err.message : '상태 변경에 실패했습니다.',
        'critical',
      );
    } finally {
      setStatusUpdating(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-8 w-72 rounded-lg" />
        <div className="grid gap-5 xl:grid-cols-5">
          <Skeleton className="h-[480px] rounded-xl xl:col-span-3" />
          <div className="space-y-5 xl:col-span-2">
            <Skeleton className="h-56 rounded-xl" />
            <Skeleton className="h-56 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !submission) {
    return (
      <div className="max-w-2xl space-y-3">
        <Callout
          tone="warning"
          title="제출을 열 수 없습니다"
          description={error ?? '제출 정보를 불러오지 못했습니다.'}
        />
        <ActionButton
          variant="neutralWeak"
          size="small"
          onClick={() => navigate('/t/students')}
        >
          학생 관리로 돌아가기
        </ActionButton>
      </div>
    );
  }

  /**
   * 분석은 **모든 상태가 끝난 뒤에만** 돌린다(사용자 요구 2026-08-17).
   * 재생 중이면 화면의 필기가 중간까지만 그려져 있어 "아직 안 풀었다"는
   * 잘못된 분석이 나오고, 채점이 도는 중이면 정오 판정 정본이 아직 없어
   * AI 가 제멋대로 답을 추론한다. 둘 다 끝난 뒤로 미룬다.
   */
  // 이 문항의 채점이 이미 끝났으면 다른 문항이 채점 중이어도 잠그지 않는다 —
  // 전역 플래그로 전부 잠그면 문제지가 클수록 "계속 채점 중" 으로 보인다
  // (2026-08-17 사용자 신고: 오전엔 빨랐는데 계속 채점 중이라고만 나온다).
  const selectedGraded =
    !!selectedProblem && !!grades[selectedProblem.cluster.id];
  const analysisBlockReason = playback.isPlaying
    ? '재생 중에는 분석하지 않습니다. 필기 재생을 멈춘 뒤 분석해 주세요 — 중간까지만 그려진 상태로 분석하면 결과가 어긋납니다.'
    : selectedProblem
      ? selectedGraded
        ? null
        : grading
          ? '이 문항을 채점하는 중입니다. 곧 끝나요 — 끝나면 그 결과를 바탕으로 분석합니다.'
          : '이 문항의 채점 결과를 기다리는 중입니다. 채점이 끝나면 분석할 수 있어요.'
      : grading
        ? '채점을 마치는 중입니다. 문제지 전체 채점이 끝나면 그 결과를 바탕으로 분석합니다.'
        : null;

  /** 문제 번호 없는 획 영역 — 문제가 아니므로 AI 분석 대상이 아니다 (2026-08-18) */
  const isPlainRegion =
    !!selectedProblem && selectedProblem.cluster.meta?.no == null;

  // 본인정보·정답지 페이지에는 분석할 풀이가 없다 — 패널 자체를 띄우지 않는다
  // (사용자 요구 2026-08-24: "정답지도 동일하게 AI 분석은 필요 없어 — 정답을
  // 맞았냐 틀렸냐만 보면 된다"). 형광펜 하이라이트도 함께 사라진다.
  const analysisNode =
    viewingInfoPage || viewingAnswerPage ? null : isPlainRegion ? (
    <section
      data-testid="analysis-panel"
      className="rounded-xl border border-line-weak bg-layer-default p-5"
    >
      <h3 className="text-base font-bold text-ink">감지된 필기 영역</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
        문제 번호가 없는 영역이라 AI 과정 분석·채점은 하지 않습니다. 필기
        재생과 인식만 제공됩니다. 실제 문제라면 [영역 편집]에서 번호를 지정해
        주세요.
      </p>
    </section>
  ) : (
    <AnalysisPanel
      analysis={analysis}
      // 문항 범위일 때만: 모범 풀이가 있으면 비교, 없으면 "PDF 없음" 안내
      modelSolutionState={
        selectedProblem ? (selectedSolution ? 'available' : 'missing') : null
      }
      // 선생님 손풀이 — 비교 블록 오른쪽 칸 (전사 수식 + 잘라낸 원본, 크게 보기는 다이얼로그)
      modelSolution={
        selectedProblem && selectedSolution
          ? {
              answer: selectedSolution.answer,
              solution: selectedSolution.solution ?? null,
              imageSrc: solutionImg,
              page: selectedSolution.page ?? null,
              box: selectedSolution.box ?? null,
              onEnlarge: () => setSolutionOpen(true),
            }
          : null
      }
      loading={analysisLoading}
      error={analysisError}
      edited={!!editedByScope[scopeCacheKey]}
      scopeLabel={`범위: ${scopeInfo?.label ?? '전체 제출'}`}
      canRun={currentStrokes.length > 0 && !analysisBlockReason}
      blockReason={analysisBlockReason}
      onRun={(f) => void runAnalysis(f)}
      onRevert={() => void revertAnalysis()}
      commit={commitInline}
      jumpTo={jumpToStage}
      delays={delaySpans}
      onPlayDelay={playDelay}
      // 정오 판정의 정본은 채점 결과 — AI 가 뒤집지 못하게 넘긴다
      grade={selectedProblem ? (effectiveGrades[selectedProblem.cluster.id] ?? null) : null}
      compact={!!selectedProblem}
    />
  );

  const sidePlaceholder = (side: '왼쪽' | '오른쪽') => (
    <div className="flex h-full min-h-40 items-center justify-center rounded-xl border border-dashed border-line-weak p-4 text-center text-xs leading-relaxed text-ink-subtle">
      {selectedProblem
        ? `선택한 문항은 ${side === '왼쪽' ? '오른쪽' : '왼쪽'} 단이라 반대편에 분석이 표시됩니다`
        : `${side} 단 문항을 선택하면 이 자리에 AI 분석이 표시됩니다`}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          aria-label="필기 기록으로 돌아가기"
          onClick={backToNotes}
          className="rounded-lg p-2 text-ink-muted hover:bg-neutral-weak hover:text-ink"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-bold text-ink">
            {submission.title || '제목 없는 제출'}
          </h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            {submission.studentName ?? '학생'} ·{' '}
            {formatDateTime(submission.createdAt)}
            {submission.noteLabel && ` · ${submission.noteLabel}`}
          </p>
        </div>
        <SubmissionStatusBadge status={submission.status} />
        {!isNoteGroup && (
          <ActionButton
            variant="neutralWeak"
            size="small"
            loading={reportBusy}
            onClick={() => void makeReport()}
          >
            학습분석 리포트
          </ActionButton>
        )}
        {submission.status === 'submitted' ? (
          <ActionButton
            variant="brandSolid"
            size="small"
            loading={statusUpdating}
            onClick={() => void setStatus('reviewed')}
          >
            검토 완료 처리
          </ActionButton>
        ) : (
          <ActionButton
            variant="ghost"
            size="small"
            loading={statusUpdating}
            onClick={() => void setStatus('submitted')}
          >
            제출됨으로 되돌리기
          </ActionButton>
        )}
      </div>

      {/* 선택 바 — 교재(PDF) → 페이지(번호 오름차순) → 문항(번호 오름차순) */}
      <div className="space-y-2.5 rounded-xl border border-line-weak bg-layer-default px-4 py-3">
        {groups.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-12 shrink-0 text-xs font-semibold text-ink-muted">
              교재
            </span>
            <RadioChipRoot
              aria-label="교재(PDF) 선택"
              className="flex flex-wrap items-center gap-2"
              value={activeGroupId ?? ''}
              onValueChange={(v) => v && setSelectedKey(`all:${v}`)}
            >
              {groups.map((g) => (
                <RadioChipItem key={g.id} value={g.id}>
                  <ChipLabel>{groupTitles[g.id] ?? '교재 확인 중…'}</ChipLabel>
                </RadioChipItem>
              ))}
            </RadioChipRoot>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="w-12 shrink-0 text-xs font-semibold text-ink-muted">
            페이지
          </span>
          <RadioChipRoot
            aria-label="페이지 선택"
            className="flex flex-wrap items-center gap-2"
            value={selectedProblem ? selectedProblem.pageKey : (selectedKey ?? '')}
            onValueChange={(v) => v && setSelectedKey(v)}
          >
            {activeGroup && (
              <RadioChipItem value={`all:${activeGroup.id}`}>
                <ChipLabel>전체</ChipLabel>
              </RadioChipItem>
            )}
            {(() => {
              // 교재 전체 페이지 목록이 있으면 필기 없는 페이지도 전부 칩으로 —
              // 필기 있는 페이지는 ✎, 없는 페이지는 흐리게. 없으면 기존(필기 페이지만).
              // 🔑 **문서에 교재가 여럿이면(합친 시험지) 전부 이어서** 보여준다.
              const all = allPagesOrdered.map((x) => ({ ...x.ip, pageIndex: x.no }));
              const written = new Set(pages.map((p) => p.key));
              if (all && all.length > 0) {
                return all.map((ip) => (
                  <RadioChipItem
                    key={ip.key}
                    value={written.has(ip.key) ? ip.key : `empty:${ip.key}`}
                  >
                    <ChipLabel>
                      {written.has(ip.key) ? (
                        <>
                          p.{ip.pageIndex} ✎
                          {problemRangeOfPage[ip.key] && (
                            <span className="ml-1 font-normal text-ink-subtle">
                              {problemRangeOfPage[ip.key]}
                            </span>
                          )}
                          {specialKeys.answer.has(ip.key) && (
                            <span className="ml-0.5 font-bold text-brand"> 정답지</span>
                          )}
                        </>
                      ) : (
                        <span className="opacity-50">
                          p.{ip.pageIndex}
                          {specialKeys.answer.has(ip.key) && ' 정답지'}
                        </span>
                      )}
                    </ChipLabel>
                  </RadioChipItem>
                ));
              }
              return (activeGroup?.pages ?? []).map((pg) => (
                <RadioChipItem key={pg.key} value={pg.key}>
                  <ChipLabel>{pageLabels[pg.key] ?? pg.label}</ChipLabel>
                </RadioChipItem>
              ));
            })()}
          </RadioChipRoot>
          {allPagesOrdered.length > 0 && (
            <span className="text-[11px] text-ink-subtle">
              총 {allPagesOrdered.length}페이지 · 필기{' '}
              {
                allPagesOrdered.filter((x) =>
                  pages.some((p) => p.key === x.ip.key),
                ).length
              }
              페이지 (✎)
            </span>
          )}
        </div>

        {currentPageEntry && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-12 shrink-0 text-xs font-semibold text-ink-muted">
              문항
            </span>
            {sortedClusters.length > 0 ? (
              <>
                <RadioChipRoot
                  aria-label="문항 선택"
                  className="flex flex-wrap items-center gap-2"
                  value={selectedKey ?? ''}
                  onValueChange={(v) => v && setSelectedKey(v)}
                >
                  <RadioChipItem value={currentPageEntry.key}>
                    <ChipLabel>페이지 전체</ChipLabel>
                  </RadioChipItem>
                  {sortedClusters.map((c) => {
                    // 정답이 아니면 틀림으로 보여준다(판정 불가를 남기지 않는다)
                    const g0 = effectiveGrades[c.id];
                    const v = g0 ? finalVerdict(g0.verdict) : undefined;
                    // 아직 결과 없는 번호 문항 + 채점이 돌고 있음 = 이 문항이
                    // 로딩 중 — 번호 옆에 스피너를 붙여 "지금 채점 중" 을
                    // 문항 단위로 보여준다 (사용자 요청 2026-08-19)
                    const pendingGrade =
                      c.meta?.no != null &&
                      !grades[c.id] &&
                      (grading || autoGradingThis || receivingNow);
                    // 이 문항의 AI 과정 분석이 **지금** 돌고 있는가 — 파이프라인
                    // (백그라운드) 또는 이 화면의 분석. 완료는 표시하지 않는다
                    // (사용자 요구 2026-08-19: 하고 있는 것만).
                    const analyzingNow =
                      (id ? getAnalyzingProblem(id) : null) === c.id ||
                      (analysisLoading &&
                        selectedProblem?.cluster.id === c.id);
                    return (
                      <RadioChipItem key={c.id} value={`prob:${c.id}`}>
                        <ChipLabel>
                          {c.label}
                          {v === 'correct' && (
                            <span className="ml-1 font-bold text-[#1a7f37]">○</span>
                          )}
                          {v === 'wrong' && (
                            <span className="ml-1 font-bold text-[#c1121f]">✗</span>
                          )}
                          {pendingGrade && (
                            <span
                              title="채점 중"
                              aria-label={`${c.label} 채점 중`}
                              className="ml-1 inline-block size-3 animate-spin rounded-full border-[1.5px] border-line-brand border-t-transparent align-[-1px]"
                            />
                          )}
                          {analyzingNow && (
                            <span
                              title="AI 과정 분석 중"
                              aria-label={`${c.label} 분석 중`}
                              className="ml-1 inline-flex items-center gap-0.5 align-[-1px] text-[9px] font-semibold text-brand"
                            >
                              <span className="inline-block size-2 animate-spin rounded-full border border-line-brand border-t-transparent" />
                              분석
                            </span>
                          )}
                          {c.strokeIds.length === 0 ? ' (풀이 없음)' : ''}
                        </ChipLabel>
                      </RadioChipItem>
                    );
                  })}
                </RadioChipRoot>
                <ActionButton
                  variant="neutralWeak"
                  size="xsmall"
                  loading={detecting}
                  onClick={() => void detectProblems(true)}
                >
                  다시 인식
                </ActionButton>
              </>
            ) : autoDetectRunning || detecting ? (
              <span className="text-xs text-ink-subtle">
                문항을 자동 인식하고 있어요…
              </span>
            ) : (
              <ActionButton
                variant="neutralOutline"
                size="xsmall"
                loading={detecting}
                onClick={() => void detectProblems()}
              >
                <span className="inline-flex items-center gap-1">
                  <Sparkles size={13} /> AI 문항 인식
                </span>
              </ActionButton>
            )}
            <ActionButton
              variant={regionEditing ? 'brandSolid' : 'neutralWeak'}
              size="xsmall"
              onClick={() => {
                setRegionEditing((v) => !v);
                setSelectedRegionId(null);
              }}
            >
              <span className="inline-flex items-center gap-1">
                <BoxSelect size={13} /> {regionEditing ? '편집 완료' : '영역 편집'}
              </span>
            </ActionButton>
          </div>
        )}

        {/* 지금 무엇을 보고 있는지 — 선택 표시 */}
        <div className="flex flex-wrap items-center gap-2 border-t border-line-weak pt-2 text-xs">
          <span
            data-testid="viewing-badge"
            className="rounded bg-brand-solid px-2 py-0.5 font-bold text-white"
          >
            보는 중
          </span>
          <span className="font-semibold text-ink">{viewingLabel}</span>
          <span
            data-testid="doc-subject"
            className="rounded border border-line-solid px-1.5 py-0.5 font-semibold text-ink"
          >
            {docSubject}
          </span>

          {autoDetectRunning && (
            <span className="text-ink-subtle">· 문항 자동 인식 중…</span>
          )}
          {grading && <span className="text-ink-subtle">· 채점 중…</span>}
        </div>

        {/* 고른 문항의 **문항 번호와 단원** — 문항을 고르면 반드시 보인다
            (사용자 요구 2026-08-25). 단원을 못 찾으면 그 사실을 말해 준다:
            빈칸으로 두면 "단원이 없는 문제" 로 오해한다. */}
        {selectedProblem?.cluster.meta?.no != null && (
          <div
            data-testid="problem-unit-line"
            className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line-weak pt-2 text-xs"
          >
            <span className="text-ink-subtle">문항</span>
            <span className="font-bold text-ink">
              {selectedProblem.cluster.label}
            </span>
            <span aria-hidden className="text-ink-subtle">
              ·
            </span>
            <span className="text-ink-subtle">단원</span>
            {selectedUnit ? (
              <span className="rounded bg-[#e9f2ff] px-1.5 py-0.5 text-[11px] font-semibold text-[#1c5fb8]">
                {selectedUnit.unit}
                {selectedUnit.sub && (
                  <span className="font-normal"> · {selectedUnit.sub}</span>
                )}
              </span>
            ) : (
              <span className="text-ink-subtle">
                미확인 — 이 교재를 [다시 인식]하면 채워집니다
              </span>
            )}
            {/* [풀이·답안 보기] 버튼은 뺐다 (사용자 2026-09-03) — 모범 풀이는
                문항 분석의 '모범 풀이 비교' 오른쪽 칸에 바로 보인다. */}
          </div>
        )}

        {/* AI 프롬프트 — 지금 적용 중인 지시문을 보여주고 여기서 바로 고친다 */}
        {activePdfId != null && promptView && (
          <div className="border-t border-line-weak pt-2 text-xs">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-bold text-ink">AI 프롬프트</span>
              <span className="text-ink-subtle">
                교재 전체 {promptView.paper ? '설정됨' : '없음'} · 문항별{' '}
                {promptView.count}개
              </span>
              {!promptCfg.enabled && (
                <span className="rounded bg-neutral-weak px-1.5 py-0.5 text-[11px] font-semibold text-ink-muted">
                  학원 설정 OFF — 저장돼 있어도 지금은 공통 프롬프트로 동작합니다
                </span>
              )}
              <button
                type="button"
                data-testid="open-paper-prompt"
                className="ml-auto text-xs text-ink-subtle underline hover:text-ink"
                onClick={() =>
                  setPromptDlg({
                    pdf: {
                      id: activePdfId,
                      title: activeGroupId
                        ? (groupTitles[activeGroupId] ?? null)
                        : null,
                    },
                    focusNo: selectedNo,
                  })
                }
              >
                {selectedNo != null
                  ? `${selectedNo}번 프롬프트 보기·수정`
                  : '교재·문항별 프롬프트 보기·수정'}
              </button>
            </div>
            {(promptView.paper || selectedNo != null) && (
              <div className="mt-1.5 space-y-1">
                {promptView.paper && (
                  <p className="whitespace-pre-wrap rounded-lg bg-layer-fill px-2.5 py-1.5 leading-relaxed text-ink-muted">
                    <b className="text-ink">교재 전체</b> — {promptView.paper}
                  </p>
                )}
                {selectedNo != null && (
                  <p className="whitespace-pre-wrap rounded-lg bg-layer-fill px-2.5 py-1.5 leading-relaxed text-ink-muted">
                    <b className="text-ink">{selectedNo}번</b>{' '}
                    {promptView.forNo ? (
                      <>— {promptView.forNo}</>
                    ) : (
                      <span className="text-ink-subtle">
                        — 이 문항 전용 지시문 없음 (교재 전체 지시문만 적용)
                      </span>
                    )}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* 채점 결과 — 100점 만점 환산 점수·정오 개수.
            본인정보 페이지를 보는 중이면 채점 개념이 없는 장이라 띄우지 않는다. */}
        {scoreSummary && !viewingInfoPage && !viewingAnswerPage && (
          <div
            data-testid="score-summary"
            className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line-weak pt-2.5"
          >
            {/* 점수(100점 환산) 대신 **맞은 개수**만 보여준다 —
                배점을 우리가 알 수 없어 환산 점수는 근거가 약했다.
                분모는 **교재(PDF) 전체 문항 수**다(사용자 요구 2026-08-17). */}
            <span className="text-sm font-bold text-ink">
              맞은 문제{' '}
              <span className="text-[19px] text-brand tabular-nums">
                {scoreSummary.correct}
              </span>
              <span className="text-ink-subtle">
                {' / '}
                {pdfCountReady ? `${totalProblems}개` : '… (문제지 확인 중)'}
              </span>
            </span>
            <span className="text-xs text-ink-muted">
              틀림 <b className="text-[#c1121f]">{scoreSummary.wrong}</b>
              {/* 안 푼 문제 = **문제지 전체** − 맞음 − 틀림.
                  이 제출에서 인식한 문항만 세면 실제보다 훨씬 작게 나온다. */}
              {pdfCountReady && (
                <> · 안 푼 문제 {Math.max(0, totalProblems - scoreSummary.correct - scoreSummary.wrong)}</>
              )}
            </span>
            {grading && (
              <span className="text-xs text-ink-subtle">채점 진행 중…</span>
            )}
            {sheetBusy && (
              <span className="inline-flex items-center gap-1 text-xs text-brand">
                <span className="inline-block size-3 animate-spin rounded-full border-[1.5px] border-line-brand border-t-transparent" />
                정답지 인식 중…
              </span>
            )}
            {sheetMerge && (
              <span className="text-xs font-semibold text-brand">
                정답지 기준 채점 · 정답지 {sheetMerge.sheetCount}칸
                {pdfCountReady && ` / 문항 ${totalProblems}개`}
                {pdfCountReady &&
                  sheetMerge.sheetCount !== totalProblems &&
                  ' ⚠ 개수 불일치'}
              </span>
            )}
          </div>
        )}
        {/* 정답지 옮겨적기 오류 — 반드시 표시 (사용자 요구 2026-08-22) */}
        {!viewingInfoPage &&
          !viewingAnswerPage &&
          sheetMerge &&
          (() => {
            const issues = Object.entries(sheetMerge.byId).filter(
              ([, sv]) => sv.transcriptionError,
            );
            if (issues.length === 0) return null;
            const labelOf = (cid: string) => {
              for (const cs of Object.values(problems)) {
                const c = (cs ?? []).find((x) => x.id === cid);
                if (c) return c.label;
              }
              return cid;
            };
            return (
              <div className="mt-2 rounded-lg border border-[#f0c9a4] bg-[#fff8ef] px-3 py-2 text-xs leading-relaxed text-[#8a5a1c]">
                <b>정답지 옮겨적기 확인 필요:</b>{' '}
                {issues.map(([cid, sv], i) => (
                  <span key={cid}>
                    {i > 0 && ' · '}
                    <b>{labelOf(cid)}</b> 본문 답과 정답지 답이 다름
                    {sv.correctBodyButSheetWrong &&
                      ' (본문은 정답이나 정답지 오답 → 오답 처리)'}
                  </span>
                ))}
              </div>
            );
          })()}
        {/* 정답지 페이지 — 문제가 없는 장이라 **문항 수를 분모로 쓰지 않는다.**
            대신 정답지에 적은 답으로 매긴 문항별 정오를 그대로 보여준다
            (사용자 요구 2026-08-24: 정답지가 그 학생의 실제 정오다). */}
        {viewingAnswerPage && (
          <div
            data-testid="answer-page-notice"
            className="mt-2 rounded-lg border border-line-weak bg-layer-fill px-3 py-2.5 text-xs leading-relaxed"
          >
            <p className="text-sm font-bold text-ink">정답지 페이지</p>
            <p className="mt-0.5 text-ink-muted">
              이 페이지는 답만 옮겨 적는 장입니다. 여기 적힌 답을{' '}
              <b className="text-ink">채점의 기준</b>으로 삼습니다 — 본문에 답이
              없어도 정답지에 적혀 있으면 그것으로 정오를 매깁니다.
            </p>
            {sheetBusy ? (
              <p className="mt-1.5 inline-flex items-center gap-1 text-brand">
                <span className="inline-block size-3 animate-spin rounded-full border-[1.5px] border-line-brand border-t-transparent" />
                정답지 인식 중…
              </p>
            ) : sheetResults.length === 0 ? (
              <p className="mt-1.5 text-ink-subtle">
                아직 정답지에서 읽어낸 답이 없습니다.
              </p>
            ) : (
              <>
                <p className="mt-2 font-bold text-ink">
                  정답지 기준 채점 — 맞음{' '}
                  <span className="text-[#1a7f37]">
                    {sheetResults.filter((r) => r.sv.verdict === 'correct').length}
                  </span>{' '}
                  · 틀림{' '}
                  <span className="text-[#c1121f]">
                    {sheetResults.filter((r) => r.sv.verdict === 'wrong').length}
                  </span>
                  {sheetResults.some(
                    (r) => r.sv.verdict !== 'correct' && r.sv.verdict !== 'wrong',
                  ) && (
                    <span className="font-normal text-ink-subtle">
                      {' '}
                      · 판정 불가{' '}
                      {
                        sheetResults.filter(
                          (r) =>
                            r.sv.verdict !== 'correct' && r.sv.verdict !== 'wrong',
                        ).length
                      }
                    </span>
                  )}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {sheetResults.map((r) => (
                    <span
                      key={r.no}
                      data-testid={`sheet-verdict-${r.no}`}
                      title={
                        r.sv.verdict === 'unknown' || r.sv.verdict === 'blank'
                          ? '이 문제의 정답을 구하지 못해 판정하지 못했습니다'
                          : `적은 답 ${r.sv.sheetAnswer}${
                              r.sv.transcriptionError
                                ? ' · 본문 답과 다르게 옮겨 적음'
                                : ''
                            }`
                      }
                      className={
                        'inline-flex items-center gap-1.5 rounded-lg border-2 px-2 py-1 ' +
                        (r.sv.verdict === 'correct'
                          ? 'border-[#1a7f37] bg-[#f0fdf4] text-[#1a7f37]'
                          : r.sv.verdict === 'wrong'
                            ? 'border-[#c1121f] bg-[#fff1f2] text-[#c1121f]'
                            : 'border-line-weak bg-layer-default text-ink-subtle')
                      }
                    >
                      {/* 정오는 **번호에 붙여** 보여준다 (사용자 요구 2026-08-24) */}
                      <b className="text-[13px]">{r.no}번</b>
                      <b className="text-[15px] leading-none">
                        {r.sv.verdict === 'correct'
                          ? '○'
                          : r.sv.verdict === 'wrong'
                            ? '✗'
                            : '?'}
                      </b>
                      <span className="text-[11px] opacity-80">
                        {r.sv.sheetAnswer}
                      </span>
                      {r.sv.transcriptionError && <span>⚠</span>}
                    </span>
                  ))}
                </div>
                {sheetResults.some((r) => r.sv.correctBodyButSheetWrong) && (
                  <p className="mt-1.5 text-[#8a5a1c]">
                    본문은 정답이나 정답지에 다르게 적어 오답 처리된 문항이
                    있습니다 —{' '}
                    {sheetResults
                      .filter((r) => r.sv.correctBodyButSheetWrong)
                      .map((r) => `${r.no}번`)
                      .join(', ')}
                  </p>
                )}
              </>
            )}
            {sheetIdIssues && (
              <div className="mt-2 rounded-lg border border-[#e5484d] bg-[#fff1f2] px-2.5 py-2 font-semibold text-[#a1191d]">
                ⚠ 정답지에 적힌 본인정보가 다릅니다
                <ul className="mt-1 list-disc pl-4 font-normal">
                  {sheetIdIssues.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* 표지 본인정보 — **이 페이지를 보고 있을 때만** 자세히 안내한다.
            이름 불일치 경고는 화면 상단 토스트로 옮겼다(사용자 요구 2026-08-24). */}
        {viewingInfoPage && infoPageView ? (
          <div
            data-testid="info-page-notice"
            className="mt-2 rounded-lg border border-line-weak bg-layer-fill px-3 py-2.5 text-xs leading-relaxed"
          >
            <p className="text-sm font-bold text-ink">본인 정보 페이지</p>
            <p className="mt-0.5 text-ink-muted">
              이 페이지는 문제가 없고 본인 정보를 적는 장이라, 채점과 AI 과정
              분석을 하지 않습니다. ({infoPageView.label} ·{' '}
              {infoPageView.bySource}
              {infoPageView.note ? ` — ${infoPageView.note}` : ''})
            </p>
            {!infoPageView.hasStrokes ? (
              <p className="mt-1.5 text-ink-subtle">
                이 페이지에 필기가 없어 본인 확인을 하지 못했습니다.
              </p>
            ) : !idVerdict ? (
              <p className="mt-1.5 text-ink-subtle">본인정보 확인 중…</p>
            ) : idVerdict.cmp.nameMatch === null ? (
              <p className="mt-1.5 font-semibold text-[#8a5a1c]">
                이름 미기재 — 본인 확인 불가
                {idVerdict.written ? ` (적힌 것: ${idVerdict.written})` : ''}
              </p>
            ) : idVerdict.cmp.nameMatch ? (
              <p className="mt-1.5 font-semibold text-[#1a7f37]">
                ✓ 본인 확인 완료 — 이름 일치 ({idVerdict.written})
              </p>
            ) : (
              <p className="mt-1.5 font-semibold text-[#a1191d]">
                ⚠ 이름 불일치 — 시험지 {idCheck?.name} · 이 기록의 학생{' '}
                {studentInfo?.name}
              </p>
            )}
          </div>
        ) : (
          idVerdict?.cmp.nameMatch === true && (
            <p className="mt-2 text-xs font-semibold text-[#1a7f37]">
              ✓ 본인 확인 완료 — 표지 이름 일치 ({idVerdict.written})
            </p>
          )
        )}
      </div>

      {/* 진행 상태는 **크게** 보여준다 — 작은 글씨는 눈에 안 띄어 "안 끝났는데
          멈춘 것/에러" 로 읽힌다(사용자 지적 2026-08-18). */}
      {(receivingNow || autoGradingThis) && (
        <div className="flex items-center gap-2.5 rounded-xl border-2 border-line-brand bg-brand-weak px-4 py-3">
          <span className="inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-line-brand border-t-transparent" />
          <span className="text-sm font-bold text-ink">
            {receivingNow
              ? '크래들에서 펜 데이터를 받는 중입니다 — 필기 기록이 완성되면 자동으로 반영되고, 그다음에 AI 채점·분석이 진행됩니다.'
              : '이 문서를 백그라운드에서 AI 자동 채점 중입니다 — 끝나면 결과가 자동으로 표시됩니다. 기다리지 않고 다른 화면으로 가도 돼요.'}
          </span>
        </div>
      )}

      {reportBusy && (
        <div className="flex items-center gap-2.5 rounded-xl border-2 border-line-brand bg-brand-weak px-4 py-3">
          <span className="inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-line-brand border-t-transparent" />
          <span className="min-w-0 flex-1 text-sm font-bold text-ink">
            학습분석 리포트 생성 중 — 채점이 끝나는 대로 자동으로 만들어
            이동합니다. 얼마가 걸려도 완료까지 진행돼요.
          </span>
          <ActionButton
            variant="neutralOutline"
            size="xsmall"
            onClick={() => {
              reportCancelRef.current = true;
            }}
          >
            취소
          </ActionButton>
        </div>
      )}

      {(grading || analysisLoading) && (
        <div className="flex items-center gap-2.5 rounded-xl border-2 border-line-brand bg-brand-weak px-4 py-3">
          <span className="inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-line-brand border-t-transparent" />
          <span className="text-sm font-bold text-ink">
            {grading
              ? 'AI 채점 진행 중입니다 — 문항 버튼에 ○/✗ 가 차례로 붙습니다. 오류가 아니에요.'
              : 'AI 과정 분석 진행 중입니다 — 수십 초 걸릴 수 있어요.'}
          </span>
        </div>
      )}

      {/* ── 이름 불일치 상단 토스트 (사용자 요구 2026-08-24) ──
          채점 요약 밑에 묻히면 놓친다. 화면 맨 위에 띄우고, 스스로 사라지지
          않게 한다 — "다른 학생의 필기"는 3초 뒤 없어지면 안 되는 경고다. */}
      {(idVerdict?.cmp.nameMatch === false || sheetIdIssues) && !idToastClosed && (
        <div
          data-testid="id-name-mismatch"
          className="fixed inset-x-0 top-3 z-50 flex justify-center px-4"
        >
          <div className="flex max-w-3xl items-start gap-3 rounded-xl border-2 border-[#e5484d] bg-[#fff1f2] px-4 py-3 shadow-lg">
            <span className="text-base leading-none text-[#a1191d]">⚠</span>
            <div className="min-w-0 text-sm leading-relaxed text-[#a1191d]">
              <b>본인정보 불일치 — 다른 학생의 필기일 수 있습니다</b>
              {idVerdict?.cmp.nameMatch === false && (
                <>
                  <br />
                  표지 이름 <b>{idCheck?.name || '(읽지 못함)'}</b> · 이 기록의
                  학생 <b>{studentInfo?.name}</b>
                  {idVerdict.written && idVerdict.written !== idCheck?.name && (
                    <> (표지 전체: {idVerdict.written})</>
                  )}
                </>
              )}
              {sheetIdIssues?.map((t) => (
                <span key={t}>
                  <br />
                  정답지 · {t}
                </span>
              ))}
            </div>
            <button
              type="button"
              aria-label="경고 닫기"
              onClick={() => setIdToastClosed(true)}
              className="ml-1 shrink-0 rounded px-1.5 py-0.5 text-sm font-bold text-[#a1191d] hover:bg-[#ffe4e6]"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* ── AI 프롬프트 보기·수정 (교재 만들기의 편집기를 그대로 연다) ── */}
      <PaperPromptDialog
        pdf={promptDlg?.pdf ?? null}
        focusNo={promptDlg?.focusNo ?? null}
        onClose={() => setPromptDlg(null)}
        onSaved={() => setPromptRev((v) => v + 1)}
      />

      {/* 모범 풀이·답안 뷰어 — 학생 풀이(뒤 화면)와 나란히 비교한다 */}
      <Dialog open={solutionOpen} onOpenChange={setSolutionOpen}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              풀이·답안 — {selectedProblem?.cluster.label ?? ''}
            </DialogTitle>
            <DialogDescription>
              교사 제공 해설(6-2 B형 풀이+답안 등)에서 이 문항에 해당하는
              내용입니다. 학생 풀이는 뒤 화면에 그대로 있으니 나란히 비교하세요.
            </DialogDescription>
          </DialogHeader>
          {selectedSolution && (
            <div className="space-y-3 text-sm">
              <div className="rounded-lg bg-neutral-weak px-3 py-2">
                <span className="font-bold text-ink">정답</span>{' '}
                <span className="text-ink">
                  <LatexText text={selectedSolution.answer} />
                </span>
              </div>
              {selectedSolution.solution && (
                <div className="whitespace-pre-wrap rounded-lg border border-line-weak px-3 py-2 leading-relaxed text-ink">
                  <div className="mb-1 font-bold">모범 풀이</div>
                  <LatexText text={selectedSolution.solution} />
                </div>
              )}
              {selectedSolution.page != null &&
                (solutionImg ? (
                  <SolutionImage
                    src={solutionImg}
                    box={selectedSolution.box ?? null}
                    page={selectedSolution.page}
                    caption={
                      selectedSolution.solution
                        ? '손풀이 원본'
                        : '정답표 (이 문항은 답만 실려 있습니다)'
                    }
                  />
                ) : (
                  <p className="text-[12px] text-ink-subtle">
                    해설 이미지를 불러오는 중…
                  </p>
                ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 영역 편집 패널 — 드래그로 추가, 목록에서 이름 수정·삭제 */}
      {regionEditing && currentPageEntry && (
        <div className="space-y-2 rounded-lg border border-[#dc2626]/40 bg-layer-fill px-4 py-3">
          <p className="text-xs leading-relaxed text-ink-muted">
            <strong className="text-ink">인식이 틀렸다면 직접 고치세요.</strong>{' '}
            아래 화면에서 <strong>드래그하면 새 문항 영역</strong>이 만들어지고,
            영역 안의 필기가 그 문항의 풀이로 묶입니다. 목록에서 이름을 클릭해
            바꾸거나 삭제할 수 있어요.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {sortedClusters.length === 0 && (
              <span className="text-xs text-ink-subtle">
                아직 영역이 없습니다 — 화면에서 드래그해 추가하세요.
              </span>
            )}
            {sortedClusters.map((c) => (
              <span
                key={c.id}
                className={
                  'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs ' +
                  (selectedRegionId === c.id
                    ? 'border-[#dc2626] bg-[#dc2626]/10'
                    : 'border-line-solid bg-layer-default')
                }
              >
                <Editable
                  value={c.label}
                  onCommit={(v) => renameRegion(c.id, v)}
                  className="font-semibold text-ink"
                />
                <span className="text-ink-subtle">{c.strokeIds.length}획</span>
                <button
                  type="button"
                  aria-label={`${c.label} 영역 삭제`}
                  title="영역 삭제"
                  onClick={() => deleteRegion(c.id)}
                  className="rounded p-0.5 text-ink-subtle hover:bg-neutral-weak hover:text-critical"
                >
                  <Trash2 size={12} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 중앙 — 왼쪽 단 분석 | 캔버스 | 오른쪽 단 분석 (넓은 화면) */}
      {/* "전체" 선택 시에는 미리보기(재생 캔버스)를 숨기고 종합 분석만 보여준다 */}
      {strokesError ? (
        <Callout
          tone="warning"
          title="필기 데이터를 불러오지 못했습니다"
          description={strokesError}
        />
      ) : isAllMode ? null : (
        <div className="grid gap-5 2xl:grid-cols-[minmax(280px,1fr)_minmax(0,2.4fr)_minmax(280px,1fr)]">
          <aside className="hidden 2xl:block" data-testid="analysis-left">
            {selectedProblem && problemSide === 'L'
              ? analysisNode
              : sidePlaceholder('왼쪽')}
          </aside>
          <div className="min-w-0">
            <PlaybackView
              strokes={currentStrokes}
              playback={playback}
              // 풀이가 없는 문항을 골라도 **그 문제는 보여야 한다.**
              // 획이 없으면 화면이 비어 "에러인가" 로 읽힌다(사용자 지적
              // 2026-08-17). 배경(교재)을 넘겨 주면 focusRect 가 그 문항
              // 영역을 비춘다 — 인쇄된 문제를 그대로 볼 수 있다.
              paperPage={
                emptyPagePaper ??
                (currentStrokes.length === 0 && selectedProblem
                  ? pages.find((pg) => pg.key === selectedProblem.pageKey)
                  : undefined)
              }
              emptyLabel={
                selectedProblem
                  ? `${selectedProblem.cluster.label} — 아직 풀지 않았습니다`
                  : undefined
              }
              followPages={isAllMode}
              focusRect={
                regionEditing
                  ? null // 편집 중엔 페이지 전체를 보며 그린다
                  : selectedProblem
                    ? (problemViewRect ?? selectedProblem.cluster.bbox)
                    : isAllMode
                      ? undefined
                      : null
              }
              highlight={
                !regionEditing && selectedProblem
                  ? {
                      ...(problemViewRect ?? selectedProblem.cluster.bbox),
                      id: selectedProblem.cluster.id,
                    }
                  : null
              }
              highlightStrokeIds={markedStrokeIds}
              regions={
                regionEditing && currentPageEntry
                  ? sortedClusters.map((c) => ({
                      ...c.bbox,
                      id: c.id,
                      label: c.label,
                      active: selectedRegionId === c.id,
                    }))
                  : undefined
              }
              onRegionClick={(rid) => setSelectedRegionId(rid)}
              marks={regionEditing ? undefined : verdictMarks}
              drawMode={regionEditing}
              onDrawRect={addRegion}
            />
            {/* 범례 — 색이 무슨 뜻인지 화면에 적어둔다. 이게 없어서 "학생이
                빨간 펜으로 썼나?" 로 오해가 있었다 (2026-08-16). */}
            {markedStrokeIds && markedStrokeIds.size > 0 && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-muted">
                <span
                  aria-hidden
                  className="inline-block h-3 w-6 rounded-sm"
                  style={{ background: '#f2ff00' }}
                />
                형광펜 표시 = AI 분석이 짚은 부분입니다. 학생이 쓴 색이 아닙니다.
              </p>
            )}
            {/* 왜 칠했는지 — 문항으로 들어와도 이유가 보여야 한다 (2026-08-18) */}
            {selectedProblem && markedIssues.length > 0 && (
              <div className="mt-1.5 space-y-1">
                {markedIssues.map((it, i) => (
                  <p key={i} className="text-xs leading-relaxed text-ink-muted">
                    <b className="font-semibold text-ink">형광펜 이유:</b>{' '}
                    {it.title}
                    {it.why ? ` — ${it.why}` : ''}
                  </p>
                ))}
              </div>
            )}
          </div>
          <aside className="hidden 2xl:block" data-testid="analysis-right">
            {selectedProblem && problemSide === 'R'
              ? analysisNode
              : sidePlaceholder('오른쪽')}
          </aside>
        </div>
      )}

      {/* 문항 범위는 좁은 화면에서 아래 풀폭으로, 전체·페이지 범위는 항상 풀폭 */}
      {selectedProblem ? (
        <div className="2xl:hidden">{analysisNode}</div>
      ) : (
        analysisNode
      )}

      {/* 하단 — OCR | 피드백. OCR 패널은 **문항을 선택했을 때만** 보인다 —
          페이지 전체·전체 제출에는 인식 결과가 문항별로 갈리지 않아 의미가 없다
          (사용자 요구 2026-08-18). 전체 제출용 자동 인식은 계속 뒤에서 돌아
          AI 분석의 재료로 쓰인다. */}
      <div
        className={`grid items-start gap-5 ${selectedProblem ? 'lg:grid-cols-2' : ''}`}
      >
        {selectedProblem && (
        <section className="rounded-xl border border-line-weak bg-layer-default p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-bold text-ink">
              필기 인식 (OCR)
              {scopeInfo && (
                <span className="ml-2 align-middle text-xs font-medium text-brand">
                  범위: {scopeInfo.label}
                </span>
              )}
            </h3>
            <div className="flex items-center gap-1.5">
              {isFullAnalysisKey(scopeCacheKey) && ocrText && ocrEdited !== ocrText && (
                <ActionButton
                  variant="neutralWeak"
                  size="xsmall"
                  onClick={() => setOcrEdited(ocrText)}
                >
                  <span className="inline-flex items-center gap-1">
                    <RotateCcw size={13} /> 원래대로
                  </span>
                </ActionButton>
              )}
              <ActionButton
                variant="brandOutline"
                size="small"
                loading={isFullAnalysisKey(scopeCacheKey) ? ocrRunning : scopeOcrRunning}
                disabled={currentStrokes.length === 0}
                onClick={() =>
                  isFullAnalysisKey(scopeCacheKey) ? void runOcr() : void runScopeOcr()
                }
              >
                <span className="inline-flex items-center gap-1.5">
                  <ScanText size={15} /> 다시 인식
                </span>
              </ActionButton>
            </div>
          </div>

          {ocrError && isFullAnalysisKey(scopeCacheKey) && (
            <div className="mb-3">
              <Callout tone="critical" description={ocrError} />
            </div>
          )}

          {/* 문제 지문 — 학생 필기만 보면 "무엇을 푼 건지" 알 수 없다.
              PDF 에서 읽어낸 그 문항의 문제·보기를 위에 붙여 **문제와 답을 나란히**
              놓고 본다 (사용자 요청 2026-08-17). */}
          {selectedProblem?.cluster.meta?.question && (
            <div className="mb-4 rounded-lg border border-line-weak bg-layer-basement p-3.5">
              <p className="mb-1.5 text-xs font-semibold text-ink-subtle">
                {selectedProblem.cluster.meta.no}번 문제 (교재에서 인식)
              </p>
              <LatexText
                className="block text-[13px] leading-relaxed text-ink"
                text={selectedProblem.cluster.meta.question}
              />
              {selectedProblem.cluster.meta.choices.length > 0 && (
                <ol className="mt-2 space-y-0.5 text-[13px] text-ink-muted">
                  {selectedProblem.cluster.meta.choices.map((ch, i) => (
                    <li key={i} className="flex gap-1.5">
                      <span className="shrink-0 tabular-nums">
                        {'①②③④⑤⑥⑦⑧'[i] ?? `${i + 1}.`}
                      </span>
                      <LatexText className="min-w-0" text={ch} />
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {isFullAnalysisKey(scopeCacheKey) ? (
            <>
            <MathTextArea
              label="인식 결과"
              description="제출을 열면 자동으로 인식됩니다. 수식은 그대로 보이고, [편집]으로 고칠 수 있어요."
              value={ocrEdited}
              onChange={setOcrEdited}
              placeholder={
                ocrRunning
                  ? '필기를 자동 인식하고 있어요…'
                  : '인식 결과가 여기에 채워집니다'
              }
            />
            </>
          ) : (
            <>
            <MathTextArea
              label="이 범위의 인식 결과"
              description="문항을 선택하면 학생이 쓴 필기만 자동 인식합니다(인쇄 지문 제외). 고치면 자동 저장돼요."
              value={ocrByScope[scopeCacheKey] ?? ''}
              onChange={(v) =>
                setOcrByScope((m) => ({ ...m, [scopeCacheKey]: v }))
              }
              onCommit={(v) => saveScopeOcrEdit(v)}
              placeholder={
                scopeOcrRunning
                  ? '지문·풀이를 자동 인식하고 있어요…'
                  : '인식 결과가 여기에 채워집니다'
              }
            />
            </>
          )}
        </section>
        )}

        {/* 피드백 */}
        <section className="rounded-xl border border-line-weak bg-layer-default p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-bold text-ink">피드백</h3>
            <ActionButton
              variant="brandOutline"
              size="xsmall"
              loading={draftLoading}
              onClick={() => void makeDraft()}
            >
              <span className="inline-flex items-center gap-1">
                <Sparkles size={13} /> AI 초안 생성
              </span>
            </ActionButton>
          </div>
          <MathTextArea
            label="코멘트"
            description="AI 초안은 과정 분석·필기 인식 결과를 바탕으로 작성됩니다. 수식은 학생 화면에도 이렇게 보여요."
            value={body}
            onChange={setBody}
            placeholder="학생에게 전달할 피드백을 작성하세요"
          />

          {/* '학생에게 공개' 토글은 **숨김** — 이 기능을 안 쓰기로 했다
              (2026-08-17 사용자 결정). 되살릴 때를 대비해 지우지 않고 플래그로만
              가려둔다. toggleVisible·visibleUpdating 은 그대로 살아 있다. */}
          {SHOW_STUDENT_VISIBILITY && (
            <div className="mt-4 flex items-center justify-between rounded-lg border border-line-weak bg-layer-fill px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-ink">학생에게 공개</div>
                <div className="text-xs text-ink-subtle">
                  켜면 학생 화면에서 피드백을 볼 수 있어요.
                </div>
              </div>
              <Switch
                checked={submission.feedbackVisible}
                disabled={visibleUpdating}
                onCheckedChange={(checked) => void toggleVisible(checked)}
                aria-label="피드백 학생 공개"
              />
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <ActionButton
              variant="brandSolid"
              loading={saving}
              onClick={() => void save()}
            >
              저장
            </ActionButton>
          </div>
        </section>
      </div>
    </div>
  );
}
