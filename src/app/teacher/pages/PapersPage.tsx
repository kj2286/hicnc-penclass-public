/**
 * ncode 교재 만들기 — NGS(사내 ncode 발급 서버) 연동 PDF 목록/업로드.
 * 서버리스 프록시(/api/ngs)가 NGS_BASE_URL 미설정이면 503 을 돌려주므로
 * 그 경우 "연동 대기중" 안내 상태를 표시하고 업로드를 비활성화한다.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Skeleton } from '@seed-design/react';
import { PAPER_APP_TAG } from '@/lib/paper-list';
import { confirmUploadedPaperFolder } from '../paper-upload-folder';
import { PaperExplorer } from '../components/PaperExplorer';
import { PrintQueueDrawer } from '../components/PrintQueueDrawer';
import { startPrintJobPolling, usePrintJobsStore } from '@/store/print-jobs.store';
import { createLatestRequestGate, refreshUntilListed, shouldKeepUploadAttempt } from '@/lib/paper-refresh';
import { createPaperUploadSessions, type PaperUploadPhase } from '@/lib/paper-upload-session';
import {
  GEOMETRY_CACHE_KEY,
  dpiHint,
  dpiLabel,
  parseGeometryCache,
  readPaperGeometry,
  serializeGeometryCache,
  type PaperGeometry,
} from '@/lib/paper-dpi';
import {
  describePdf,
  isPdfFile,
  paperLabel,
  readPdfMeta,
  formatBytes,
  type PdfMeta,
} from '@/lib/pdf-meta';
import {
  PAPER_SUBJECTS,
  NEW_PAPER_SUBJECT,
  NEW_PAPER_SUBJECTS,
  effectiveSubject,
  type PaperSubject,
} from '@/lib/paper-subject';
import {
  BookOpen,
  ClipboardList,
  Download,
  FileCheck2,
  FileText,
  StickyNote,
  Sparkles,
  Trash2,
  Upload,
  AlertCircle,
  Check,
  Printer,
  RefreshCw,
} from 'lucide-react';
import { ActionButton } from 'seed-design/ui/action-button';
import {
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogRoot,
  AlertDialogTitle,
} from 'seed-design/ui/alert-dialog';
import { Callout } from 'seed-design/ui/callout';
import { EmptyState } from '@/components/EmptyState';
import {
  SegmentedControl,
  SegmentedControlItem,
} from 'seed-design/ui/segmented-control';
import { TextField, TextFieldInput } from 'seed-design/ui/text-field';
import { Drawer } from '@/components/ui/drawer';
import {
  configureNgs,
  deletePdf,
  downloadNcodedPdf,
  getPdfWithPages,
  listAllPdfs,
  uploadPdf,
  waitForRegisteredPdf,
  NgsHttpError,
  NgsAuthError,
  type Pdf,
} from '@/lib/ngs-client';
import {
  claimPaper,
  type ClaimResult,
  listMyPaperMeta,
  listMyPaperOwnership,
  visiblePapers,
  releasePaper,
  restorePaper,
  trashPaper,
  type PaperKind,
  setPaperSubject,
  supportsPaperSubject,
  SUBJECT_MIGRATION_HINT,
  type PaperMeta,
} from '@/lib/paper-owners';
import { listMyStudents, listStudentSubmissions } from '@/lib/api';
import { wireAutoGradeCatchUp } from '@/lib/auto-grade';
import {
  parseSolutionsPdf,
  saveSolutions,
  scanPaperProblems,
  type ParsedSolutions,
} from '@/lib/solutions-ingest';
import {
  compareSolutionsToPaper,
  type SolutionsMatchReport,
} from '@/lib/solutions';
import { listSolutionPdfIds } from '@/lib/solutions-io';
import { useToast } from '../components/toast';
import { PaperPromptDialog } from '../components/PaperPromptDialog';
import { useSessionStore } from '@/store/session.store';
import { TokenSelect } from '../components/TokenSelect';
import { NcodePrintDialog, type PrintTarget } from '../components/NcodePrintDialog';
import { isDesk } from '@/lib/desk';
import {
  buildImprintArgs,
  DEFAULT_IMPRINT_FORM,
  PAPER_PRESETS,
  type ImprintDpi,
  type ImprintFormValue,
  type PaperPresetId,
} from '../imprint';
import { formatDate } from '../format';

// 운영은 **항상** 같은 출처의 서버리스 릴레이(/api/ngs, /api/fps)를 쓴다.
// 🚨 예전에는 빌드타임 env(VITE_NGS_BASE_URL)가 있으면 릴레이 설정을 건너뛰었다.
// 새 Vercel 프로젝트에 개발용 .env.local 을 통째로 올렸더니 그 값이 운영 번들에
// 박혀, 브라우저가 NGS 를 교차 출처로 직접 부르다 CORS 로 전부 죽었다
// (실사고 2026-09-04: 교재 목록 "Failed to fetch", 업로드 버튼 잠김).
// 직접 호출은 개발 서버에서만 의미가 있으므로 DEV 로 못을 박는다.
const ENV_BASE = import.meta.env.DEV
  ? ((import.meta.env.VITE_NGS_BASE_URL as string | undefined) ?? '')
  : '';
if (!ENV_BASE) {
  configureNgs({ baseUrl: '/api/ngs' });
  void import('@/lib/fps-client').then((m) =>
    m.configureFps({ baseUrl: '/api/fps' }),
  );
}

type PageStatus = 'loading' | 'ready' | 'awaiting' | 'error';

type PaperSort = 'recent' | 'oldest' | 'processing';
type PaperFilter = '전체' | PaperKind | '미분류';
type UploadFolder = { id: string | null; path: string };

/** Keep a received ID while registration is retried: another click must not issue ncode again. */
type UploadReceipt = {
  ownerId: string;
  attemptId: string;
  title: string;
  file: File;
  fileMeta: PdfMeta | null;
  form: ImprintFormValue;
  startedAt: Date;
  kind: PaperKind;
  subject: PaperSubject;
  solutions: File | null;
  created: Pdf | null;
  claim: ClaimResult | null;
  folder: UploadFolder;
  folderSaved: boolean;
};
const paperUploadSessions = createPaperUploadSessions<UploadReceipt>();

/** 교재 1페이지 미리보기 썸네일 — 실패 시 아이콘 폴백 */
function PaperThumb({ pdfId, title }: { pdfId: number; title: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="flex h-14 w-11 shrink-0 items-center justify-center rounded-md border border-line-weak bg-brand-weak text-brand">
        <FileText size={16} />
      </span>
    );
  }
  return (
    <img
      src={`/api/download-pdf?id=${pdfId}&kind=page&page=1`}
      alt={`${title} 미리보기`}
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-14 w-11 shrink-0 rounded-md border border-line-weak bg-white object-cover object-top"
    />
  );
}

/**
 * 발급 형상 한 줄 — "1200dpi · B4". 둘 중 하나만 알아도 그것만 보여준다.
 * 표준 규격에 안 맞는 크기는 mm 로 적는다(스캔본은 몇 mm 씩 어긋난다).
 */
function geometryText(geo: PaperGeometry | undefined): string | null {
  if (!geo) return null;
  const parts = [dpiLabel(geo.dpi)];
  if (geo.widthMm != null && geo.heightMm != null) {
    parts.push(
      paperLabel(geo.widthMm, geo.heightMm) ??
        `${Math.round(geo.widthMm)}×${Math.round(geo.heightMm)}mm`,
    );
  }
  const text = parts.filter(Boolean).join(' · ');
  return text || null;
}

/** 배지 툴팁 — 해상도의 뜻 + 정확한 용지 치수 */
function geometryHint(geo: PaperGeometry | undefined): string | undefined {
  if (!geo) return undefined;
  const lines = [dpiHint(geo.dpi)];
  if (geo.widthMm != null && geo.heightMm != null) {
    lines.push(
      `용지 ${geo.widthMm}×${geo.heightMm}mm — 업로드할 때 고른 크기입니다.`,
    );
  }
  const hint = lines.filter(Boolean).join('\n');
  return hint || undefined;
}

const AWAITING_MESSAGE =
  '사내 ncode 발급 서버(NGS) 연동 대기중 — 관리자가 NGS_BASE_URL 을 설정하면 활성화됩니다.';

export function PapersPage() {
  const toast = useToast();
  const profileId = useSessionStore((st) => st.profile?.id);
  const [status, setStatus] = useState<PageStatus>('loading');
  /** ncode 바로 출력 대상 (PC 앱에서만) — 0.2.27 */
  const [printTarget, setPrintTarget] = useState<PrintTarget | null>(null);
  const deskApp = isDesk();
  const printJobs = usePrintJobsStore((st) => st.jobs);
  const printActive = usePrintJobsStore((st) => st.activeCount());
  const openPrintQueue = usePrintJobsStore((st) => st.setOpen);
  useEffect(() => {
    if (deskApp) return startPrintJobPolling();
  }, [deskApp]);
  const [pdfs, setPdfs] = useState<Pdf[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<PaperSort>('recent');
  const [paperFilter, setPaperFilter] = useState<PaperFilter>('전체');
  const [uploadFolder, setUploadFolder] = useState<UploadFolder>({ id: null, path: '내 교재' });
  const [explorerRefreshKey, setExplorerRefreshKey] = useState(0);
  const [listRefreshing, setListRefreshing] = useState(false);
  const manualRefreshLock = useRef(false);
  const [bulkDeleteIds, setBulkDeleteIds] = useState<number[]>([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const bulkDeleteLock = useRef(false);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);

  // 정렬: 기본 최근 만든 순. '처리중'은 미합성 항목을 위로 올린 뒤 최근순.
  const sortedPdfs = useMemo(() => {
    const byRecent = (a: Pdf, b: Pdf) =>
      String(b.createdAt).localeCompare(String(a.createdAt));
    const list = [...pdfs];
    if (sort === 'oldest') return list.sort((a, b) => byRecent(b, a));
    if (sort === 'processing') {
      const processing = (p: Pdf) => !(p.ncodedPdfUrl || p.ncodedPdfUri);
      return list.sort((a, b) => {
        if (processing(a) !== processing(b)) return processing(a) ? -1 : 1;
        return byRecent(a, b);
      });
    }
    return list.sort(byRecent);
  }, [pdfs, sort]);

  // 업로드 다이얼로그
  const [uploadOpen, setUploadOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  /** 고른 PDF 를 훑어본 결과 — 쪽수·용지·크기 (사용자 요구 2026-09-04) */
  const [fileMeta, setFileMeta] = useState<PdfMeta | null>(null);
  const [metaBusy, setMetaBusy] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  /** 드래그가 드롭 영역 위에 있는가 — 테두리·배경으로 알린다 */
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  const fileReadGeneration = useRef(0);
  const [title, setTitle] = useState('');
  const [paperKind, setPaperKind] = useState<PaperKind>('학습지');
  /** 과목 (026) — 문항 인식·분석 프롬프트가 이 값으로 갈린다 */
  const [subject, setSubject] = useState<PaperSubject>(NEW_PAPER_SUBJECT);
  /** 업로드 다이얼로그에서 함께 올리는 풀이+답안 PDF (테스트지 전용, 선택) */
  const [solutionsFile, setSolutionsFile] = useState<File | null>(null);
  /** pdfId → 교재 메타(종류·과목) — 목록의 과목 셀렉트 값 근거 (015/026). */
  const [metaMap, setMetaMap] = useState<Map<number, PaperMeta>>(new Map());
  /**
   * 교재별 ncode 발급 해상도(600/1200). NGS **목록에는 없고 상세에만** 있어
   * 교재마다 한 번씩 읽어 캐시한다(발급 시점에 정해져 바뀌지 않는다).
   * 사용자 요구 2026-09-05: "어떤 게 600인지 1200인지 모르겠다".
   */
  const [dpiMap, setDpiMap] = useState<Map<number, PaperGeometry>>(() =>
    parseGeometryCache(
      typeof localStorage === 'undefined'
        ? null
        : localStorage.getItem(GEOMETRY_CACHE_KEY),
    ),
  );
  useEffect(() => {
    void listMyPaperMeta().then(setMetaMap).catch(() => {});
  }, []);
  // 해상도 채우기 — 목록에 새로 들어온 교재만 상세를 읽는다(동시 4건).
  // 실패는 조용히 넘긴다: 해상도를 몰라도 교재 목록은 그대로 쓸 수 있어야 한다.
  useEffect(() => {
    const need = pdfs
      .map((p) => p.id)
      .filter((id) => !dpiMap.has(id))
      .slice(0, 60);
    if (need.length === 0) return;
    let alive = true;
    void (async () => {
      const found = new Map<number, PaperGeometry>();
      const queue = [...need];
      const worker = async () => {
        for (;;) {
          const id = queue.shift();
          if (id == null) return;
          const full = await getPdfWithPages(id).catch(() => null);
          const geo = readPaperGeometry(full?.pages);
          if (geo.dpi != null || geo.widthMm != null) found.set(id, geo);
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      if (!alive || found.size === 0) return;
      setDpiMap((prev) => {
        const next = new Map(prev);
        for (const [id, geo] of found) next.set(id, geo);
        try {
          localStorage.setItem(GEOMETRY_CACHE_KEY, serializeGeometryCache(next));
        } catch {
          /* 사파리 프라이빗 등 — 캐시는 없어도 된다 */
        }
        return next;
      });
    })();
    return () => {
      alive = false;
    };
  }, [pdfs, dpiMap]);

  /** 026(subject 컬럼) 적용 여부. 미적용이면 과목 셀렉트를 잠그고 안내만 한다 —
   *  저장을 시도했다가 PostgREST 원문 에러를 토스트로 뱉지 않게. */
  const [subjectReady, setSubjectReady] = useState(true);
  useEffect(() => {
    void supportsPaperSubject().then(setSubjectReady);
  }, []);
  /**
   * 기존 교재의 과목 지정/변경 (026). 과목이 바뀌면 문항 인식 프롬프트가
   * 통째로 달라지므로, 이미 인식해 둔 문항 캐시는 다음 [문항 다시 인식] 이나
   * 재수신 때 새 과목으로 다시 잡힌다.
   */
  const changeSubject = async (pdfId: number, next: PaperSubject) => {
    const cur = metaMap.get(pdfId);
    const prev = cur?.subject ?? null;
    const patch = (v: PaperSubject | null) =>
      setMetaMap((m) => {
        const nm = new Map(m);
        const c = nm.get(pdfId);
        nm.set(pdfId, {
          kind: c?.kind ?? null,
          infoPage: c?.infoPage ?? null,
          answerPage: c?.answerPage ?? null,
          subject: v,
        });
        return nm;
      });
    if (!subjectReady) {
      toast(SUBJECT_MIGRATION_HINT, 'critical');
      return;
    }
    patch(next);
    try {
      await setPaperSubject(pdfId, next);
      toast(
        `${next} 교재로 지정했습니다. 문항 인식을 다시 하면 ${next} 기준으로 잡힙니다.`,
        'positive',
      );
    } catch (e) {
      patch(prev);
      // 컬럼이 없으면 셀렉트를 잠근다 — 같은 에러를 두 번 보게 하지 않는다
      void supportsPaperSubject().then(setSubjectReady);
      toast(
        e instanceof Error ? e.message : '과목 지정에 실패했습니다.',
        'critical',
      );
    }
  };

  // ── 풀이+답안 PDF (모범 풀이·답안) — 교재별 업로드 (사용자 요구 2026-09-02) ──
  // 올리면 AI 가 쪽별로 손풀이·정답표를 읽어 solutions/{pdfId}.json 으로 저장하고,
  // catch-up 이 이 교재를 푼 학생들의 문항 분석을 모범 풀이 비교로 다시 쓴다.
  /** 해설이 이미 등록된 교재 id 들 — 버튼 라벨 구분용 */
  const [solHave, setSolHave] = useState<Set<number>>(new Set());
  /** 해설 목록 조회 상태 — '없음' 과 '못 읽음' 을 화면에서 갈라야 한다
   *  (사용자 신고 2026-09-04: 올렸는지 안 올렸는지 표시가 없다). */
  const [solList, setSolList] = useState<'loading' | 'ready' | 'error'>('loading');
  /** 이 세션에서 해설 등록이 실패한 교재 → 사유. 행에 빨간 배지로 남긴다. */
  const [solFailed, setSolFailed] = useState<Map<number, string>>(new Map());
  useEffect(() => {
    void listSolutionPdfIds()
      .then((ids) => {
        setSolHave(ids);
        setSolList('ready');
      })
      .catch(() => setSolList('error'));
  }, []);
  const [solBusy, setSolBusy] = useState<{ pdfId: number; note: string } | null>(
    null,
  );
  const solFileRef = useRef<HTMLInputElement>(null);
  const solTargetRef = useRef<number | null>(null);
  const pickSolutionsPdf = (pdfId: number) => {
    solTargetRef.current = pdfId;
    solFileRef.current?.click();
  };
  /** 대조에서 어긋난 채 멈춘 해설 — '그래도 등록할까요?' 팝업의 재료 */
  const [solMismatch, setSolMismatch] = useState<{
    pdfId: number;
    parsed: ParsedSolutions;
    report: SolutionsMatchReport;
  } | null>(null);
  /** 저장 + 마무리 (대조 통과 or 사용자가 '그래도 등록' 확인) */
  const finishSolutions = async (
    pdfId: number,
    parsed: ParsedSolutions,
    matchNote: string,
  ): Promise<boolean> => {
    setSolBusy({ pdfId, note: '저장 중' });
    try {
      await saveSolutions(pdfId, parsed, (note) => setSolBusy({ pdfId, note }));
      setSolHave((prev) => new Set(prev).add(pdfId));
      setSolFailed((m) => {
        const n = new Map(m);
        n.delete(pdfId);
        return n;
      });
      toast(
        `풀이·답안 ${parsed.doc.problems.length}문항 등록 (${parsed.summary})${matchNote}. ` +
          '이 교재를 푼 학생들의 문항 분석이 모범 풀이 비교로 자동 갱신됩니다.',
        'positive',
      );
      // 해설 서명이 바뀌었다 — 완료로 기록된 제출도 다시 훑게 한다
      void wireAutoGradeCatchUp({
        listStudents: listMyStudents,
        listSubmissions: listStudentSubmissions,
        force: true,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '풀이·답안 저장에 실패했습니다.';
      setSolFailed((m) => new Map(m).set(pdfId, msg));
      toast(msg, 'critical');
      return false;
    } finally {
      setSolBusy(null);
    }
    return true;
  };
  /**
   * 풀이+답안 PDF 처리 — 읽기 → **테스트지와 대조** → (다르면 팝업) → 저장.
   * 사용자 요구(2026-09-02): 문제수·풀이수·내용이 같은지 반드시 비교해 안내하고,
   * 다르면 "그래도 괜찮아?" 를 물어본 뒤에만 등록한다.
   */
  /** 'saved' 저장됨 / 'mismatch' 대조 팝업으로 넘어감(팝업에서 저장·취소 결정) /
   *  'failed' 실패(행에 배지, 사유는 solFailed) */
  const processSolutions = async (
    pdfId: number,
    file: File,
  ): Promise<'saved' | 'mismatch' | 'failed'> => {
    setSolBusy({ pdfId, note: '해설 읽는 중' });
    setSolFailed((m) => {
      const n = new Map(m);
      n.delete(pdfId);
      return n;
    });
    try {
      const parsed = await parseSolutionsPdf(file, (note) =>
        setSolBusy({ pdfId, note }),
      );
      // 테스트지 쪽 문항 스캔 — 실패해도 등록은 막지 않는다 (대조 불가로 안내)
      const paper = await scanPaperProblems(pdfId, (note) =>
        setSolBusy({ pdfId, note }),
      ).catch(() => []);
      if (paper.length === 0) {
        const ok = await finishSolutions(pdfId, parsed, ' — 테스트지 대조는 못 했습니다');
        return ok ? 'saved' : 'failed';
      }
      const report = compareSolutionsToPaper(paper, parsed.doc);
      if (!report.same) {
        setSolBusy(null);
        setSolMismatch({ pdfId, parsed, report });
        return 'mismatch';
      }
      const ok = await finishSolutions(
        pdfId,
        parsed,
        ` — 테스트지와 문항 구성 일치(${report.paperCount}문항)`,
      );
      return ok ? 'saved' : 'failed';
    } catch (e) {
      const msg = e instanceof Error ? e.message : '풀이·답안 업로드에 실패했습니다.';
      setSolFailed((m) => new Map(m).set(pdfId, msg));
      toast(msg, 'critical');
      setSolBusy(null);
      return 'failed';
    }
  };
  const onSolutionsFile = async (file: File | null) => {
    const pdfId = solTargetRef.current;
    if (solFileRef.current) solFileRef.current.value = '';
    if (!file || pdfId == null) return;
    await processSolutions(pdfId, file);
  };

  const [form, setForm] = useState<ImprintFormValue>(DEFAULT_IMPRINT_FORM);
  const uploadSession = useSyncExternalStore(
    paperUploadSessions.subscribe,
    () => paperUploadSessions.get(profileId ?? ''),
  );
  const { receipt: pendingUpload, busy: uploading, progress, phase, error: uploadError } = uploadSession;
  const rememberUpload = (receipt: UploadReceipt | null) => paperUploadSessions.patch(profileId ?? '', { receipt });
  const updatePhase = (phase: PaperUploadPhase) => paperUploadSessions.patch(profileId ?? '', { phase });
  const setProgress = (progress: number | null) => paperUploadSessions.patch(profileId ?? '', { progress });
  const setUploadError = (error: string | null) => paperUploadSessions.patch(profileId ?? '', { error });

  useEffect(() => {
    const receipt = paperUploadSessions.get(profileId ?? '').receipt;
    ++fileReadGeneration.current;
    setFile(receipt?.file ?? null);
    setFileMeta(receipt?.fileMeta ?? null);
    setTitle(receipt?.title ?? '');
    setForm(receipt?.form ?? DEFAULT_IMPRINT_FORM);
    setPaperKind(receipt?.kind ?? '학습지');
    setSubject(receipt?.subject ?? NEW_PAPER_SUBJECT);
    setSolutionsFile(receipt?.solutions ?? null);
    setMetaBusy(false);
    setMetaError(null);
    setUploadFolder(receipt?.folder ?? { id: null, path: '내 교재' });
    setUploadOpen(false);
  }, [profileId]);

  // 교재 삭제 → 휴지통(sp_paper_owners.deleted_at) / 삭제 내역에서 원복·영구 삭제
  /** AI 프롬프트 편집 대상 교재 (학원 설정 토글 ON 일 때만 버튼 노출) */
  const [promptPdf, setPromptPdf] = useState<{ id: number; title: string | null } | null>(null);
  const customPromptsEnabled = useSessionStore(
    (st) => Boolean(st.academy?.customPromptsEnabled),
  );
  const [allPdfs, setAllPdfs] = useState<Pdf[]>([]);
  const [trashed, setTrashed] = useState<Map<number, string>>(new Map());
  const [trashOpen, setTrashOpen] = useState(false);
  const [purgeTarget, setPurgeTarget] = useState<Pdf | null>(null);
  const [purging, setPurging] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);

  // 클릭 미리보기 — PDF 페이지 전체
  const [previewPdf, setPreviewPdf] = useState<Pdf | null>(null);

  const requestGate = useRef(createLatestRequestGate());
  const [pollingPaused, setPollingPaused] = useState(false);

  /** Every refresh reads ownership again. An older request cannot replace newer rows. */
  const load = useCallback(async (quiet = false): Promise<Pdf[] | null> => {
    const request = requestGate.current.begin();
    const ownerId = profileId;
    if (!quiet) {
      setStatus('loading');
      setError(null);
    }
    try {
      const [list, ownership] = await Promise.all([
        listAllPdfs(),
        listMyPaperOwnership(),
      ]);
      if (!requestGate.current.isLatest(request) ||
          useSessionStore.getState().profile?.id !== ownerId) return null;
      if (ownership.active == null) {
        throw new Error('내 교재 등록 정보를 확인하지 못했습니다. 목록을 다시 불러와 주세요.');
      }
      // NGS can accept an ID before the paginated list catches up. Use its real
      // detail only after a fresh ownership read, and keep the normal app filter.
      const missing = paperUploadSessions.get(ownerId ?? '').acceptedIds.filter((id) =>
        ownership.active!.has(id) && !list.some((pdf) => pdf.id === id));
      const details = await Promise.all(missing.map((id) => getPdfWithPages(id)));
      if (!requestGate.current.isLatest(request) ||
          useSessionStore.getState().profile?.id !== ownerId) return null;
      const confirmed = [...list, ...details.filter((pdf): pdf is Pdf => pdf != null)];
      const shown = visiblePapers(confirmed, ownership);
      setAllPdfs(confirmed.filter((p) => p.status !== 'removed'));
      setTrashed(ownership.trashed);
      setPdfs(shown);
      setError(null);
      setStatus('ready');
      const session = paperUploadSessions.get(ownerId ?? '');
      if (!session.busy && session.receipt?.claim?.claimed && session.receipt.folderSaved &&
          shown.some((pdf) => pdf.id === session.receipt?.created?.id)) {
        // A delayed GET confirmation can finish registration without any new POST.
        paperUploadSessions.patch(ownerId ?? '', {
          error: null,
          phase: null,
          ...(session.receipt.solutions ? {} : { receipt: null }),
        });
      }
      return shown;
    } catch (err) {
      if (!requestGate.current.isLatest(request) ||
          useSessionStore.getState().profile?.id !== ownerId) return null;
      const message = err instanceof Error ? err.message : '교재 목록을 불러오지 못했습니다.';
      setError(message);
      if (quiet) return null; // Keep the last confirmed list, but show the refresh error.
      setStatus(err instanceof NgsHttpError && err.status === 503 ? 'awaiting' : 'error');
      return null;
    }
  }, [profileId]);

  const refreshPapers = async () => {
    if (manualRefreshLock.current) return;
    manualRefreshLock.current = true;
    setListRefreshing(true);
    try {
      await load(true);
      setExplorerRefreshKey((key) => key + 1);
    } finally {
      manualRefreshLock.current = false;
      setListRefreshing(false);
    }
  };

  const submitBulkDelete = async () => {
    if (bulkDeleteLock.current || uploading || !bulkDeleteIds.length) return;
    bulkDeleteLock.current = true;
    setBulkDeleting(true);
    setBulkDeleteError(null);
    const failed: number[] = [];
    let moved = 0;
    try {
      for (const id of bulkDeleteIds) {
        try {
          // A zero-row ownership update is not permission to delete the shared NGS PDF.
          if (!await trashPaper(id)) throw new Error('소유 기록을 확인하지 못했습니다.');
          moved++;
        } catch { failed.push(id); }
      }
      if (moved) toast(`${moved}개 교재를 삭제 내역으로 옮겼습니다.`, 'positive');
      setBulkDeleteIds(failed);
      if (failed.length) setBulkDeleteError(`${failed.length}개 교재를 옮기지 못했습니다. 남은 교재만 다시 시도할 수 있습니다.`);
      await load(true);
    } finally {
      bulkDeleteLock.current = false;
      setBulkDeleting(false);
    }
  };

  const submitRestore = async (pdf: Pdf) => {
    if (restoring) return;
    setRestoring(pdf.id);
    try {
      await restorePaper(pdf.id);
      toast(`${pdf.title || `교재 #${pdf.id}`} 을(를) 원복했습니다.`, 'positive');
      void load();
    } catch (err) {
      toast(
        err instanceof Error ? err.message : '원복에 실패했습니다.',
        'critical',
      );
    } finally {
      setRestoring(null);
    }
  };

  const submitPurge = async () => {
    if (!purgeTarget || purging) return;
    setPurging(true);
    try {
      await deletePdf(purgeTarget.id);
      await releasePaper(purgeTarget.id).catch(() => {});
      toast('영구 삭제했습니다.', 'positive');
      setPurgeTarget(null);
      void load();
    } catch (err) {
      toast(
        err instanceof Error ? err.message : '영구 삭제에 실패했습니다.',
        'critical',
      );
    } finally {
      setPurging(false);
    }
  };

  // 초기 로드
  useEffect(() => {
    setPdfs([]);
    setAllPdfs([]);
    void load();
    return () => requestGate.current.invalidate();
  }, [load]);

  useEffect(() => {
    if (!uploading && !pendingUpload) return;
    const warnBeforeExit = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeExit);
    return () => window.removeEventListener('beforeunload', warnBeforeExit);
  }, [uploading, pendingUpload]);

  // 자동 폴링: 실제 대기 교재를 5초 간격으로 확인하고 5분 뒤 수동 확인을 안내한다.
  // (의존성을 boolean 으로 좁혀 인터벌이 목록 갱신마다 재생성되지 않게 한다.)
  const hasProcessing = pdfs.some((p) => !p.ncodedPdfUrl && !p.ncodedPdfUri);
  const hasPendingRegistration = Boolean(pendingUpload?.created && pendingUpload.claim?.claimed);
  useEffect(() => {
    if ((!hasProcessing && !hasPendingRegistration) || uploading) return;
    setPollingPaused(false);
    const startedAt = Date.now();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (cancelled) return;
      if (Date.now() - startedAt >= 300_000) {
        setPollingPaused(true);
        return;
      }
      // Wait for a slow GET before scheduling the next one. Parallel polls would
      // otherwise keep invalidating each other through the latest-request gate.
      await load(true);
      if (!cancelled) timer = setTimeout(() => { void poll(); }, 5000);
    };
    timer = setTimeout(() => { void poll(); }, 5000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [hasProcessing, hasPendingRegistration, load, uploading]);

  const previousBusy = useRef(uploading);
  useEffect(() => {
    const wasBusy = previousBusy.current;
    previousBusy.current = uploading;
    // A request started on a previous route mount can complete while this view is open.
    if (wasBusy && !uploading) {
      void load(true);
      setExplorerRefreshKey((key) => key + 1);
    }
  }, [uploading, load]);

  /**
   * 업로드할 PDF 를 고른다 — 클릭·드래그 둘 다 여기로 온다.
   * 고르는 즉시 쪽수·용지를 읽어 보여준다(ncode 는 쪽 단위로 한도를 먹는다).
   */
  const pickFile = (f: File | null) => {
    if (paperUploadSessions.get(profileId ?? '').busy || paperUploadSessions.get(profileId ?? '').receipt) return;
    const generation = ++fileReadGeneration.current;
    setMetaError(null);
    setFileMeta(null);
    setMetaBusy(false);
    if (!f) {
      setFile(null);
      return;
    }
    if (!isPdfFile(f)) {
      setFile(null);
      setMetaError('PDF 파일만 올릴 수 있어요.');
      return;
    }
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.pdf$/i, ''));
    setMetaBusy(true);
    void readPdfMeta(f)
      .then((meta) => {
        if (generation === fileReadGeneration.current) setFileMeta(meta);
      })
      .catch((e) => {
        if (generation !== fileReadGeneration.current) return;
        setMetaError(
          e instanceof Error && /password|encrypt/i.test(e.message)
            ? '암호가 걸린 PDF라 쪽수를 읽지 못했습니다. 암호를 풀고 올려주세요.'
            : '쪽수를 읽지 못했습니다. 파일이 정상인지 확인해 주세요.',
        );
      })
      .finally(() => {
        if (generation === fileReadGeneration.current) setMetaBusy(false);
      });
  };

  const resetUpload = () => {
    ++fileReadGeneration.current;
    setUploadOpen(false);
    setFile(null);
    setFileMeta(null);
    setMetaError(null);
    setMetaBusy(false);
    setDragOver(false);
    dragDepth.current = 0;
    setTitle('');
    setForm(DEFAULT_IMPRINT_FORM);
    setPaperKind('학습지');
    setSubject(NEW_PAPER_SUBJECT);
    setSolutionsFile(null);
    setUploadError(null);
    setProgress(null);
    updatePhase(null);
  };

  const closeUpload = (open: boolean) => {
    if (!open && paperUploadSessions.get(profileId ?? '').busy) return;
    setUploadOpen(open);
    // Keep a received ID and its options when a failed registration is closed.
    if (!open && !paperUploadSessions.get(profileId ?? '').receipt) resetUpload();
  };

  const previousReceipt = useRef(pendingUpload);
  useEffect(() => {
    const wasPending = previousReceipt.current;
    previousReceipt.current = pendingUpload;
    if (wasPending && !pendingUpload && !uploading) resetUpload();
  }, [pendingUpload, uploading]);

  const submitUpload = async () => {
    if (paperUploadSessions.get(profileId ?? '').busy) return;
    let receipt = paperUploadSessions.get(profileId ?? '').receipt;
    if (!receipt && !file) return;
    const ownerId = useSessionStore.getState().profile?.id;
    if (!ownerId || (receipt && receipt.ownerId !== ownerId)) {
      setUploadError('로그인이 바뀌었습니다. 내 교재 목록을 다시 열어 주세요.');
      return;
    }
    const built = buildImprintArgs(form);
    if (!receipt && !built.ok) {
      setUploadError(built.error);
      return;
    }
    if (!paperUploadSessions.begin(ownerId)) return;
    requestGate.current.invalidate();
    setUploadError(null);
    let completed = false;
    try {
      const checkOwner = () => {
        if (useSessionStore.getState().profile?.id !== ownerId) {
          throw new Error('로그인이 바뀌어 등록을 멈췄습니다. 원래 계정으로 다시 접속해 주세요.');
        }
      };
      const recover = async (attempt: UploadReceipt) => {
        updatePhase('ncode');
        const found = await waitForRegisteredPdf({
          title: attempt.title,
          notBefore: attempt.startedAt,
          matches: (pdf) => pdf.extraInfo?.app === PAPER_APP_TAG &&
            pdf.extraInfo?.uploadAttemptId === attempt.attemptId,
        });
        if (!found) {
          throw new Error('발급 요청 결과를 아직 확인하지 못했습니다. [발급 상태 다시 확인]을 눌러 같은 요청을 확인해 주세요. 파일은 다시 업로드하지 않습니다.');
        }
        return found;
      };
      if (!receipt) {
        if (!file || !built.ok) return;
        receipt = {
          ownerId,
          attemptId: crypto.randomUUID(),
          title: title.trim() || file.name.replace(/\.pdf$/i, ''),
          file,
          fileMeta,
          form: { ...form },
          startedAt: new Date(),
          kind: paperKind,
          subject,
          solutions: paperKind === '테스트지' ? solutionsFile : null,
          created: null,
          claim: null,
          folder: { ...uploadFolder },
          folderSaved: false,
        };
        rememberUpload(receipt);
        setProgress(0);
        updatePhase('upload');
        try {
          const created = await uploadPdf({
            file,
            title: receipt.title,
            extraInfo: { app: PAPER_APP_TAG, uploadAttemptId: receipt.attemptId },
            imprint: built.args,
            onPhase: updatePhase,
            onProgress: (p) => {
              if (p.fraction != null) setProgress(Math.round(p.fraction * 100));
            },
          });
          if (!Number.isSafeInteger(created.id) || created.id <= 0) {
            throw new Error('발급 응답의 교재 번호를 확인하지 못했습니다.');
          }
          receipt = { ...receipt, created };
          rememberUpload(receipt);
        } catch (err) {
          // A lost/malformed 2xx response can still mean ncode was issued.
          const uncertain = shouldKeepUploadAttempt({
            phase: paperUploadSessions.get(ownerId).phase,
            httpStatus: err instanceof NgsHttpError ? err.status : undefined,
            authRejected: err instanceof NgsAuthError,
          });
          if (!uncertain) {
            rememberUpload(null);
            throw err;
          }
          receipt = { ...receipt, created: await recover(receipt) };
          rememberUpload(receipt);
        }
      } else if (!receipt.created) {
        receipt = { ...receipt, created: await recover(receipt) };
        rememberUpload(receipt);
      }
      checkOwner();
      const created = receipt.created;
      if (!created) throw new Error('발급한 교재 번호를 확인하지 못했습니다.');
      paperUploadSessions.accept(ownerId, created.id);
      updatePhase('register');
      if (!receipt.claim?.claimed) {
        const claim = await claimPaper(created.id, receipt.kind, receipt.subject, receipt.ownerId).catch(
          (e): ClaimResult => ({
            claimed: false,
            subjectSaved: false,
            warning: e instanceof Error ? e.message : '교재 정보 저장에 실패했습니다.',
          }),
        );
        receipt = { ...receipt, claim };
        rememberUpload(receipt);
        if (!claim.claimed) {
          throw new Error(`교재 #${created.id}는 발급됐지만 내 교재에 등록하지 못했습니다. ${claim.warning ?? ''} [등록 다시 확인]으로 이어서 진행해 주세요.`);
        }
      }
      checkOwner();
      if (!receipt.folderSaved) {
        try {
          await confirmUploadedPaperFolder({
            ownerId: receipt.ownerId,
            pdfId: created.id,
            folderId: receipt.folder.id,
            isCurrentOwner: () => useSessionStore.getState().profile?.id === ownerId,
          });
          receipt = { ...receipt, folderSaved: true };
          rememberUpload(receipt);
          setExplorerRefreshKey((key) => key + 1);
        } catch (folderError) {
          throw new Error(`교재 #${created.id}는 발급됐지만 ${receipt.folder.path} 폴더에 저장하지 못했습니다. 파일을 다시 올리지 않고 같은 교재의 저장 위치를 다시 확인합니다. ${folderError instanceof Error ? folderError.message : ''}`);
        }
      }
      checkOwner();
      updatePhase('verify');
      const shown = await refreshUntilListed({ id: created.id, load: () => load(true) });
      checkOwner();
      if (!shown) {
        throw new Error(`교재 #${created.id}의 등록 요청을 보냈지만 목록 반영을 확인하지 못했습니다. [등록 다시 확인]을 누르면 같은 교재를 확인합니다.`);
      }
      const confirmedReceipt = receipt;
      setMetaMap((m) => new Map(m).set(created.id, {
        kind: confirmedReceipt.kind,
        infoPage: null,
        answerPage: null,
        subject: confirmedReceipt.claim?.subjectSaved ? confirmedReceipt.subject : null,
      }));
      if (receipt.claim?.warning) toast(receipt.claim.warning, 'critical');
      if (receipt.solutions) {
        updatePhase('solutions');
        const result = await processSolutions(created.id, receipt.solutions);
        if (result === 'failed') {
          throw new Error(`교재 #${created.id}는 목록에 등록됐지만 풀이·답안을 저장하지 못했습니다. 다시 확인하면 풀이·답안 등록을 이어서 진행합니다.`);
        }
        receipt = { ...receipt, solutions: null };
        rememberUpload(receipt);
      }
      setPaperFilter('전체');
      const listed = shown.find((p) => p.id === created.id)!;
      toast(
        listed.ncodedPdfUrl || listed.ncodedPdfUri
          ? `${receipt.folder.path}에 교재 #${created.id}를 등록했습니다.`
          : `교재 #${created.id}가 목록에 등록됐습니다. ncode 적용을 기다리는 중입니다.`,
        'positive',
      );
      rememberUpload(null);
      completed = true;
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : '교재 등록에 실패했습니다.');
    } finally {
      paperUploadSessions.finish(ownerId);
      setProgress(null);
      if (completed) resetUpload();
    }
  };

  const download = async (pdf: Pdf) => {
    try {
      const detail = await getPdfWithPages(pdf.id);
      const ok = downloadNcodedPdf(detail ?? pdf);
      if (!ok) {
        toast('다운로드 주소를 찾지 못했습니다. 발급이 아직 진행 중일 수 있어요.', 'critical');
      } else {
        // 브라우저 다운로드는 화면 반응이 없어 받은 건지 알 수 없다
        // (사용자 요구 2026-08-18) — 성공을 명시적으로 알린다.
        toast(`"${pdf.title}" 다운로드를 시작했습니다 — 다운로드 폴더를 확인하세요.`);
      }
    } catch (err) {
      toast(
        err instanceof Error ? err.message : '다운로드에 실패했습니다.',
        'critical',
      );
    }
  };

  const actionsBusy = uploading || bulkDeleting || purging || restoring != null || solBusy != null;
  const uploadDisabled = actionsBusy || (!pendingUpload && status !== 'ready');

  return (
    <div className="space-y-5">
      <h1 className="sr-only">교재 만들기</h1>
      {pendingUpload && !uploadOpen && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line-solid bg-layer-default p-4" role="status">
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-ink">{pendingUpload.created ? `교재 #${pendingUpload.created.id} 등록 확인이 남아 있습니다` : '교재 발급 요청을 확인하고 있습니다'}</p>
            <p className="mt-1 text-ink-muted">{pendingUpload.title} · 같은 요청을 이어서 확인합니다.</p>
          </div>
          <ActionButton variant="neutralOutline" onClick={() => setUploadOpen(true)}>확인 계속하기</ActionButton>
        </div>
      )}
      {status === 'ready' && error && (
        <Callout tone="warning" title="목록을 새로 확인하지 못했습니다" description={`${error} 마지막으로 확인한 교재를 표시합니다. 새로고침으로 다시 확인해 주세요.`} />
      )}
      {pollingPaused && (hasProcessing || hasPendingRegistration) && (
        <Callout tone="informative" title="ncode 적용 상태를 확인해 주세요" description="자동 확인을 잠시 멈췄습니다. 새로고침으로 현재 상태를 확인할 수 있습니다. 같은 파일을 다시 올릴 필요는 없습니다." />
      )}

      {status === 'loading' && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      )}

      {status === 'awaiting' && (
        <>
          <Callout
            tone="informative"
            title="ncode 발급 서버 연동 대기중"
            description={AWAITING_MESSAGE}
          />
          <div className="rounded-xl border border-line-weak bg-layer-default">
            <EmptyState
              illustration="inbox"
              size="sm"
              title="아직 만든 교재가 없습니다"
              description="서버 연동이 완료되면 PDF 업로드로 교재를 만들 수 있어요."
            />
          </div>
        </>
      )}

      {status === 'error' && (
        <div className="max-w-2xl space-y-3">
          <Callout
            tone="warning"
            title="교재 목록을 불러오지 못했습니다"
            description={`ncode 교재 목록을 불러오지 못했습니다. (${error})`}
          />
          <ActionButton variant="neutralWeak" size="small" onClick={() => void load()}>
            다시 시도
          </ActionButton>
        </div>
      )}

      {status === 'ready' && (
        <PaperExplorer
          pdfs={sortedPdfs}
          refreshKey={explorerRefreshKey}
          onOpenPdf={setPreviewPdf}
          paperSearchText={(pdf) => effectiveSubject(metaMap.get(pdf.id)?.subject)}
          filterActive={paperFilter !== '전체'}
          filterKey={paperFilter}
          paperFilter={(pdf) => paperFilter === '전체' || (metaMap.get(pdf.id)?.kind ?? '미분류') === paperFilter}
          filterControl={<select aria-label="교재 종류 필터" value={paperFilter} onChange={(e) => setPaperFilter(e.target.value as PaperFilter)} className="h-8 rounded-md border border-line-weak bg-layer-default px-2 text-xs">{(['전체', '테스트지', '시험지', '학습지', '단순노트', '미분류'] as const).map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select>}
          sortControl={<select aria-label="교재 정렬" value={sort} onChange={(e) => setSort(e.target.value as PaperSort)} className="h-8 rounded-md border border-line-weak bg-layer-default px-2 text-xs"><option value="recent">최근순</option><option value="oldest">오래된순</option><option value="processing">처리 중 먼저</option></select>}
          headerActions={(folderId, path, blocked) => <>
            {deskApp && <button type="button" data-testid="print-queue-button" onClick={() => openPrintQueue(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-ink-muted hover:bg-neutral-weak"><Printer size={15} />출력 목록{printActive > 0 ? ` (${printActive})` : printJobs.length ? ` (${printJobs.length})` : ''}</button>}
            <button type="button" disabled={actionsBusy} onClick={() => setTrashOpen(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-ink-muted hover:bg-neutral-weak disabled:opacity-40"><Trash2 size={15} />삭제 내역{trashed.size > 0 ? ` (${trashed.size})` : ''}</button>
            <button type="button" disabled={uploadDisabled || blocked} onClick={() => { if (!pendingUpload) setUploadFolder({ id: folderId, path }); setUploadOpen(true); }} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand px-3 text-xs font-semibold text-white disabled:opacity-40"><Upload size={15} />{pendingUpload ? '등록 이어서 확인' : 'PDF 업로드'}</button>
            <button type="button" aria-label="교재와 폴더 새로고침" title="새로고침" disabled={actionsBusy || listRefreshing || blocked} onClick={() => void refreshPapers()} className="inline-flex size-8 items-center justify-center rounded-md text-ink-muted hover:bg-neutral-weak disabled:opacity-40"><RefreshCw size={16} className={listRefreshing ? 'animate-spin' : ''} /></button>
          </>}
          disabled={actionsBusy}
          onDeletePdfs={(ids) => { setBulkDeleteError(null); setBulkDeleteIds(ids); }}
          renderPaper={(pdf, checked, toggle, deleteEntry) => {
              const hasNcodePdf = !!(pdf.ncodedPdfUrl || pdf.ncodedPdfUri);
              return (
                <div
                  key={pdf.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-3"
                >
                  <input type="checkbox" checked={checked} onChange={toggle} disabled={actionsBusy} aria-label={`${pdf.title || `교재 #${pdf.id}`} 선택`} className="size-4 shrink-0 accent-[var(--hc-color-primary)]" />
                  <button
                    type="button"
                    onClick={() => setPreviewPdf(pdf)}
                    className="flex min-w-[180px] flex-1 items-center gap-3 text-left"
                    aria-label={`${pdf.title || `교재 #${pdf.id}`} 미리보기`}
                  >
                    <PaperThumb
                      pdfId={pdf.id}
                      title={pdf.title || `교재 #${pdf.id}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink hover:underline">
                        {pdf.title || `교재 #${pdf.id}`}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
                        <span>{metaMap.get(pdf.id)?.kind ?? '미분류'}</span><span>·</span><span>{pdf.pageCount}페이지</span>
                        <span>·</span>
                        <span>{formatDate(pdf.createdAt)}</span>
                        {/* 발급 형상 — 해상도와 **업로드할 때 고른 용지**.
                            다시 인쇄할 때 프린터·용지를 고르는 기준이라 목록에서 바로 본다. */}
                        {(() => {
                          const geo = dpiMap.get(pdf.id);
                          const text = geometryText(geo);
                          if (!text) return null;
                          return (
                            <>
                              <span>·</span>
                              <span
                                data-testid="paper-dpi"
                                title={geometryHint(geo)}
                                className="rounded-full bg-neutral-weak px-1.5 py-0.5 font-semibold text-ink-muted"
                              >
                                {text}
                              </span>
                            </>
                          );
                        })()}
                        {!hasNcodePdf && (
                          <>
                            <span>·</span>
                            <div className="inline-flex items-center gap-1 text-brand">
                              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
                              <span>처리 중</span>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </button>
                  <div className="flex flex-wrap items-center gap-2">
                    {/* 과목 (026) — 문항 인식이 이 값으로 갈린다. 값이 없는
                        옛 교재는 수학으로 읽으므로 '수학' 이 선택되어 보인다. */}
                    <TokenSelect
                      aria-label={`${pdf.title || `교재 #${pdf.id}`} 과목`}
                      disabled={!subjectReady || actionsBusy}
                      title={subjectReady ? undefined : SUBJECT_MIGRATION_HINT}
                      value={effectiveSubject(metaMap.get(pdf.id)?.subject)}
                      onValueChange={(v) =>
                        void changeSubject(pdf.id, v as PaperSubject)
                      }
                    >
                      {PAPER_SUBJECTS.map((sj) => (
                        <option key={sj} value={sj}>
                          {sj}
                        </option>
                      ))}
                    </TokenSelect>
                    {/* 해설 상태 배지 — 버튼 라벨만으로는 올렸는지 안 올렸는지
                        안 보였다(사용자 신고 2026-09-04). 있음/없음/실패/확인 중을
                        갈라서 항상 보여준다. */}
                    {(() => {
                      const failed = solFailed.get(pdf.id);
                      if (solBusy?.pdfId === pdf.id) return null;
                      if (failed)
                        return (
                          <span
                            title={failed}
                            data-testid="solutions-state"
                            data-state="failed"
                            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#FDECEC] px-2 py-0.5 text-xs font-bold text-[#C0392B]"
                          >
                            <AlertCircle size={11} /> 풀이·답안 실패
                          </span>
                        );
                      if (solHave.has(pdf.id))
                        return (
                          <span
                            data-testid="solutions-state"
                            data-state="have"
                            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#E7F5EC] px-2 py-0.5 text-xs font-bold text-[#0F7B3F]"
                          >
                            <Check size={11} strokeWidth={3} /> 풀이·답안 있음
                          </span>
                        );
                      if (solList === 'loading')
                        return (
                          <span
                            data-testid="solutions-state"
                            data-state="loading"
                            className="shrink-0 rounded-full bg-neutral-weak px-2 py-0.5 text-xs text-ink-subtle"
                          >
                            해설 확인 중
                          </span>
                        );
                      if (solList === 'error')
                        return (
                          <span
                            title="해설 목록을 읽지 못했습니다 — 새로고침해 보세요"
                            data-testid="solutions-state"
                            data-state="unknown"
                            className="shrink-0 rounded-full bg-neutral-weak px-2 py-0.5 text-xs text-ink-subtle"
                          >
                            해설 확인 실패
                          </span>
                        );
                      return (
                        <span
                          data-testid="solutions-state"
                          data-state="none"
                          className="shrink-0 rounded-full border border-line-weak px-2 py-0.5 text-xs text-ink-subtle"
                        >
                          풀이·답안 없음
                        </span>
                      );
                    })()}
                    <ActionButton
                      variant="neutralWeak"
                      size="small"
                      data-testid="upload-solutions"
                      disabled={actionsBusy}
                      loading={solBusy?.pdfId === pdf.id}
                      onClick={() => pickSolutionsPdf(pdf.id)}
                    >
                      <span className="inline-flex items-center gap-1">
                        <FileCheck2 size={14} />
                        {solBusy?.pdfId === pdf.id
                          ? solBusy.note
                          : solHave.has(pdf.id)
                            ? '교체'
                            : solFailed.has(pdf.id)
                              ? '다시 올리기'
                              : '올리기'}
                      </span>
                    </ActionButton>
                    {customPromptsEnabled && (
                      <ActionButton
                        variant="neutralWeak"
                        size="small"
                        onClick={() =>
                          setPromptPdf({ id: pdf.id, title: pdf.title ?? null })
                        }
                      >
                        <span className="inline-flex items-center gap-1">
                          <Sparkles size={14} /> AI 프롬프트
                        </span>
                      </ActionButton>
                    )}
                    {hasNcodePdf && deskApp && (
                      <ActionButton
                        variant="brandOutline"
                        size="small"
                        data-testid="ncode-print"
                        onClick={() =>
                          setPrintTarget({
                            id: pdf.id,
                            title: pdf.title ?? '',
                            // 목록 응답엔 pages 가 없을 수 있다 — 다이얼로그가 상세를 다시 읽는다
                            dpi: pdf.pages?.[0]?.imprintDpi ?? pdf.pages?.[0]?.dpi ?? null,
                          })
                        }
                      >
                        <span className="inline-flex items-center gap-1">
                          <Printer size={14} /> 바로 출력
                        </span>
                      </ActionButton>
                    )}
                    {hasNcodePdf ? (
                      <ActionButton
                        variant="neutralOutline"
                        size="small"
                        onClick={() => void download(pdf)}
                      >
                        <span className="inline-flex items-center gap-1">
                          <Download size={14} /> 다운로드
                        </span>
                      </ActionButton>
                    ) : (
                      <span className="text-xs text-ink-muted">
                        처리 중...
                      </span>
                    )}
                    <button
                      type="button"
                      aria-label={`${pdf.title || `교재 #${pdf.id}`} 삭제`}
                      onClick={deleteEntry}
                      className="rounded-md p-1.5 text-ink-subtle hover:bg-critical-weak hover:text-critical"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
          }}
        />
      )}

      <AlertDialogRoot open={bulkDeleteIds.length > 0} onOpenChange={(open) => { if (!open && !bulkDeleteLock.current) setBulkDeleteIds([]); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>선택한 교재를 삭제하시겠습니까?</AlertDialogTitle>
            <AlertDialogDescription>{bulkDeleteIds.length}개 교재를 삭제 내역으로 옮깁니다. 삭제 내역에서 복원할 수 있습니다.</AlertDialogDescription>
          </AlertDialogHeader>
          {bulkDeleteError && <p role="alert" className="text-sm text-critical">{bulkDeleteError}</p>}
          <AlertDialogFooter>
            <AlertDialogAction variant="neutralWeak" disabled={bulkDeleting} onClick={() => setBulkDeleteIds([])}>취소</AlertDialogAction>
            <AlertDialogAction variant="criticalSolid" loading={bulkDeleting} disabled={bulkDeleting} onClick={() => void submitBulkDelete()}>삭제 내역으로 이동</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>
      <PrintQueueDrawer />

      {/* 교재·문항별 AI 프롬프트 편집 */}
      <PaperPromptDialog pdf={promptPdf} onClose={() => setPromptPdf(null)} />

      {/* 교재 미리보기 — 클릭한 PDF 의 전체 페이지 */}
      <Drawer
        open={previewPdf !== null}
        onOpenChange={(o) => !o && setPreviewPdf(null)}
        title={previewPdf ? previewPdf.title || `교재 #${previewPdf.id}` : ''}
        description={
          previewPdf
            ? [
                `${previewPdf.pageCount}페이지`,
                formatDate(previewPdf.createdAt),
                // 발급 해상도 — 인쇄 전에 프린터를 고르는 기준
                geometryText(dpiMap.get(previewPdf.id)),
              ]
                .filter(Boolean)
                .join(' · ')
            : undefined
        }
      >
        {previewPdf && (
          <div className="space-y-3">
            {Array.from({ length: previewPdf.pageCount }, (_, i) => (
              <figure key={i}>
                <img
                  src={`/api/download-pdf?id=${previewPdf.id}&kind=page&page=${i + 1}`}
                  alt={`p.${i + 1}`}
                  loading="lazy"
                  className="w-full border border-line-weak bg-white"
                />
                <figcaption className="mt-1 text-center text-xs text-ink-subtle">
                  p.{i + 1}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </Drawer>

      {/* 삭제 내역(휴지통) — 원복 또는 영구 삭제 */}
      <Drawer
        open={trashOpen}
        onOpenChange={setTrashOpen}
        title="삭제 내역"
        description="삭제한 교재입니다. 원복하거나 영구 삭제할 수 있어요."
      >
        {trashed.size === 0 ? (
          <div className="py-8 text-center text-sm text-ink-subtle">
            삭제한 교재가 없습니다.
          </div>
        ) : (
          <div className="space-y-2">
            {[...trashed.entries()].map(([pdfId, deletedAt]) => {
              const pdf = allPdfs.find((p) => p.id === pdfId);
              if (!pdf) return null;
              return (
                <div
                  key={pdfId}
                  className="flex items-center gap-3 border border-line-weak bg-layer-default p-2.5"
                >
                  <PaperThumb pdfId={pdf.id} title={pdf.title || `교재 #${pdf.id}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">
                      {pdf.title || `교재 #${pdf.id}`}
                    </div>
                    <div className="mt-0.5 text-xs text-ink-subtle">
                      삭제 {formatDate(deletedAt)}
                    </div>
                  </div>
                  <ActionButton
                    variant="neutralOutline"
                    size="xsmall"
                    loading={restoring === pdf.id}
                    onClick={() => void submitRestore(pdf)}
                  >
                    원복
                  </ActionButton>
                  <ActionButton
                    variant="criticalSolid"
                    size="xsmall"
                    onClick={() => setPurgeTarget(pdf)}
                  >
                    영구 삭제
                  </ActionButton>
                </div>
              );
            })}
          </div>
        )}
      </Drawer>

      {/* 영구 삭제 확인 */}
      <AlertDialogRoot
        open={purgeTarget !== null}
        onOpenChange={(o) => !o && setPurgeTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>영구 삭제하시겠습니까?</AlertDialogTitle>
            <AlertDialogDescription>
              {purgeTarget?.title || (purgeTarget ? `교재 #${purgeTarget.id}` : '')}
              이(가) 완전히 삭제되며 되돌릴 수 없습니다. 이미 인쇄한 교재의
              필기 인식에는 영향을 줄 수 있어요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              variant="neutralWeak"
              onClick={() => setPurgeTarget(null)}
            >
              취소
            </AlertDialogAction>
            <AlertDialogAction
              variant="criticalSolid"
              loading={purging}
              onClick={() => void submitPurge()}
            >
              영구 삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>

      {/* 지트의 520px Drawer 구성에 HICNC 토큰과 기존 영어 과목 흐름을 적용한다. */}
      <Drawer
        open={uploadOpen}
        onOpenChange={closeUpload}
        closeDisabled={uploading}
        title="교재 만들기"
        description="PDF를 올리고 ncode 패턴을 적용해 인쇄용 교재를 만듭니다."
        footer={
          <div className="w-full space-y-3">
            {uploading && (
              <div className="space-y-2 text-sm" role="status" aria-live="polite">
                <div className="flex items-center gap-2 font-medium text-ink">
                  <RefreshCw size={15} className="animate-spin motion-reduce:animate-none" aria-hidden />
                  {phase === 'upload' ? `파일 업로드 중 · ${progress ?? 0}%`
                    : phase === 'ncode' ? 'ncode 발급 요청 확인 중'
                    : phase === 'register' ? '내 교재에 등록 중'
                    : phase === 'verify' ? '내 교재 목록 반영 확인 중'
                    : `풀이·답안 등록 중 · ${solBusy?.note ?? '해설 읽는 중'}`}
                </div>
                {phase === 'upload' && (
                  <div role="progressbar" aria-label="파일 업로드" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress ?? 0} className="h-1.5 overflow-hidden rounded-full bg-neutral-weak">
                    <div className="h-full bg-brand transition-[width]" style={{ width: `${progress ?? 0}%` }} />
                  </div>
                )}
                <p className="text-xs text-ink-muted">{phase === 'upload' ? '파일 전송 후 ncode 발급과 목록 등록을 확인합니다.' : '교재 쪽수와 인쇄 해상도에 따라 몇 분 걸릴 수 있습니다. 이 화면에서 기다려 주세요.'}</p>
              </div>
            )}
            {!uploading && pendingUpload && (
              <p className="text-xs text-ink-muted" role="status">{pendingUpload.created ? `교재 #${pendingUpload.created.id} · 파일을 다시 올리지 않고 등록을 확인합니다.` : '같은 발급 요청을 확인합니다. 파일을 다시 올리지 않습니다.'}</p>
            )}
            {uploadError && <div role="alert"><Callout tone="warning" description={uploadError} /></div>}
            <div className="flex flex-wrap justify-end gap-2">
              {!uploading && uploadError && pendingUpload?.created && !pendingUpload.folderSaved && pendingUpload.folder.id !== null && (
                <ActionButton variant="neutralOutline" onClick={() => {
                  rememberUpload({ ...pendingUpload, folder: { id: null, path: '내 교재' }, folderSaved: false });
                  setUploadFolder({ id: null, path: '내 교재' });
                  setUploadError('저장 위치를 내 교재로 바꿨습니다. [등록 다시 확인]을 눌러 같은 교재를 등록해 주세요.');
                }}>내 교재에 등록하기</ActionButton>
              )}
              <ActionButton variant="neutralWeak" onClick={() => closeUpload(false)} disabled={uploading}>
                {pendingUpload ? '닫기' : '취소'}
              </ActionButton>
              <ActionButton variant="brandSolid" loading={uploading} disabled={uploading || (!file && !pendingUpload)} onClick={() => void submitUpload()}>
                {pendingUpload ? (pendingUpload.created ? '등록 다시 확인' : '발급 상태 다시 확인') : 'ncode 교재 만들기'}
              </ActionButton>
            </div>
          </div>
        }
      >
          <p className="mb-4 rounded-md bg-neutral-weak px-3 py-2 text-sm text-ink-muted">저장 위치: {pendingUpload?.folder.path ?? uploadFolder.path}</p>
          <fieldset disabled={uploading || pendingUpload != null} className="min-w-0 space-y-5 border-0 p-0">
            <div>
              <div className="mb-1.5 text-sm font-medium text-ink">PDF 파일</div>
              <label
                data-testid="pdf-dropzone"
                onDragEnter={(e) => {
                  e.preventDefault();
                  if (paperUploadSessions.get(profileId ?? '').busy || paperUploadSessions.get(profileId ?? '').receipt) return;
                  dragDepth.current += 1;
                  setDragOver(true);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (paperUploadSessions.get(profileId ?? '').busy || paperUploadSessions.get(profileId ?? '').receipt) return;
                  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  dragDepth.current = Math.max(0, dragDepth.current - 1);
                  if (dragDepth.current === 0) setDragOver(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  dragDepth.current = 0;
                  setDragOver(false);
                  pickFile(e.dataTransfer.files?.[0] ?? null);
                }}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border border-dashed px-4 py-5 transition-colors focus-within:ring-2 focus-within:ring-brand ${dragOver ? 'border-brand bg-brand-weak' : 'border-line-solid bg-layer-default hover:bg-neutral-weak'}`}
              >
                <Upload size={20} className="shrink-0 text-brand" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{file ? file.name : pendingUpload ? pendingUpload.title : 'PDF를 끌어다 놓거나 눌러서 선택하세요'}</span>
                  <span className="mt-1 block text-xs text-ink-muted" data-testid="pdf-meta">
                    {file ? (metaBusy ? `${formatBytes(file.size)} · 쪽수 확인 중` : fileMeta ? describePdf(fileMeta) : formatBytes(file.size)) : pendingUpload ? '이 앱에서 시작한 요청을 이어서 확인합니다' : 'PDF 파일 · 원본 용지와 쪽수를 확인합니다'}
                  </span>
                </span>
                <input type="file" accept=".pdf,application/pdf" className="sr-only" aria-label="교재 PDF 선택" onChange={(e) => {
                  pickFile(e.currentTarget.files?.[0] ?? null);
                  e.currentTarget.value = '';
                }} />
              </label>
              {metaError && (
                <p className="mt-1.5 text-xs text-critical">{metaError}</p>
              )}
              {/* 쪽수·용지가 발급에 그대로 영향을 준다 — 미리 알린다 */}
              {fileMeta && fileMeta.mixedSizes && (
                <p className="mt-1.5 text-xs text-warning">
                  쪽마다 용지 크기가 다릅니다. 발급 용지를 하나로 고르면 일부 쪽의
                  ncode 위치가 어긋날 수 있어요.
                </p>
              )}
              {fileMeta && !fileMeta.mixedSizes && !paperLabel(fileMeta.widthMm, fileMeta.heightMm) && (
                <p className="mt-1.5 text-xs text-ink-subtle">
                  표준 규격이 아닌 크기입니다 — 아래 <b className="text-ink">용지</b>를
                  실제 인쇄물에 맞춰 골라주세요.
                </p>
              )}
              {fileMeta && fileMeta.pages > 50 && (
                <p className="mt-1.5 text-xs text-ink-subtle">
                  {fileMeta.pages}쪽이라 하루 발급 한도(200쪽)를 많이 씁니다.
                </p>
              )}
            </div>

            <TextField label="교재 이름">
              <TextFieldInput
                value={pendingUpload?.title ?? title}
                onChange={(e) => setTitle(e.currentTarget.value)}
                placeholder="예: 중2 영어 독해·어법 워크북 3단원"
              />
            </TextField>

            {/* 과목 — 문항 인식 프롬프트가 이 값으로 갈린다.
                영어·국어는 지문 한 덩이에, 과학은 자료 하나에 문항이 여러 개
                매달리는 구조라 수학용 프롬프트로는 문항이 하나도 안 잡혔다. */}
            <div>
              <div className="mb-1.5 text-sm font-medium text-ink">과목</div>
              <div className="grid grid-cols-4 gap-2" data-testid="subject-picker">
                {NEW_PAPER_SUBJECTS.map((sj) => {
                  const selected = (pendingUpload?.subject ?? subject) === sj;
                  return (
                    <button
                      key={sj}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setSubject(sj)}
                      className={`relative border px-3 py-2.5 text-sm transition-colors ${
                        selected
                          ? 'border-brand bg-brand-weak font-bold text-brand ring-1 ring-inset ring-brand'
                          : 'border-line-solid bg-layer-default text-ink-muted hover:bg-neutral-weak hover:text-ink'
                      }`}
                    >
                      {sj}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-xs text-ink-subtle">
                {subjectReady
                  ? '영어를 기본으로 선택합니다. 다른 과목도 지정할 수 있습니다.'
                  : SUBJECT_MIGRATION_HINT}
              </p>
            </div>

            <div>
              <div className="mb-1.5 text-sm font-medium text-ink">종류</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(
                  [
                    ['테스트지', ClipboardList],
                    ['시험지', FileCheck2],
                    ['학습지', BookOpen],
                    ['단순노트', StickyNote],
                  ] as const
                ).map(([k, Icon]) => {
                  const selected = (pendingUpload?.kind ?? paperKind) === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        setPaperKind(k);
                      }}
                      className={`relative flex flex-col items-center gap-1.5 border px-3 py-3 text-sm transition-colors ${
                        selected
                          ? 'border-brand bg-brand-weak font-bold text-brand ring-1 ring-inset ring-brand'
                          : 'border-line-solid bg-layer-default text-ink-muted hover:bg-neutral-weak hover:text-ink'
                      }`}
                    >
                      {selected && (
                        <span
                          aria-hidden
                          className="absolute right-1.5 top-1.5 grid h-4 w-4 place-items-center rounded-full bg-brand text-white"
                        >
                          <Check size={11} strokeWidth={3} />
                        </span>
                      )}
                      <Icon
                        size={20}
                        className={selected ? 'text-brand' : ''}
                      />
                      {k}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-xs text-ink-subtle">
                테스트지·시험지·학습지는 리뷰에서 문항별 분석·학습분석 리포트가
                제공되고, 단순노트는 적힌 내용 안내 분석이 제공됩니다.
              </p>
            </div>

            {/* 풀이+답안 PDF — 테스트지에는 별도 해설 PDF 가 있다 (2026-09-02).
                등록이 끝나면 AI 가 읽어 테스트지 문항과 대조하고, 학생 풀이와
                모범 풀이를 비교 분석하는 데 쓴다. */}
            {paperKind === '테스트지' && (
              <div data-testid="solutions-file-picker">
                <div className="mb-1.5 text-sm font-medium text-ink">
                  풀이+답안 PDF <span className="font-normal text-ink-subtle">(선택)</span>
                </div>
                <label className="flex cursor-pointer items-center gap-2 border border-line-solid bg-layer-default px-3 py-2.5 text-sm text-ink-muted hover:bg-neutral-weak hover:text-ink">
                  <Upload size={15} />
                  <span className="min-w-0 flex-1 truncate">
                    {solutionsFile ? solutionsFile.name : '풀이+답안 PDF 를 선택하세요'}
                  </span>
                  {solutionsFile && (
                    <button
                      type="button"
                      aria-label="풀이+답안 선택 해제"
                      onClick={(e) => {
                        e.preventDefault();
                        setSolutionsFile(null);
                      }}
                      className="text-ink-subtle hover:text-critical"
                    >
                      ✕
                    </button>
                  )}
                  <input
                    type="file"
                    accept="application/pdf"
                    hidden
                    onChange={(e) => {
                      setSolutionsFile(e.currentTarget.files?.[0] ?? null);
                      e.currentTarget.value = '';
                    }}
                  />
                </label>
                <p className="mt-1 text-xs text-ink-subtle">
                  올리면 AI 가 문항별 모범 풀이·답을 읽어 두고, 학생 풀이와 비교해
                  분석합니다. 테스트지와 문항 구성이 같은지도 자동으로 대조합니다.
                </p>
              </div>
            )}

            <div>
              <div className="mb-1.5 text-sm font-medium text-ink">용지</div>
              <TokenSelect
                aria-label="용지 프리셋"
                className="w-full"
                value={form.paper}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, paper: v as PaperPresetId }))
                }
              >
                {PAPER_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </TokenSelect>
            </div>

            {form.paper === 'custom' && (
              <div className="grid grid-cols-2 gap-3">
                <TextField label="가로 (mm)">
                  <TextFieldInput
                    value={form.customWidthMm}
                    inputMode="decimal"
                    onChange={(e) => {
                      const v = e.currentTarget.value;
                      setForm((f) => ({ ...f, customWidthMm: v }));
                    }}
                    placeholder="210"
                  />
                </TextField>
                <TextField label="세로 (mm)">
                  <TextFieldInput
                    value={form.customHeightMm}
                    inputMode="decimal"
                    onChange={(e) => {
                      const v = e.currentTarget.value;
                      setForm((f) => ({ ...f, customHeightMm: v }));
                    }}
                    placeholder="297"
                  />
                </TextField>
              </div>
            )}

            <div>
              <div className="mb-1.5 text-sm font-medium text-ink">인쇄 DPI</div>
              <SegmentedControl
                aria-label="인쇄 DPI"
                value={String(form.dpi)}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, dpi: Number(v) as ImprintDpi }))
                }
              >
                <SegmentedControlItem value="600">600 dpi</SegmentedControlItem>
                <SegmentedControlItem value="1200">1200 dpi</SegmentedControlItem>
              </SegmentedControl>
            </div>

          </fieldset>
      </Drawer>
      {/* 풀이+답안 ↔ 테스트지 대조 불일치 — "그래도 괜찮아?" (사용자 요구 2026-09-02) */}
      <AlertDialogRoot
        open={solMismatch !== null}
        onOpenChange={(o) => !o && setSolMismatch(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>풀이+답안이 테스트지와 다릅니다</AlertDialogTitle>
            <AlertDialogDescription>
              올린 풀이+답안을 테스트지 문항과 대조했더니 아래가 어긋납니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {solMismatch && (
            <ul className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-ink">
              {solMismatch.report.issues.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <p className="text-[13px] text-ink-muted">
            다른 교재의 풀이+답안일 수 있어요. 그래도 등록할까요? 등록하면 이
            내용대로 학생 풀이와 비교 분석합니다.
          </p>
          <AlertDialogFooter>
            <AlertDialogAction
              variant="neutralWeak"
              onClick={() => {
                setSolMismatch(null);
                toast('풀이·답안을 등록하지 않았습니다.');
              }}
            >
              취소
            </AlertDialogAction>
            <AlertDialogAction
              variant="brandSolid"
              onClick={() => {
                const m = solMismatch;
                setSolMismatch(null);
                if (m)
                  void finishSolutions(
                    m.pdfId,
                    m.parsed,
                    ' — 테스트지와 구성이 달라 확인 후 등록함',
                  );
              }}
            >
              그래도 등록
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>

      {/* ncode 바로 출력 (PC 앱) */}
      <NcodePrintDialog target={printTarget} onClose={() => setPrintTarget(null)} />
      {/* 풀이+답안 PDF 선택 — 행의 [풀이·답안 올리기] 가 트리거 */}
      <input
        ref={solFileRef}
        type="file"
        accept="application/pdf"
        hidden
        onChange={(e) => void onSolutionsFile(e.currentTarget.files?.[0] ?? null)}
      />
    </div>
  );
}
