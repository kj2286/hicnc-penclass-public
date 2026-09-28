import { isCurrentAssessment } from '@/lib/assessment';
import { AssessmentReferences } from '../components/AssessmentReferences';
/**
 * 학습분석 리포트 — 리뷰에서 생성한 문서를 편집·인쇄한다.
 *
 * - 섹션: 위/아래 이동, 숨김/노출, AI 텍스트 직접 수정 (선생님 편집)
 * - 통계·그래프(체감 난이도)는 문항 데이터에서 실시간 파생
 * - [PDF 저장] = 브라우저 인쇄 (컨트롤은 print:hidden 으로 숨김)
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { kstShortDate } from '@/lib/kst';
import { Link, useParams } from 'react-router-dom';
import {
  Eye,
  EyeOff,
  FileDown,
  GripVertical,
  Printer,
  Save,
} from 'lucide-react';
import { ActionButton } from 'seed-design/ui/action-button';
import { Callout } from 'seed-design/ui/callout';
import { getSubmission } from '@/lib/api';
import { deskPrint, deskSavePdf, isDesk } from '@/lib/desk';
import { useToast } from '../components/toast';
import { ReportPromptDialog } from '../components/ReportPromptDialog';
import { useSessionStore } from '@/store/session.store';
import { LatexText } from '@/components/LatexText';
import { humanizeSeconds } from '@/lib/duration';
import { buildExamSummary } from '@/lib/exam-summary';
import { MiniMarkdown } from '@/components/MiniMarkdown';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { listMyStudents, listStudentSubmissions } from '@/lib/api';
import { loadClassAverage, type ClassAverage } from '@/lib/class-average';
import {
  BAND_COLOR,
  difficultyBand,
  finalVerdict,
  medianActiveMs,
  perceivedDifficulty10,
  perceivedWhy,
} from '@/lib/difficulty';
import { UnitRadar } from '../components/UnitRadar';
import {
  CONFIDENCE_LABEL,
  DEPTH_VERDICT_LABEL,
  KOREAN_AREAS,
  KOREAN_DEPTHS,
  REVISION_LABEL,
  hesitationMs,
  type ConfidenceLevel,
  type DepthVerdict,
  type RevisionKind,
} from '@/lib/korean-analysis';
import { buildKoreanSummary } from '@/lib/korean-report';
import { copyText } from '../format';
import {
  computeReportStats,
  fmtMs,
  loadLearnReport,
  pendingLearnReport,
  saveLearnReport,
  type LearnReportDoc,
  type ReportProblem,
  type ReportSection,
  type ReportSectionId,
} from '@/lib/learn-report';

/**
 * 예전에 만든 리포트에도 **나중에 생긴 섹션**을 붙여 준다 — 없으면 화면에
 * 아예 안 나와서 "왜 내 리포트에만 없지" 가 된다. 순서는 정오 분석 뒤.
 */
const ADDED_SECTIONS: ReportSection[] = [
  { id: 'conceptLeak', title: '핵심 개념 누수 진단', visible: true },
  { id: 'weakTypes', title: '취약 유형 집중 분석', visible: true },
  { id: 'difficultyBars', title: '문항별 체감 난이도', visible: true },
];

/**
 * 수학 시험지에만 있는 섹션 (027) — 단원·평가영역·행동영역 태그는 수학
 * 교재에만 인쇄돼 있어, 국어·영어·과학 리포트에서는 빈 표만 남는다.
 * 문서에 과목이 없으면(027 이전 리포트) 수학으로 읽는다.
 */
/** 내신 시험지(수학) 구역 — 옛 리포트에도 붙여 준다 (마스터 프롬프트 2026-09-05) */
const EXAM_SECTIONS: ReportSection[] = [
  { id: 'examDashboard', title: '종합 성취도 · 심리 브리핑', visible: true },
  { id: 'examPages', title: '페이지별 체력 · 집중도 흐름', visible: true },
  { id: 'examChart', title: '문항 행동 데이터 (차트용)', visible: true },
];

const MATH_ONLY_SECTIONS: ReadonlySet<ReportSectionId> = new Set([
  'competency',
  'examDashboard',
  'examPages',
  'examChart',
  'conceptLeak',
  'weakTypes',
]);

function isMathDoc(doc: { subject?: string }): boolean {
  return (doc.subject ?? '수학') === '수학';
}

/**
 * 국어 시험지에만 있는 섹션 (마스터 프롬프트 2026-09-05) — 5-Depth 성취,
 * 펜 궤적에서 읽은 행동 트렌드, 그 둘을 겹쳐 본 산점도. 정오 분석 바로 뒤.
 */
const KOREAN_SECTIONS: ReportSection[] = [
  { id: 'koreanDepth', title: '5-Depth 성취 분석', visible: true },
  { id: 'koreanBehavior', title: '행동 트렌드 분석', visible: true },
  { id: 'koreanScatter', title: '인지-행동 산점도', visible: true },
];

const KOREAN_ONLY_SECTIONS: ReadonlySet<ReportSectionId> = new Set(
  KOREAN_SECTIONS.map((x) => x.id),
);

function isKoreanDoc(doc: { subject?: string }): boolean {
  return doc.subject === '국어';
}

/** 5-Depth 판정 색 — 충족 녹색 / 부분 주황 / 미충족 빨강 / 해당 없음 회색 */
const DEPTH_VERDICT_COLOR: Record<DepthVerdict, string> = {
  met: '#2f9e44',
  partial: '#e8a33d',
  missed: '#e03131',
  na: '#d4d4d0',
};

const CONFIDENCE_COLOR: Record<ConfidenceLevel, string> = {
  high: '#2f9e44',
  medium: '#e8a33d',
  low: '#e03131',
  unknown: '#a3a3a0',
};

/** 성취률 막대 색 — 80% 이상 녹색, 50% 이상 주황, 그 아래 빨강 */
function rateColor(v: number | null): string {
  if (v == null) return '#d4d4d0';
  return v >= 80 ? '#2f9e44' : v >= 50 ? '#e8a33d' : '#e03131';
}

const REVISION_ORDER: RevisionKind[] = [
  'right_to_wrong',
  'wrong_to_right',
  'reworked',
  'none',
  'unknown',
];

/** 밸런스 분석은 **AI 과정 분석 바로 위**에 온다 (사용자 요구 2026-08-25) */
const BALANCE_SECTION: ReportSection = {
  id: 'competency',
  title: '단원 및 출제 영역별 성취 밸런스 분석',
  visible: true,
};

/**
 * 이 문항이 속한 단계 — 저장된 group 을 쓰고, 없으면 **라벨에서 읽어낸다**
 * ("1단계 3번" → "1단계"). 태그가 붙기 전에 만든 리포트도 단계로 갈리게.
 */
function groupOf(p: { group?: string; label: string }): string {
  if (p.group?.trim()) return p.group.trim();
  const m = /^(.+?)[\s-]+\d+번$/.exec(p.label.trim());
  return m ? m[1].trim() : '';
}

/** 문항 하나 + **원본 배열에서의 위치**. 라벨은 겹칠 수 있어 식별자로 못 쓴다 —
 *  단계별 시험지는 "1번" 이 단계마다 있다(실사고 2026-08-25: 수정 버튼을 누르면
 *  같은 번호의 카드가 전부 열리고, React key 중복으로 화면이 튀었다). */
type IndexedProblem = { p: ReportProblem; idx: number };

/** 숨긴 단계(hiddenStages, 예: ['3단계'])에 걸린 문항인가 — 리포트 전 구역 공통.
 *  단계 이름은 "3단계(심화)" 처럼 꼬리가 붙을 수 있어 앞자리로 견준다. */
function stageHiddenBy(hidden: readonly string[]) {
  return (p: { group?: string; label: string }): boolean => {
    if (hidden.length === 0) return false;
    const g = groupOf(p);
    return g !== '' && hidden.some((h) => g === h || g.startsWith(h));
  };
}

/** 문항을 **단계 순서대로** 묶는다 — 원래 나열 순서를 유지한다.
 *  skip 은 숨긴 단계 필터 — idx 는 **원본 배열 기준**으로 남아 편집이 안 어긋난다. */
function groupProblems(
  list: ReportProblem[],
  skip?: (p: ReportProblem) => boolean,
): Array<[string, IndexedProblem[]]> {
  const m = new Map<string, IndexedProblem[]>();
  list.forEach((p, idx) => {
    if (skip?.(p)) return;
    const g = groupOf(p);
    if (!m.has(g)) m.set(g, []);
    m.get(g)!.push({ p, idx });
  });
  return [...m.entries()];
}

function withNewSections(doc: LearnReportDoc): LearnReportDoc {
  const math = isMathDoc(doc);
  const korean = isKoreanDoc(doc);
  const have = new Set(doc.sections.map((x) => x.id));
  const missing = [
    // 국어 세 구역은 체감 난이도 **앞**에 온다 — 배열 순서가 곧 화면 순서다
    ...(korean ? KOREAN_SECTIONS.filter((x) => !have.has(x.id)) : []),
    ...(math ? EXAM_SECTIONS.filter((x) => !have.has(x.id)) : []),
    ...ADDED_SECTIONS.filter(
      (x) => !have.has(x.id) && (math || !MATH_ONLY_SECTIONS.has(x.id)),
    ),
  ];
  let sections = [...doc.sections];
  if (missing.length > 0) {
    const at = sections.findIndex((x) => x.id === 'problems');
    sections.splice(at < 0 ? sections.length : at + 1, 0, ...missing);
  }
  // 문제 난이도 폐지(2026-09-02) — 옛 리포트의 섹션 제목도 새 이름으로 접는다
  sections = sections.map((x) =>
    x.id === 'difficultyBars' ? { ...x, title: '문항별 체감 난이도' } : x,
  );
  // 밸런스 분석은 어디에 있었든 AI 과정 분석 위로 옮긴다(제목도 새 이름으로).
  // 비수학 문서에는 아예 넣지 않는다 (027).
  const cur = sections.find((x) => x.id === 'competency');
  sections = sections.filter((x) => x.id !== 'competency');
  if (math) {
    const aiAt = sections.findIndex((x) => x.id === 'aiProcess');
    sections.splice(aiAt < 0 ? 0 : aiAt, 0, {
      ...BALANCE_SECTION,
      ...(cur?.body ? { body: cur.body } : {}),
      ...(cur ? { visible: cur.visible } : {}),
    });
  }
  // 국어가 아닌 문서에는 국어 섹션을 그리지 않는다 — 교재 과목을 바꾸면
  // 옛 문서에 남아 있을 수 있다(빈 표만 남는다).
  if (!korean) {
    sections = sections.filter((x) => !KOREAN_ONLY_SECTIONS.has(x.id));
  }
  const unchanged =
    sections.length === doc.sections.length &&
    sections.every((x, i) => x.id === doc.sections[i].id && x.title === doc.sections[i].title);
  return unchanged ? doc : { ...doc, sections };
}

export function ReportPage({ publicMode = false }: { publicMode?: boolean } = {}) {
  /**
   * `publicMode` — 공유 링크(`/r/:id`)로 열린 **읽기 전용** 화면.
   *
   * 🚨 공유 화면을 따로 만들었다가 선생님이 편집한 내용(수정·순서·숨김)이
   *    반영되지 않는 사고가 났다(사용자 지적 2026-08-27). 이 링크는 학부모·학생이
   *    보는 것이라 편집 결과가 그대로 나가야 한다 — 그래서 **같은 렌더러**를 쓴다.
   *    여기서는 편집 도구만 감추고, 숨긴 섹션은 아예 그리지 않는다.
   */
  const { id } = useParams<{ id: string }>();
  const [studentId, setStudentId] = useState<string | null>(null);
  const [doc, setDoc] = useState<LearnReportDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const toast = useToast();
  const customPromptsEnabled = useSessionStore(
    (st) => Boolean(st.academy?.customPromptsEnabled),
  );
  const [promptOpen, setPromptOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    if (publicMode) {
      // 공유 링크 — 로그인 없이 읽기 전용 JSON 을 받는다
      void fetch(`/api/academy?report=${encodeURIComponent(id)}`)
        .then(async (r) => {
          const j = (await r.json().catch(() => ({}))) as {
            report?: LearnReportDoc;
            classStats?: {
              correctCounts: number[];
              students: number;
              byUnit?: Record<string, number>;
            } | null;
            error?: string;
          };
          if (!r.ok || !j.report) {
            setError(j.error ?? '리포트를 불러오지 못했습니다.');
            return;
          }
          setDoc(withNewSections(j.report));
          // 또래 비교는 **서버가 계산해 준다** — 공유 링크에는 로그인이 없어
          // 학생 목록을 못 읽는다(2026-08-27 QA).
          // 저장 스냅샷과 서버 집계를 **병합**한다 — 예전 스냅샷에는 단원 평균
          // (byUnit)이 없어서, 스냅샷만 쓰면 레이더의 평균 점선이 사라졌다
          // (2026-08-27 QA 에서 잡음).
          const snap = j.report.classStats;
          const srv = j.classStats;
          const counts = snap?.correctCounts?.length
            ? snap.correctCounts
            : (srv?.correctCounts ?? []);
          const students = snap?.correctCounts?.length
            ? snap.students
            : (srv?.students ?? 0);
          const byUnit = snap?.byUnit ?? srv?.byUnit ?? {};
          if (counts.length > 0 || Object.keys(byUnit).length > 0) {
            setClassAvg({
              byUnit,
              perceivedByLabel: {},
              students,
              setTitle: j.report.submissionTitle,
              correctCounts: counts,
              mistakeCounts: [],
              scoredStudents: students,
            });
          }
        })
        .catch(() => setError('네트워크 연결을 확인해주세요.'));
      return;
    }
    void (async () => {
      try {
        const sub = await getSubmission(id);
        if (!sub) {
          setError('제출을 찾을 수 없습니다.');
          return;
        }
        setStudentId(sub.studentId);
        const loaded = await loadLearnReport(sub.studentId, id);
        if (!loaded) {
          // 생성이 아직 도는 중일 수 있다 — 화면을 옮겨 다녀도 생성은 전역
          // 작업으로 계속되므로(runLearnReport), 여기서 그 결과를 기다린다.
          // "버튼 누르고 다른 메뉴 갔더니 리포트가 없다" 실사고(2026-08-18).
          const pending = pendingLearnReport(id);
          if (pending) {
            setDoc(withNewSections(await pending));
            return;
          }
          setError(
            '아직 생성된 리포트가 없습니다. 리뷰 화면에서 [학습분석 리포트]를 눌러 생성해주세요.',
          );
          return;
        }
        setDoc(withNewSections(loaded));
      } catch (e) {
        setError(e instanceof Error ? e.message : '리포트를 불러오지 못했습니다.');
      }
    })();
  }, [id, publicMode]);

  const stats = useMemo(() => {
    if (!doc) return null;
    const hide = stageHiddenBy(doc.hiddenStages ?? []);
    return computeReportStats(doc.problems.filter((p) => !hide(p)));
  }, [doc]);

  const patchSection = (idx: number, patch: Partial<ReportSection>) => {
    setDoc((d) => {
      if (!d) return d;
      const sections = [...d.sections];
      sections[idx] = { ...sections[idx], ...patch };
      return { ...d, sections };
    });
  };

  /** 문항 하나의 값을 고친다 — **인덱스 기준**(라벨은 겹칠 수 있다) */
  const patchProblemAt = (idx: number, patch: Partial<ReportProblem>) => {
    setDoc((d) => {
      if (!d) return d;
      return {
        ...d,
        problems: d.problems.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
      };
    });
  };

  const save = async () => {
    if (!doc || !studentId || !id || saving) return;
    setSaving(true);
    try {
      await saveLearnReport(studentId, id, doc);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  // ── PDF 저장: **화면에 보이는 리포트를 그대로** A4 PDF 파일로 ──
  // 웹뷰(PC 앱) 인쇄는 본문을 온전히 못 뽑는다(2026-08-19 사용자: "보이는
  // 리포트를 pdf나 프린트 할 수 있게 해야 해"). 그래서 인쇄 엔진에 기대지
  // 않고 본문 DOM 을 캡처해 직접 PDF 를 만든다 — 화면과 100% 동일.
  const printRef = useRef<HTMLDivElement | null>(null);
  const [exporting, setExporting] = useState(false);
  const exportPdf = async () => {
    const el = printRef.current;
    if (!el || exporting) return;
    setExporting(true);
    try {
      await save();
      // 인쇄와 같은 숨김/표시 규칙을 캡처에도 적용 (index.css .pdf-capture)
      el.classList.add('pdf-capture');
      let dataUrl: string;
      try {
        const { domToPng } = await import('modern-screenshot');
        dataUrl = await domToPng(el, { scale: 2, backgroundColor: '#ffffff' });
      } finally {
        el.classList.remove('pdf-capture');
      }
      const img = new Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error('리포트 캡처에 실패했습니다.'));
        img.src = dataUrl;
      });
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
      const pageW = 210;
      const pageH = 297;
      const margin = 8;
      const w = pageW - margin * 2;
      const h = (img.height / img.width) * w;
      const innerH = pageH - margin * 2;
      const pages = Math.max(1, Math.ceil(h / innerH));
      for (let p = 0; p < pages; p++) {
        if (p > 0) pdf.addPage();
        pdf.addImage(dataUrl, 'PNG', margin, margin - p * innerH, w, h);
        // 페이지 경계가 여백을 침범하지 않게 위·아래 여백을 흰색으로 덮는다
        pdf.setFillColor(255, 255, 255);
        pdf.rect(0, 0, pageW, margin, 'F');
        pdf.rect(0, pageH - margin, pageW, margin, 'F');
      }
      const rawName = `학습분석리포트_${doc?.studentName ?? ''}_${(doc?.submissionTitle ?? '').slice(0, 30)}`;
      const fileName =
        rawName.replace(/[\\/:*?"<>|]/g, '_').replace(/_+$/, '') + '.pdf';
      if (isDesk()) {
        // 웹뷰는 <a download> 를 처리하지 않는다 — 네이티브로 다운로드 폴더에
        // 저장하고 파인더에서 보여준다 (0.2.24 save_pdf).
        const b64 = pdf.output('datauristring').split(',')[1] ?? '';
        try {
          const path = await deskSavePdf(fileName, b64);
          toast(`PDF 저장됨 — ${path}`, 'positive');
        } catch (error) {
          toast(
            error instanceof Error ? error.message : 'PDF를 저장하지 못했습니다. 다운로드 폴더와 저장 공간을 확인해 주세요.',
            'critical',
          );
        }
      } else {
        pdf.save(fileName);
        toast('PDF 를 다운로드했습니다.', 'positive');
      }
    } catch (e) {
      toast(
        e instanceof Error ? e.message : 'PDF 저장에 실패했습니다.',
        'critical',
      );
    } finally {
      setExporting(false);
    }
  };

  // ⚠️ 훅은 **조건부 return 앞**에 전부 모아둔다. 아래 로딩·에러 분기 뒤에 두면
  // 첫 렌더(로딩)와 이후 렌더의 훅 개수가 달라져 리포트가 통째로 죽는다
  // (2026-08-17 실사고: "분석 리포트를 뽑으면 에러").
  /** 지금 인라인 수정 중인 문항 라벨 — AI 과정 요약을 직접 고칠 때 */
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  /** 역량 게이지에서 펼쳐 둔 계산 근거 (라벨) */
  const [openHint, setOpenHint] = useState<string | null>(null);
  /** 공유 링크 형태 선택 팝업 (사용자 요구 2026-08-27) */
  const [shareOpen, setShareOpen] = useState(false);
  const copyShare = (view: 'report' | 'slide') => {
    const url = `${window.location.origin}/r/${id}${view === 'slide' ? '?view=slide' : ''}`;
    void navigator.clipboard
      ?.writeText(url)
      .then(() =>
        toast(
          view === 'slide'
            ? '한 장씩 넘겨 보는 링크를 복사했습니다.'
            : '리포트 그대로 보는 링크를 복사했습니다.',
          'positive',
        ),
      )
      .catch(() => window.prompt('공유 링크', url));
    setShareOpen(false);
  };
  /** 지금 인라인 수정 중인 서술 섹션 id */
  const [editingSection, setEditingSection] = useState<string | null>(null);
  /**
   * **슬라이드 보기** — 공유 링크에 `?view=slide` 가 붙으면 섹션을 한 장씩
   * 넘겨 본다 (사용자 요구 2026-08-27: 모바일에서 넘겨 보는 구조).
   * 디자인은 그대로 두고 **보여주는 방식만** 바꾼다.
   */
  const slideMode =
    publicMode &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('view') === 'slide';
  const [slide, setSlide] = useState(0);
  /** 분석 요약에서 숨긴 칸 — **문서에 저장**해야 공유 링크에도 반영된다 */
  const hiddenStats = doc?.hiddenStats ?? [];
  const toggleStat = (key: string) =>
    setDoc((d) =>
      d
        ? {
            ...d,
            hiddenStats: (d.hiddenStats ?? []).includes(key)
              ? (d.hiddenStats ?? []).filter((x) => x !== key)
              : [...(d.hiddenStats ?? []), key],
          }
        : d,
    );
  /** 같은 시험지를 푼 **다른 학생들**의 단원별 평균 — 레이더 비교선 */
  const [classAvg, setClassAvg] = useState<ClassAverage | null>(null);
  const [avgLoading, setAvgLoading] = useState(false);
  useEffect(() => {
    if (publicMode) return; // 서버가 내려준 값을 쓴다
    if (!studentId || !doc) return;
    // 📌 **리포트에 저장된 스냅샷이 있으면 기다리지 않는다** — 열자마자 보인다
    // (사용자 요구 2026-08-27). 없을 때만 화면에서 훑는다.
    if (
      doc.classStats &&
      (doc.classStats.correctCounts.length > 0 || doc.classStats.byUnit)
    ) {
      setClassAvg({
        byUnit: doc.classStats.byUnit ?? {},
        perceivedByLabel: {},
        students: doc.classStats.students,
        setTitle: doc.submissionTitle,
        correctCounts: doc.classStats.correctCounts,
        mistakeCounts: [],
        scoredStudents: doc.classStats.students,
      });
      return;
    }
    let alive = true;
    setAvgLoading(true);
    void loadClassAverage({
      selfStudentId: studentId,
      title: doc.submissionTitle,
      listStudents: listMyStudents,
      listSubmissions: listStudentSubmissions,
    })
      .then((r) => alive && setClassAvg(r))
      .catch(() => {})
      .finally(() => alive && setAvgLoading(false));
    return () => {
      alive = false;
    };
  }, [studentId, doc?.submissionTitle, publicMode]);
  /** 끌고 있는 섹션 id — 드롭 대상 판별용 */
  const [dragId, setDragId] = useState<string | null>(null);

  if (error) {
    return (
      <div className="mx-auto w-full max-w-[1440px] space-y-4 px-3 sm:px-4">
        <Callout tone="neutral" description={error} />
        <Link to={`/t/submissions/${id}`} className="text-sm text-brand underline">
          ← 리뷰로 돌아가기
        </Link>
      </div>
    );
  }
  if (!doc || !stats) {
    return <div className="p-8 text-ink-muted">불러오는 중…</div>;
  }

  /** 체감 난이도 계산 기준 — 이 문제지 안의 활동 시간 중앙값 */
  /** 숨긴 단계 (사용자 요구 2026-09-02: "3단계는 토글로") — 문서에 저장해야
   *  공유 링크·PDF 에도 반영된다 (hiddenStats 와 같은 방식, [저장]으로 확정). */
  /** 수학 문서인가 (027) — 단원·개념 태그가 붙는 섹션·열은 수학에만 있다 */
  const mathDoc = isMathDoc(doc);
  const hiddenStages = doc.hiddenStages ?? [];
  const hideP = stageHiddenBy(hiddenStages);
  /** 숨긴 단계를 뺀 문항들 — 표·그래프·목록은 전부 이걸 쓴다 */
  const vProblems = doc.problems.filter((p) => !hideP(p));
  const hiddenProblemCount = doc.problems.length - vProblems.length;
  const docMedianActiveMs = medianActiveMs(vProblems);
  /** 정오 확정 — 정답이 아니면 무조건 틀림 (판정 불가를 화면에 남기지 않는다) */
  const vOf = (p: ReportProblem) => finalVerdict(p.verdict);

  /** 안 푼 문제 — 필기 자체가 없다(활동 0·시도 0). 정오 판정과는 다른 축이다. */
  const isUnsolved = (p: { activeMs: number; attempts: number }) =>
    p.activeMs <= 0 && p.attempts <= 0;

  /** 국어 요약 (5-Depth·행동·산점도) — 숨긴 단계를 반영해 **화면에서 다시**
   *  계산한다. 문항에 국어 값이 하나도 없는 옛 리포트만 생성 때 박아 둔 값으로
   *  물러선다. 계산 규칙은 생성 시점과 같은 함수(buildKoreanSummary)다. */
  const koreanDoc = isKoreanDoc(doc);
  const koreanSummary = !koreanDoc
    ? null
    : vProblems.some((p) => p.korean)
      ? buildKoreanSummary(
          vProblems.map((p) => ({ ...p, verdict: vOf(p) })),
        )
      : (doc.koreanSummary ?? null);

  /** 내신(수학) 요약 — 국어와 같은 규칙: 화면에서 다시 계산하고, 값이 없는 옛
   *  리포트만 생성 때 박아 둔 값으로 물러선다. */
  const examSummary = !mathDoc
    ? null
    : vProblems.length > 0
      ? buildExamSummary(vProblems.map((p) => ({ ...p, verdict: vOf(p) })))
      : (doc.examSummary ?? null);

  /** 섹션을 목표 위치로 옮긴다 (화살표 버튼 대신 드래그앤드롭) */
  const moveSectionTo = (id: string, toIdx: number) => {
    setDoc((d) => {
      if (!d) return d;
      const from = d.sections.findIndex((x) => x.id === id);
      if (from < 0 || from === toIdx) return d;
      const sections = [...d.sections];
      const [moved] = sections.splice(from, 1);
      sections.splice(toIdx, 0, moved);
      return { ...d, sections };
    });
  };

  const renderSection = (s: ReportSection, idx: number) => {
    // 숨긴 항목도 **편집 화면에는 남긴다** — 안 보이면 다시 켤 수가 없다.
    // 인쇄(PDF)에서만 빠진다(print:hidden).
    // 🚨 **공유 링크에서는 아예 그리지 않는다** — 선생님이 숨긴 것은 학부모에게
    //    보이면 안 된다(사용자 요구 2026-08-27).
    const hidden = !s.visible;
    if (publicMode && hidden) return null;
    return (
      <section
        key={s.id}
        draggable={!publicMode}
        onDragStart={(e) => {
          setDragId(s.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(e) => {
          if (dragId && dragId !== s.id) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (dragId && dragId !== s.id) moveSectionTo(dragId, idx);
          setDragId(null);
        }}
        onDragEnd={() => setDragId(null)}
        className={
          'report-section group relative mb-4 break-inside-avoid rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgba(20,20,24,0.04)] ' +
          (hidden ? 'opacity-45 print:hidden ' : '') +
          (dragId === s.id ? 'ring-2 ring-brand ' : '')
        }
      >
        {/* 편집 도구 — 인쇄·공유 링크에는 안 나온다 */}
        <div
          className={
            'mb-2 flex items-center gap-2 print:hidden' + (publicMode ? ' hidden' : '')
          }
        >
          <span
            className="cursor-grab text-ink-subtle active:cursor-grabbing"
            title="끌어서 순서 이동"
            aria-hidden
          >
            <GripVertical size={16} />
          </span>
          <button
            type="button"
            onClick={() => patchSection(idx, { visible: !s.visible })}
            className="inline-flex items-center gap-1 rounded border border-line-weak px-2 py-1 text-[11.5px] text-ink-muted hover:text-ink"
          >
            {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
            {hidden ? '숨김 — 눌러서 표시' : '숨기기'}
          </button>
          {hidden && (
            <span className="text-[11.5px] text-critical">
              PDF 에는 나오지 않습니다
            </span>
          )}
        </div>
        <h2 className="mb-3 text-[15px] font-bold text-[#19191c]">{s.title}</h2>
        {s.id === 'stats' && (() => {
          /* 분석 요약 (사용자 재정의 2026-08-27):
             평균 난이도(시험지 전 문항 AI 판정) / 내 평균 체감 / 석차(동점 포함) /
             맞은 개수 / 평균 맞은 개수 / 표준편차 / 본인·평균 실수 문제수.
             정답률은 뺐다(요청). 또래 비교 수치는 **같은 시험지를 푼 다른 학생의
             리포트**에서만 나온다 — 자료가 없으면 "자료 없음" 으로 두고 지어내지 않는다.
             각 칸은 눈 아이콘으로 **개별로 숨길 수 있다.** */
          const nums = vProblems;
          const avgFelt =
            nums.length > 0
              ? nums.reduce(
                  (a, p) =>
                    a +
                    perceivedDifficulty10(
                      {
                        verdict: p.verdict,
                        attempts: p.attempts,
                        revisits: p.revisits,
                        activeMs: p.activeMs,
                      },
                      { medianActiveMs: docMedianActiveMs },
                    ),
                  0,
                ) / nums.length
              : 0;
          const myCorrect = nums.filter((p) => vOf(p) === 'correct').length;
          const myMistake = nums.filter((p) => p.mistake).length;
          const others = classAvg?.correctCounts ?? [];
          const mean = (xs: number[]) =>
            xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
          const stdev = (xs: number[]) => {
            if (xs.length < 2) return null;
            const m = xs.reduce((a, b) => a + b, 0) / xs.length;
            return Math.sqrt(
              xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length,
            );
          };
          // 석차 — 본인을 포함한 전체에서 몇 등인가. 동점자 수도 함께 센다.
          const all = [...others, myCorrect];
          const better = all.filter((x) => x > myCorrect).length;
          const tied = all.filter((x) => x === myCorrect).length;
          const avgCorrect = mean(others.concat(myCorrect));
          const sd = stdev(others.concat(myCorrect));
          const avgMistake = mean(
            (classAvg?.mistakeCounts ?? []).concat(myMistake),
          );
          const f2 = (n: number | null) => (n == null ? '자료 없음' : n.toFixed(2));
          const cells: Array<{ key: string; icon: string; color: string; label: string; value: string; note?: string }> = [
            {
              key: 'total',
              icon: '#',
              color: '#f5a524',
              label: '문제지 전체 문항',
              value: `${Math.max(0, (doc.totalProblems ?? stats.total) - hiddenProblemCount)} 문제`,
            },
            {
              key: 'avgFelt',
              icon: '心',
              color: '#e03131',
              label: '학생 평균 체감 난이도',
              // 숫자 대신 네 단어 라벨 (사용자 2026-09-02)
              value: nums.length > 0 ? difficultyBand(avgFelt) : '자료 없음',
              note: '펜 데이터로 계산한 문항별 체감의 평균',
            },
            {
              key: 'rank',
              icon: '#',
              color: '#1c5fb8',
              label: '석차',
              value:
                others.length > 0
                  ? `${better + 1}등 / ${all.length}명`
                  : '자료 없음',
              note:
                others.length > 0
                  ? tied > 1
                    ? `같은 개수 ${tied}명(동점) · 채점 완료 기준`
                    : '동점 없음 · 채점 완료 기준'
                  : '이 시험지를 푼 다른 학생의 채점 결과가 아직 없습니다',
            },
            {
              key: 'correct',
              icon: '○',
              color: '#ff5a5a',
              label: '맞은 개수',
              value: `${myCorrect}개 / ${doc.totalProblems ?? stats.total}개`,
            },
            {
              key: 'avgCorrect',
              icon: 'μ',
              color: '#00b06a',
              // 평균과 표준편차는 **함께 읽어야** 뜻이 산다 (사용자 요구 2026-08-27)
              label: '평균 맞은 개수 / 표준편차',
              value: `${f2(avgCorrect)} / ${f2(sd)}`,
              note:
                others.length > 0
                  ? `채점이 끝난 ${all.length}명 기준 · 표준편차는 흩어짐`
                  : '자료 없음',
            },
            {
              key: 'mistake',
              icon: '!',
              color: '#b45309',
              label: '실수 문제수 (본인 / 평균)',
              value: `${myMistake}개 / ${f2(avgMistake)}`,
              note:
                (classAvg?.mistakeCounts.length ?? 0) > 0
                  ? '풀이는 됐는데 최종 답이 틀린 문항 · 평균은 리포트가 만들어진 학생 기준'
                  : '풀이는 됐는데 최종 답이 틀린 문항',
            },
          ];
          return (
            // 칸 수가 열 수로 딱 나뉘지 않으면 마지막 줄이 비어 보인다 →
            // **가변 폭**으로 남는 자리를 채운다 (사용자 요구 2026-08-27).
            <div className="flex flex-wrap gap-px overflow-hidden rounded-xl bg-[#e6ebf7]">
              {cells
                .filter((c) => !(publicMode && hiddenStats.includes(c.key)))
                .map((c) => {
                const off = hiddenStats.includes(c.key);
                return (
                  <div
                    key={c.key}
                    className={
                      // 📱 모바일(슬라이드 포함)은 **상하 1단** — 150px 2단으로
                      // 두면 "평균 맞은 개수 / 표준편차" 같은 라벨이 깨진다
                      // (사용자 지적 2026-08-27).
                      'bg-white p-3.5 ' +
                      (slideMode
                        ? 'w-full basis-full'
                        : 'w-full basis-full sm:min-w-[170px] sm:flex-1 sm:basis-[190px]')
                    }
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] text-[11px] font-bold text-white"
                        style={{ background: c.color }}
                        aria-hidden
                      >
                        {c.icon}
                      </span>
                      <span className="min-w-0 flex-1 text-[11.5px] leading-tight text-[#797988]">
                        {c.label}
                      </span>
                      <button
                        type="button"
                        aria-label={off ? '보이기' : '숨기기'}
                        onClick={() => toggleStat(c.key)}
                        className={
                          'shrink-0 text-[11px] text-[#a8a8b0] hover:text-ink print:hidden' +
                          (publicMode ? ' hidden' : '')
                        }
                      >
                        {off ? '보이기' : '숨기기'}
                      </button>
                    </div>
                    {off ? (
                      <div className="mt-3 text-right text-[12px] text-[#c4c4cc] print:hidden">
                        숨김
                      </div>
                    ) : (
                      <>
                        <div className="mt-3 text-right text-[17px] font-bold text-[#19191c]">
                          {c.value}
                        </div>

                      </>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}

        {s.id === 'problems' && (
          /* 문제별 정오 분석표 (사용자 요구 2026-08-25) —
             문항-번호 / 단원 / 정오 / 체감 난이도 / 시도 횟수 다섯 칸.
             종전의 찍은·실수·시도횟수·풀이시간 목록과 가로 표는 걷어냈다:
             같은 수치가 네 군데 흩어져 있어 읽히지 않았다. */
          <div>
            {/* 📱 모바일은 **카드**로 — 표를 가로로 밀게 하지 않는다
                (사용자 요구 2026-08-27). sm 이상에서는 표 그대로. */}
            <div className={slideMode ? 'space-y-2' : 'space-y-2 sm:hidden'}>
              {groupProblems(doc.problems, hideP).map(([g, list]) => (
                <div key={g || '_'} className="space-y-2">
                  {g && (
                    <div className="flex items-center gap-2 pt-1">
                      <span className="rounded bg-[#19191c] px-2 py-0.5 text-[11px] font-bold text-white">
                        {g}
                      </span>
                      <span className="text-[11px] text-[#797988]">
                        {list.length}문항
                      </span>
                    </div>
                  )}
                  {list.map(({ p, idx: i }) => {
                    const felt = perceivedDifficulty10(
                      {
                        verdict: p.verdict,
                        attempts: p.attempts,
                        revisits: p.revisits,
                        activeMs: p.activeMs,
                      },
                      { medianActiveMs: docMedianActiveMs },
                    );
                    return (
                      <div
                        key={i}
                        className="rounded-xl border border-[#e8e8e4] p-3 text-[12.5px]"
                      >
                        <div className="flex items-center gap-2">
                          <b className="text-[13px] text-[#19191c]">{p.label}</b>
                          <span
                            className={
                              'text-[15px] font-bold ' +
                              (vOf(p) === 'correct'
                                ? 'text-[#1a7f37]'
                                : 'text-[#e03131]')
                            }
                          >
                            {vOf(p) === 'correct' ? '○' : '✕'}
                          </span>
                          {isUnsolved(p) && (
                            <span className="text-[10.5px] text-[#a8a8b0]">미응시</span>
                          )}
                          <span
                            className="ml-auto rounded px-1.5 py-0.5 text-[11px] font-bold text-white"
                            style={{ background: BAND_COLOR[difficultyBand(felt)] }}
                          >
                            체감 {difficultyBand(felt)}
                          </span>
                        </div>
                        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11.5px]">
                          {/* 단원·핵심 개념은 **수학 시험지에만** 인쇄돼 있다 (027) */}
                          {mathDoc && (
                            <>
                              <dt className="text-[#797988]">단원</dt>
                              <dd className="text-[#313138]">
                                {p.unit || '—'}
                                {p.subUnit && (
                                  <span className="text-[#797988]"> · {p.subUnit}</span>
                                )}
                              </dd>
                              <dt className="text-[#797988]">핵심 개념</dt>
                              <dd className="text-[#313138]">{p.concept || '—'}</dd>
                            </>
                          )}
                          <dt className="text-[#797988]">시도</dt>
                          <dd className="text-[#313138]">
                            {p.attempts}회 · {fmtMs(p.activeMs)}
                          </dd>
                        </dl>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <div
              className={
                slideMode ? 'hidden' : 'hidden overflow-x-auto sm:block'
              }
            >
            <table className="w-full min-w-[520px] border-collapse text-[12.5px]">
              <thead>
                <tr>
                  {[
                    '문항-번호',
                    // 단원·핵심 개념은 수학 전용 태그 — 비수학이면 열을 뺀다 (027)
                    ...(mathDoc ? ['단원', '핵심 개념'] : []),
                    '정오',
                    '체감 난이도',
                    '시도 횟수',
                  ].map(
                    (h) => (
                      <th
                        key={h}
                        className="border border-[#e8e8e4] bg-[#fafafa] p-2 text-[11.5px] font-medium text-[#797988]"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {/* 단계가 있는 문제지는 표에서도 갈라 준다 — AI 과정 분석과
                    같은 묶음이어야 두 섹션이 어긋나 보이지 않는다. */}
                {groupProblems(doc.problems, hideP).flatMap(([g, list]) => [
                  ...(g
                    ? [
                        <tr key={`g-${g}`}>
                          <td
                            colSpan={mathDoc ? 6 : 4}
                            className="border border-[#e8e8e4] bg-[#f1f1ef] px-2 py-1.5 text-[11.5px] font-bold text-[#19191c]"
                          >
                            {g}
                            <span className="ml-1.5 font-normal text-[#797988]">
                              {list.length}문항
                            </span>
                          </td>
                        </tr>,
                      ]
                    : []),
                  ...list.map(({ p, idx }) => {
                  const unsolved = isUnsolved(p);
                  return (
                    <tr key={idx}>
                      <td
                        className={
                          'border border-[#e8e8e4] p-2 font-bold ' +
                          (unsolved ? 'text-[#a8a8b0]' : 'text-[#19191c]')
                        }
                      >
                        {p.label}
                      </td>
                      {mathDoc && (
                        <>
                          <td className="border border-[#e8e8e4] p-2 text-[#313138]">
                            {p.unit || '—'}
                            {/* 단원의 세부내용 — 있는 시험지에서만 (사용자 2026-08-25) */}
                            {p.subUnit && (
                              <div className="text-[11px] text-[#797988]">
                                {p.subUnit}
                              </div>
                            )}
                          </td>
                          <td className="border border-[#e8e8e4] p-2 text-[#313138]">
                            {p.concept || '—'}
                          </td>
                        </>
                      )}
                      <td className="border border-[#e8e8e4] p-2 text-center">
                        {/* 판정 불가를 화면에 남기지 않는다 — 정답이 아니면 틀림.
                            손도 안 댄 문항은 ✕ 옆에 "미응시" 로만 구분한다. */}
                        <span
                          className={
                            vOf(p) === 'correct'
                              ? 'text-[15px] font-bold text-[#1a7f37]'
                              : 'text-[15px] font-bold text-[#e03131]'
                          }
                        >
                          {vOf(p) === 'correct' ? '○' : '✕'}
                        </span>
                        {unsolved && (
                          <div className="text-[10px] text-[#a8a8b0]">미응시</div>
                        )}
                      </td>
                      {/* 체감 난이도는 **펜 데이터로만** 계산한다 — 예전에는 AI 가
                          매긴 4단계를 그대로 썼다(사용자 확인 2026-08-26).
                          문제 난이도(AI 판정) 열은 뺐다 (사용자 2026-09-02). */}
                      <td
                        className="border border-[#e8e8e4] p-2 text-center font-bold"
                        style={{
                          color:
                            BAND_COLOR[
                              difficultyBand(
                                perceivedDifficulty10(
                                  {
                                    verdict: p.verdict,
                                    attempts: p.attempts,
                                    revisits: p.revisits,
                                    activeMs: p.activeMs,
                                  },
                                  { medianActiveMs: docMedianActiveMs },
                                ),
                              )
                            ],
                        }}
                        title={perceivedWhy(
                          {
                            verdict: p.verdict,
                            attempts: p.attempts,
                            revisits: p.revisits,
                            activeMs: p.activeMs,
                          },
                          { medianActiveMs: docMedianActiveMs },
                        )}
                      >
                        {difficultyBand(
                          perceivedDifficulty10(
                            {
                              verdict: p.verdict,
                              attempts: p.attempts,
                              revisits: p.revisits,
                              activeMs: p.activeMs,
                            },
                            { medianActiveMs: docMedianActiveMs },
                          ),
                        )}
                      </td>
                      <td
                        className="border border-[#e8e8e4] p-2 text-center text-[#313138]"
                        title={`펜 데이터: 실제 필기 ${fmtMs(p.activeMs)} · 복귀 ${p.revisits}회`}
                      >
                        {p.attempts}회
                      </td>
                    </tr>
                  );
                  }),
                ])}
              </tbody>
            </table>
            </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-[#797988]">
                <b>정오</b> = 채점 결과(정답지가 있으면 정답지 기준) ·{' '}
                <b>체감 난이도</b> = <b className="text-ink">펜 데이터</b>로 계산한
                쉬움·보통·어려움·매우 어려움 (정오 + 시도 횟수 + 다른 문제 풀다
                복귀 + 실제 필기 시간) ·{' '}
                <b>시도 횟수</b> = 8초 이상 손을 뗀 것을 경계로 나눈{' '}
                <b className="text-ink">실제 필기 구간 수</b>. 숫자에 마우스를 올리면
                계산 근거가 보입니다.
              </p>
          </div>
        )}
        {/* ── 단원·영역 축을 맞춘 세 섹션 (사용자 요구 2026-08-25) ──
            문항 인식이 읽어낸 단원·핵심 개념·평가 영역·행동 영역을 근거로 그린다.
            ⚠️ 학원 평균·백분위·문항별 전체 정답률은 **다른 학생들의 결과를 모아야**
            나오는 값이라 여기서는 이 학생 것만 그린다. */}
        {s.id === 'competency' && (() => {
          /* 단원 및 출제 영역별 성취 밸런스 (첨부 리포트 슬라이드 02, 2026-08-25):
             ① 단원별 레이더 ② 출제 영역별 세부 역량 득점력 ③ 진단 코멘트.
             ⚠️ '학원 평균' 점선은 다른 학생 결과를 모아야 그릴 수 있어 아직 없다. */
          const rate = (list: ReportProblem[]) => {
            const judged = list.filter(
              () => true,
            );
            if (judged.length === 0) return null;
            return Math.round(
              (judged.filter((p) => vOf(p) === 'correct').length /
                judged.length) *
                100,
            );
          };
          const EVAL_AREAS = ['개념 이해 및 접근력', '종합 응용 및 추론력'];
          const BEHAVIORS = ['이해력', '계산력', '추론력', '문제해결력'];
          const units = [
            ...new Set(vProblems.map((p) => p.unit).filter(Boolean)),
          ] as string[];
          const unitAxes = units
            .map((u) => ({ label: u, value: rate(vProblems.filter((p) => p.unit === u)) }))
            .filter((a): a is { label: string; value: number } => a.value != null);
          const evalScores = EVAL_AREAS.map((a) => ({
            label: a,
            value: rate(vProblems.filter((p) => p.evalArea === a)),
          }));
          const behaviorScores = BEHAVIORS.map((b) => ({
            label: b,
            value: rate(vProblems.filter((p) => p.behaviorArea === b)),
          }));
          const tagged = unitAxes.length > 0 || evalScores.some((e) => e.value != null);
          if (!tagged) {
            return (
              <p className="text-[13px] text-ink-muted">
                이 리포트에는 단원·역량 태그가 없습니다 — 문제지를 [다시 인식]한
                뒤 리포트를 다시 만들면 채워집니다.
              </p>
            );
          }
          /** 진단 코멘트 — **수치에서 바로 나오는 문장만** 쓴다(추측 금지).
              선생님이 고쳐 쓸 수 있게 편집 가능한 본문(body)이 있으면 그것이 우선. */
          const auto = (() => {
            const parts: string[] = [];
            for (const e of evalScores) {
              if (e.value != null) parts.push(`${e.label} ${e.value}%`);
            }
            const head = parts.length > 0 ? `${parts.join(', ')}입니다.` : '';
            const sorted = unitAxes.slice().sort((a, b) => a.value - b.value);
            const weak = sorted[0];
            const strong = sorted[sorted.length - 1];
            const body =
              unitAxes.length >= 2 && weak && strong && weak.label !== strong.label
                ? ` 단원 중에서는 ${strong.label}(${strong.value}%)이 가장 높고 ${weak.label}(${weak.value}%)이 가장 낮습니다.`
                : '';
            const gap =
              evalScores[0].value != null && evalScores[1].value != null
                ? evalScores[0].value - evalScores[1].value >= 15
                  ? ' 개념은 잡혀 있으나 여러 개념을 엮는 문항에서 점수가 떨어집니다.'
                  : evalScores[1].value - evalScores[0].value >= 15
                    ? ' 응용은 되는데 기본 개념 문항에서 실점이 있습니다.'
                    : ' 두 영역의 득점력이 비슷합니다.'
                : '';
            return `${head}${body}${gap}`.trim();
          })();
          /** 이 지표가 **어떤 문항에서 나왔는지** — 마우스를 올리면 근거가 보인다
           *  (사용자 요구 2026-08-25: "무슨 데이터인지 도저히 모르겠다"). */
          /**
           * 이 지표가 **무엇을 재는가** — 문항 번호를 늘어놓지 않고
           * "학생이 무엇을 했을 때 이 점수가 되는가" 로 설명한다
           * (사용자 요구 2026-08-27: 분류 근거가 애매하다).
           */
          const AREA_MEANS: Record<string, string> = {
            '개념 이해 및 접근력':
              '한 개념만 알면 바로 식이 서는 문항들입니다. 여기서 점수가 낮으면 문제를 읽고 무엇을 묻는지 잡아내는 단계에서 막힌 것입니다 — 풀이를 시작하지 못했거나, 시작은 했는데 엉뚱한 식을 세운 경우가 여기 모입니다.',
            '종합 응용 및 추론력':
              '여러 개념을 엮거나 조건을 해석해야 풀리는 문항들입니다. 여기서 점수가 낮으면 기본은 되는데 조건을 조합하는 데서 무너진 것입니다 — 중간까지 풀고 멈추거나, 조건 하나를 빠뜨린 경우가 여기 모입니다.',
            이해력:
              '개념의 뜻을 아는지 묻는 문항입니다. 낮으면 정의·용어를 정확히 알지 못한 채 감으로 답한 것입니다.',
            계산력:
              '계산을 정확히 수행하는지 보는 문항입니다. 낮으면 방향은 맞는데 계산·부호·자릿수에서 틀린 것입니다.',
            추론력:
              '논리를 단계적으로 전개하는 문항입니다. 낮으면 한 단계씩 잇는 도중에 근거 없이 건너뛴 것입니다.',
            문제해결력:
              '상황을 식으로 옮겨 끝까지 밀고 가는 문항입니다. 낮으면 무엇을 구해야 하는지는 알아도 식으로 옮기지 못한 것입니다.',
          };
          const why = (label: string, list: ReportProblem[]) => {
            const judged = list;
            const head = AREA_MEANS[label] ?? '';
            if (judged.length === 0) {
              return `${head}\n\n이번 시험지에는 이 영역으로 분류된 문항이 없어 점수가 나오지 않습니다.`;
            }
            const ok = judged.filter((p) => vOf(p) === 'correct').length;
            const wrongList = judged.filter((p) => vOf(p) !== 'correct');
            const mistakes = wrongList.filter((p) => p.mistake).length;
            const untouched = wrongList.filter(
              (p) => p.activeMs <= 0 && p.attempts <= 0,
            ).length;
            const struggled = wrongList.filter((p) => p.attempts >= 2).length;
            const detail = [
              `이 영역 ${judged.length}문항 중 ${ok}문항을 맞혔습니다 (${Math.round((ok / judged.length) * 100)}%).`,
              wrongList.length === 0
                ? '틀린 문항이 없습니다.'
                : [
                    `틀린 ${wrongList.length}문항을 보면`,
                    untouched > 0 ? `${untouched}문항은 손도 대지 못했고` : '',
                    struggled > 0 ? `${struggled}문항은 두 번 이상 고쳐 쓰며 헤맸으며` : '',
                    mistakes > 0 ? `${mistakes}문항은 풀이는 됐는데 마지막 답에서 틀렸습니다` : '',
                  ]
                    .filter(Boolean)
                    .join(', ')
                    .replace(/,\s*$/, '') + '.',
            ].join(' ');
            return `${head}\n\n${detail}`;
          };
          const Gauge = ({
            label,
            value,
            hint,
          }: {
            label: string;
            value: number | null;
            hint?: string;
          }) => (
            <div className="text-[12.5px]">
            <div className="flex items-center gap-3">
              <div className="flex w-32 shrink-0 items-center gap-1 font-semibold text-[#19191c]">
                <span className="min-w-0 truncate">{label}</span>
                {hint && (
                  <button
                    type="button"
                    aria-label={`${label} 계산 근거`}
                    onClick={() => setOpenHint(openHint === label ? null : label)}
                    className={
                      'shrink-0 rounded-full border px-1 text-[10px] leading-4 ' +
                      (openHint === label
                        ? 'border-brand bg-brand-weak text-brand'
                        : 'border-line-solid text-ink-subtle hover:text-ink')
                    }
                  >
                    ?
                  </button>
                )}
              </div>
              <div className="h-3 flex-1 rounded-full bg-[#eeeeec]">
                <div
                  className="h-full rounded-full bg-[#e03131]"
                  style={{ width: `${value ?? 0}%` }}
                />
              </div>
              <div className="w-12 shrink-0 text-right font-bold text-[#19191c]">
                {value == null ? '—' : `${value}%`}
              </div>
            </div>
            {/* 근거는 **눌러서 펼친다** — title 툴팁은 좁아서 안 보인다는
                지적(2026-08-26). 인쇄에는 나가지 않는다. */}
            {hint && openHint === label && (
              <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-[#f1f1ef] p-2 text-[11px] leading-relaxed text-[#313138] print:hidden">
                {humanizeSeconds(hint)}
              </pre>
            )}
            </div>
          );
          return (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-[#e8e8e4] p-4">
                <div className="mb-2 text-[12.5px] font-bold text-[#19191c]">
                  단원별 성취도
                </div>
                {unitAxes.length >= 3 ? (
                  <UnitRadar
                    axes={unitAxes.map((a) => ({
                      ...a,
                      avg: classAvg?.byUnit[a.label] ?? null,
                    }))}
                  />
                ) : (
                  <div className="space-y-1.5">
                    {unitAxes.length === 0 ? (
                      <p className="text-[12.5px] text-ink-muted">
                        단원 태그가 없습니다.
                      </p>
                    ) : (
                      unitAxes.map((a) => (
                        <Gauge
                          key={a.label}
                          label={a.label}
                          value={a.value}
                          hint={why(
                            a.label,
                            vProblems.filter((p) => p.unit === a.label),
                          )}
                        />
                      ))
                    )}
                  </div>
                )}
                {unitAxes.length > 0 && unitAxes.length < 3 && (
                  <p className="mt-2 text-[11px] text-ink-subtle">
                    단원이 3개 이상이어야 레이더로 그립니다.
                  </p>
                )}
                <p className="mt-2 text-[11px] leading-relaxed text-ink-subtle">
                  {avgLoading ? (
                    '같은 시험지를 푼 다른 학생들의 평균을 모으는 중…'
                  ) : classAvg ? (
                    <>
                      <b className="text-ink">점선 = 평균</b> — 같은 시험지(
                      {classAvg.setTitle})를 푼 다른 학생 {classAvg.students}명의
                      단원별 정답률입니다. 리포트가 만들어진 학생만 들어갑니다.
                    </>
                  ) : (
                    '비교할 평균이 아직 없습니다 — 같은 시험지를 푼 다른 학생의 리포트가 만들어지면 점선으로 겹쳐 보입니다.'
                  )}
                </p>
              </div>
              <div className="space-y-4">
                <div className="rounded-2xl border border-[#e8e8e4] p-4">
                  <div className="mb-2 text-[12.5px] font-bold text-[#19191c]">
                    출제 영역별 세부 역량 득점력
                  </div>
                  <div className="space-y-1.5">
                    {evalScores.map((e) => (
                      <Gauge
                        key={e.label}
                        label={e.label}
                        value={e.value}
                        hint={why(
                          e.label,
                          vProblems.filter((p) => p.evalArea === e.label),
                        )}
                      />
                    ))}
                  </div>
                  <div className="mt-3 space-y-1.5 border-t border-[#e8e8e4] pt-3">
                    {behaviorScores.map((b) => (
                      <Gauge
                        key={b.label}
                        label={b.label}
                        value={b.value}
                        hint={why(
                          b.label,
                          vProblems.filter((p) => p.behaviorArea === b.label),
                        )}
                      />
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-ink-subtle">
                    각 항목의 <b>ⓘ</b> 에 마우스를 올리면 어떤 문항으로 계산했는지
                    보입니다. 값은 <b>그 영역 문항의 정답률</b>이고, 채점된 문항이
                    없으면 "—" 입니다.
                  </p>
                </div>
                <div className="rounded-2xl bg-[#f7f7f6] p-4">
                  <div className="mb-1 text-[12.5px] font-bold text-[#e03131]">
                    [데이터 진단 코멘트]
                  </div>
                  {/* 공유 링크·인쇄에서는 **글만** 보여준다 — 학부모 화면에
                      입력칸이 뜨면 안 된다(2026-08-27 QA 에서 잡음). */}
                  {!publicMode && (
                    <textarea
                      value={humanizeSeconds(s.body ?? auto)}
                      onChange={(e) =>
                        patchSection(idx, { body: e.currentTarget.value })
                      }
                      className="min-h-24 w-full resize-y rounded-lg border border-line-weak bg-white p-2.5 text-[12.5px] leading-relaxed text-ink outline-none focus:border-brand print:hidden"
                    />
                  )}
                  <p
                    className={
                      'whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink print:block ' +
                      (publicMode ? '' : 'hidden')
                    }
                  >
                    {humanizeSeconds(s.body ?? auto)}
                  </p>
                </div>
              </div>
            </div>
          );
        })()}
        {s.id === 'conceptLeak' && (() => {
          // 틀린 문항의 단원 + 핵심 개념 — "무엇이 새고 있나" 만 본다
          const leaks = vProblems.filter(
            (p) => vOf(p) === 'wrong' && (p.concept || p.unit),
          );
          /** 어떤 기준으로 뽑았는지 — 제목 밑에 밝힌다 (사용자 요구 2026-08-26) */
          const policy = (
            <p className="mb-2 text-[11.5px] leading-relaxed text-[#797988]">
              <b className="text-ink">판단 기준</b> — 이 문제지에서{' '}
              <b className="text-ink">틀린 문항</b>(정답이 아닌 것 전부, 미응시 포함)
              을 모아, 문항 인식이 읽어낸 <b className="text-ink">단원·핵심 개념</b>
              으로 묶어 보여줍니다. 맞은 문항은 들어가지 않고, 개념·단원을 못 읽은
              문항은 제외됩니다. 각 항목의 근거(시도·필기 시간·복귀·체감)는 카드
              안에 함께 적습니다.
            </p>
          );
          if (leaks.length === 0) {
            return (
              <>
                {policy}
                <p className="text-[13px] text-ink-muted">
                  틀린 문항에서 잡힌 개념 누수가 없습니다.
                </p>
              </>
            );
          }
          return (
            <>
            {policy}
            <div className="grid gap-2 sm:grid-cols-2">
              {/* 선생님은 **몇 단계 몇 번**을 먼저 찾는다 — 번호가 메인,
                  개념·단원은 그 밑의 설명이다 (사용자 요구 2026-08-26). */}
              {leaks.map((p, i) => (
                <div
                  key={`${p.label}-${i}`}
                  className="border-l-[3px] border-[#e03131] bg-[#f7f7f6] px-3 py-2"
                >
                  <div className="text-[13.5px] font-bold text-[#19191c]">
                    {p.label}
                  </div>
                  <div className="mt-0.5 text-[12px] text-[#313138]">
                    {p.concept || '핵심 개념 미상'}
                  </div>
                  <div className="text-[11px] text-[#797988]">
                    {p.unit || '단원 미상'}
                    {p.subUnit ? ` · ${p.subUnit}` : ''}
                  </div>
                  {/* **왜 누수로 잡혔는지** — 근거 없이 목록만 주면 못 믿는다
                      (사용자 요구 2026-08-26). 채점 결과 + 펜 데이터로만 쓴다. */}
                  <div className="mt-1 border-t border-[#e8e8e4] pt-1 text-[11px] leading-relaxed text-[#8a5a1c]">
                    틀린 문항입니다 — 시도 {p.attempts}회 ·{' '}
                    {fmtMs(p.activeMs)}
                    {p.revisits > 0 && ` · 다른 문제 풀다 ${p.revisits}회 복귀`} ·
                    체감{' '}
                    {perceivedDifficulty10(
                      {
                        verdict: p.verdict,
                        attempts: p.attempts,
                        revisits: p.revisits,
                        activeMs: p.activeMs,
                      },
                      { medianActiveMs: docMedianActiveMs },
                    )}
                    /10
                    {(p.processEdited ?? p.process) && (
                      <div className="mt-0.5 text-[#797988]">
                        {(p.processEdited ?? p.process ?? '').slice(0, 80)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            </>
          );
        })()}
        {s.id === 'weakTypes' && (() => {
          // 취약 유형 = 틀렸거나 판정 못 한 문항. 어려운 것부터 위로.
          // 정렬 기준을 **펜 데이터(체감 난이도)** 로 바꿨다 — 예전에는 AI 가 매긴
          // 4단계로 줄을 세워 "실제로 헤맨 문항" 이 뒤로 밀렸다 (2026-08-26).
          const feltOf = (p: ReportProblem) =>
            perceivedDifficulty10(
              {
                verdict: p.verdict,
                attempts: p.attempts,
                revisits: p.revisits,
                activeMs: p.activeMs,
              },
              { medianActiveMs: docMedianActiveMs },
            );
          const weak = vProblems
            .filter((p) => vOf(p) === 'wrong')
            .sort((a, b) => feltOf(b) - feltOf(a) || b.attempts - a.attempts);
          /** 어떤 기준으로 뽑았는지 — 제목 밑에 밝힌다 (사용자 요구 2026-08-26) */
          const policy = (
            <p className="mb-2 text-[11.5px] leading-relaxed text-[#797988]">
              <b className="text-ink">선정 기준</b> — 이 문제지에서{' '}
              <b className="text-ink">틀린 문항</b>(정답이 아닌 것 전부, 미응시 포함)
              만 모아 <b className="text-ink">체감 난이도가 높은 순</b>으로 줄을
              세웁니다. 체감 난이도는 AI 판단이 아니라{' '}
              <b className="text-ink">펜 데이터</b>(정오 · 시도 횟수 · 다른 문제 풀다
              복귀 · 실제 필기 시간)로 계산하므로, 같은 오답이라도{' '}
              <b className="text-ink">실제로 오래 헤맨 문항이 위</b>로 옵니다.
              동점이면 시도 횟수가 많은 쪽이 먼저입니다.
            </p>
          );
          if (weak.length === 0) {
            return (
              <>
                {policy}
                <p className="text-[13px] text-ink-muted">
                  전 문항을 맞혔습니다 — 취약 유형이 없습니다.
                </p>
              </>
            );
          }
          return (
            <>
            {policy}
            {/* 📱 모바일은 카드 — 가로 스크롤을 만들지 않는다 (2026-08-27) */}
            <div className={slideMode ? 'space-y-2' : 'space-y-2 sm:hidden'}>
              {weak.map((p, i) => (
                <div
                  key={`${p.label}-${i}`}
                  className="rounded-xl border border-[#e8e8e4] p-3 text-[12.5px]"
                >
                  <div className="flex items-center gap-2">
                    <b className="text-[13px] text-[#e03131]">{p.label}</b>
                    <span
                      className="ml-auto rounded px-1.5 py-0.5 text-[11px] font-bold text-white"
                      style={{ background: BAND_COLOR[difficultyBand(feltOf(p))] }}
                    >
                      체감 {feltOf(p)} · {difficultyBand(feltOf(p))}
                    </span>
                  </div>
                  <div className="mt-1 font-semibold text-[#19191c]">
                    {p.concept || '—'}
                  </div>
                  <div className="text-[11.5px] text-[#797988]">
                    {p.unit || '단원 미상'}
                    {p.subUnit ? ` · ${p.subUnit}` : ''}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {p.evalArea && (
                      <span
                        className={
                          'inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold ' +
                          (p.evalArea.startsWith('종합')
                            ? 'bg-[#fff3e6] text-[#b45309]'
                            : 'bg-[#e9f2ff] text-[#1c5fb8]')
                        }
                      >
                        {p.evalArea}
                      </span>
                    )}
                    {p.behaviorArea && (
                      <span className="inline-block rounded bg-[#f1f1ef] px-1.5 py-0.5 text-[11px] text-[#313138]">
                        {p.behaviorArea}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-[11px] text-[#797988]">
                    시도 {p.attempts}회 · {fmtMs(p.activeMs)}
                    {p.revisits > 0 && ` · 복귀 ${p.revisits}회`}
                  </div>
                </div>
              ))}
            </div>
            <div
              className={
                slideMode ? 'hidden' : 'hidden overflow-x-auto sm:block'
              }
            >
              <table className="w-full min-w-[760px] table-fixed border-collapse text-left text-[12.5px]">
                <colgroup>
                  <col className="w-[15%]" />
                  <col className="w-[13%]" />
                  <col className="w-[26%]" />
                  <col className="w-[15%]" />
                  <col className="w-[11%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                </colgroup>
                <thead>
                  <tr className="border-b-2 border-[#19191c] text-[11.5px] text-[#797988]">
                    <th className="py-2 pr-2">문항</th>
                    <th className="py-2 pr-2">단원명</th>
                    <th className="py-2 pr-2">핵심 개념</th>
                    <th className="py-2 pr-2">평가 영역</th>
                    <th className="py-2 pr-2">행동 영역</th>
                    <th className="py-2 pr-2">체감 난이도</th>
                    <th className="py-2">펜 데이터</th>
                  </tr>
                </thead>
                <tbody>
                  {weak.map((p, i) => (
                    <tr key={`${p.label}-${i}`} className="border-b border-[#e8e8e4]">
                      <td className="py-2 pr-2 align-top font-bold leading-snug text-[#e03131]">
                        {p.label}
                      </td>
                      <td className="py-2 pr-2 text-[#313138]">
                        {p.unit || '—'}
                        {p.subUnit && (
                          <div className="text-[11px] text-[#797988]">{p.subUnit}</div>
                        )}
                      </td>
                      <td className="py-2 pr-2 align-top font-semibold leading-snug text-[#19191c]">
                        {p.concept || '—'}
                      </td>
                      <td className="py-2 pr-2 align-top">
                        {p.evalArea ? (
                          <span
                            className={
                              'inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold leading-snug ' +
                              (p.evalArea.startsWith('종합')
                                ? 'bg-[#fff3e6] text-[#b45309]'
                                : 'bg-[#e9f2ff] text-[#1c5fb8]')
                            }
                          >
                            {p.evalArea}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-2 pr-2 text-[#313138]">
                        {p.behaviorArea || '—'}
                      </td>
                      <td
                        className="py-2 pr-2 font-bold"
                        style={{ color: BAND_COLOR[difficultyBand(feltOf(p))] }}
                        title={perceivedWhy(
                          {
                            verdict: p.verdict,
                            attempts: p.attempts,
                            revisits: p.revisits,
                            activeMs: p.activeMs,
                          },
                          { medianActiveMs: docMedianActiveMs },
                        )}
                      >
                        {difficultyBand(feltOf(p))}
                      </td>
                      <td className="py-2 text-[11.5px] text-[#797988]">
                        시도 {p.attempts}회 · {fmtMs(p.activeMs)}
                        {p.revisits > 0 && ` · 복귀 ${p.revisits}회`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          );
        })()}
        {/* ── 내신 시험지(수학) — 종합 성취도·심리 브리핑 (마스터 프롬프트 2026-09-05) ──
            강단에서 먼저 보는 것은 "몇 점이고 어디서 흔들렸나" 다. */}
        {s.id === 'examDashboard' && (() => {
          if (!examSummary || vProblems.length === 0) {
            return (
              <p className="text-[13px] text-ink-muted">
                문항 데이터가 아직 없습니다 — 채점·분석이 끝나면 채워집니다.
              </p>
            );
          }
          const d = examSummary.dashboard;
          const t = examSummary.types;
          const cell = (label: string, value: string, hint?: string) => (
            <div key={label} className="rounded-xl border border-[#e8e8e4] px-3 py-2.5">
              <div className="text-[11px] text-[#797988]">{label}</div>
              <div className="mt-0.5 text-[17px] font-bold tabular-nums text-ink">
                {value}
              </div>
              {hint && <div className="mt-0.5 text-[11px] text-[#797988]">{hint}</div>}
            </div>
          );
          return (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {cell(
                  '득점',
                  d.totalPoints != null && d.earnedPoints != null
                    ? `${d.earnedPoints} / ${d.totalPoints}점`
                    : `${d.correct} / ${d.correct + d.wrong + d.unknown}문항`,
                  d.totalPoints == null ? '배점을 읽지 못해 문항 수로 셉니다' : undefined,
                )}
                {cell('맞은 문항', `${d.correct}개`, `틀림 ${d.wrong} · 미채점 ${d.unknown}`)}
                {cell(
                  '체감 난이도',
                  d.felt,
                  `푸는 동안 ${Math.round(d.hoverRatio * 100)}% 를 멈춰 있었습니다`,
                )}
                {cell('평균 불안정도', `${d.avgAnxiety} / 10`, '멈칫·시도·복귀·번복 기반')}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {(['객관식', '주관식'] as const).map((k) => (
                  <div key={k} className="rounded-xl border border-[#e8e8e4] px-3 py-2.5">
                    <div className="text-[12px] font-bold text-ink">{k}</div>
                    <div className="mt-1 text-[12.5px] text-ink-muted">
                      {t[k].count === 0
                        ? '해당 문항 없음'
                        : `${t[k].count}문항 중 ${t[k].correct}개 정답` +
                          (t[k].points != null ? ` · ${t[k].earned}/${t[k].points}점` : '')}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[11.5px] leading-relaxed text-[#797988]">
                체감 난이도는 <b className="text-ink">푸는 동안 펜이 멈춰 있던 비율</b>로
                봅니다. 이 펜은 공중에 뜬 시간을 따로 기록하지 않아, 획 사이 공백을 인지적
                멈칫으로 씁니다. 필압은 종이에 닿았는지만 기록해 심리 지표로 쓰지 않습니다.
              </p>
            </div>
          );
        })()}

        {/* ── 페이지별 체력·집중도 흐름 ── */}
        {s.id === 'examPages' && (() => {
          if (!examSummary || examSummary.pages.length === 0) {
            return (
              <p className="text-[13px] text-ink-muted">
                문항이 어느 페이지에 있었는지 알 수 없어 흐름을 그리지 못했습니다.
              </p>
            );
          }
          return (
            <div className="space-y-2">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-[12.5px]">
                  <thead>
                    <tr className="border-b border-[#e8e8e4] text-[11px] text-[#797988]">
                      <th className="py-1.5 pr-2 text-left font-medium">페이지</th>
                      <th className="py-1.5 pr-2 text-left font-medium">문항</th>
                      <th className="py-1.5 pr-2 text-left font-medium">단원</th>
                      <th className="py-1.5 pr-2 text-right font-medium">평균 체류</th>
                      <th className="py-1.5 pr-2 text-right font-medium">멈칫</th>
                      <th className="py-1.5 pr-2 text-right font-medium">번복</th>
                      <th className="py-1.5 text-right font-medium">속도 변화</th>
                    </tr>
                  </thead>
                  <tbody>
                    {examSummary.pages.map((f) => (
                      <tr key={f.page} className="border-b border-[#f2f2ef] last:border-b-0">
                        <td className="py-1.5 pr-2 font-semibold text-ink">{f.page}쪽</td>
                        <td className="py-1.5 pr-2 text-ink-muted">
                          {f.from}
                          {f.to && f.to !== f.from ? `~${f.to}` : ''}
                        </td>
                        <td className="py-1.5 pr-2 text-ink-muted">
                          {f.units.length > 0 ? f.units.join(', ') : '—'}
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular-nums text-ink-muted">
                          {fmtMs(f.avgSpanMs)}
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular-nums text-ink-muted">
                          {f.hesitations}회 · {fmtMs(f.hoveringMs)}
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular-nums text-ink-muted">
                          {f.overwrites == null ? '미측정' : `${f.overwrites}회`}
                        </td>
                        <td className="py-1.5 text-right">
                          {f.trend == null ? (
                            <span className="text-[#797988]">기준</span>
                          ) : (
                            <span
                              className={
                                f.trend === '느려짐'
                                  ? 'font-semibold text-[#e03131]'
                                  : f.trend === '빨라짐'
                                    ? 'font-semibold text-[#1c7c4a]'
                                    : 'text-[#797988]'
                              }
                            >
                              {f.trend}
                              {f.paceDelta != null
                                ? ` ${f.paceDelta > 0 ? '+' : ''}${Math.round(f.paceDelta * 100)}%`
                                : ''}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11.5px] leading-relaxed text-[#797988]">
                뒤 페이지로 갈수록 문항당 필기 시간이 길어지면(<b className="text-ink">느려짐</b>)
                체력·집중이 떨어진 신호로 봅니다. 시간 배분을 앞쪽에서 아꼈는지 함께 보세요.
              </p>
            </div>
          );
        })()}

        {/* ── 문항 행동 데이터 (차트용 Raw Data) ── */}
        {s.id === 'examChart' && (() => {
          if (!examSummary || examSummary.chart.length === 0) {
            return (
              <p className="text-[13px] text-ink-muted">
                문항 데이터가 아직 없습니다.
              </p>
            );
          }
          const rows = examSummary.chart;
          return (
            <div className="space-y-2">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-[12.5px]">
                  <thead>
                    <tr className="border-b border-[#e8e8e4] text-[11px] text-[#797988]">
                      <th className="py-1.5 pr-2 text-left font-medium">문항</th>
                      <th className="py-1.5 pr-2 text-left font-medium">결과</th>
                      <th className="py-1.5 pr-2 text-right font-medium">배점</th>
                      <th className="py-1.5 pr-2 text-right font-medium">체류(초)</th>
                      <th className="py-1.5 pr-2 text-right font-medium">멈칫(초)</th>
                      <th className="py-1.5 pr-2 text-right font-medium">번복</th>
                      <th className="py-1.5 text-right font-medium">불안정도</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-b border-[#f2f2ef] last:border-b-0">
                        <td className="py-1.5 pr-2 font-semibold text-ink">{r.id}</td>
                        <td className="py-1.5 pr-2 text-ink-muted">
                          {r.isCorrect === 'partial'
                            ? '부분'
                            : r.isCorrect
                              ? '정답'
                              : '오답'}
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular-nums text-ink-muted">
                          {r.score ?? '—'}
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular-nums text-ink-muted">
                          {r.duration_sec}
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular-nums text-ink-muted">
                          {r.hovering_sec}
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular-nums text-ink-muted">
                          {r.overwrite_count ?? '—'}
                        </td>
                        <td className="py-1.5 text-right tabular-nums font-semibold text-ink">
                          {r.anxiety_index}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!publicMode && (
                <button
                  type="button"
                  data-testid="exam-raw-copy"
                  onClick={() => {
                    const json = JSON.stringify(rows, null, 2);
                    void navigator.clipboard
                      ?.writeText(json)
                      .then(() => toast('문항 행동 데이터를 복사했습니다.', 'positive'))
                      .catch(() => window.prompt('문항 행동 데이터', json));
                  }}
                  className="rounded-lg border border-line-weak px-2.5 py-1 text-[11.5px] text-ink-muted hover:text-ink print:hidden"
                >
                  Raw Data 복사 (JSON)
                </button>
              )}
              {!examSummary.hasOverwrites && (
                <p className="text-[11.5px] leading-relaxed text-[#797988]">
                  번복 횟수는 문항 분석이 필기 이미지에서 읽어냅니다. 아직 읽어낸 값이
                  없어 <b className="text-ink">미측정</b>으로 둡니다 — 0회라는 뜻이 아닙니다.
                </p>
              )}
            </div>
          );
        })()}

        {s.id === 'koreanDepth' && (() => {
          /* 5-Depth 성취 (국어) — 조건·형식 / 내용·핵심어 / 문법·표현 /
             논리·이해 / 영역 성취. 충족 100·부분 50·미충족 0 으로 세고
             '해당 없음' 은 분모에서 뺀다(객관식만 있는 문항이 늘 낮게 나오지 않게). */
          if (!koreanSummary) {
            return (
              <p className="text-[13px] text-ink-muted">
                국어 문항 분석이 아직 없습니다 — 문항 분석이 끝나면 채워집니다.
              </p>
            );
          }
          const rows = vProblems.filter((p) => p.korean?.depths?.length);
          const bar = (key: string, label: string, hint: string, v: number | null) => (
            <div key={key} className="flex items-center gap-2 text-[12px]">
              <div className="w-[110px] shrink-0 text-[#313138]" title={hint}>
                {label}
              </div>
              <div className="h-3 flex-1 rounded-full bg-[#eeeeec]">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${v ?? 0}%`, background: rateColor(v) }}
                />
              </div>
              <div className="w-16 shrink-0 text-right font-bold text-[#19191c]">
                {v == null ? '자료 없음' : `${v}%`}
              </div>
            </div>
          );
          return (
            <div className="space-y-4">
              <p className="text-[11.5px] leading-relaxed text-[#797988]">
                <b className="text-ink">판단 기준</b> — 국어는 "맞았나" 하나로 못
                본다. 문항마다 다섯 층을 따로 채점해{' '}
                <b className="text-ink">충족 100% · 부분 50% · 미충족 0%</b> 로 세고,
                그 문항에 해당하지 않는 층은 분모에서 뺍니다.
              </p>
              <div className="space-y-1.5">
                {KOREAN_DEPTHS.map((d) =>
                  bar(
                    `d${d.depth}`,
                    `D${d.depth} ${d.name}`,
                    d.hint,
                    koreanSummary.depthRates[d.depth] ?? null,
                  ),
                )}
              </div>
              <div className="space-y-1.5">
                <h3 className="text-[12.5px] font-bold text-[#19191c]">
                  영역별 성취
                </h3>
                {KOREAN_AREAS.map((a) =>
                  bar(
                    `a-${a}`,
                    a,
                    `${a} 문항의 5-Depth 득점률 평균 (Depth 판정이 없으면 정오로 대신)`,
                    koreanSummary.areaRates[a] ?? null,
                  ),
                )}
              </div>
              {rows.length === 0 ? (
                <p className="text-[13px] text-ink-muted">
                  문항별 5-Depth 판정이 아직 없습니다.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table
                    data-testid="korean-depth-table"
                    className="w-full border-collapse text-[12px]"
                  >
                    <thead>
                      <tr className="border-b border-[#e8e8e4] text-[11.5px] text-[#797988]">
                        <th className="py-1.5 pr-2 text-left font-normal">문항</th>
                        {KOREAN_DEPTHS.map((d) => (
                          <th
                            key={d.depth}
                            className="px-2 py-1.5 text-left font-normal"
                            title={d.hint}
                          >
                            D{d.depth} {d.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((p, i) => (
                        <tr
                          key={`${p.label}-${i}`}
                          className="border-b border-[#f0f0ee] align-top"
                        >
                          <td className="whitespace-nowrap py-1.5 pr-2 font-bold text-[#19191c]">
                            {p.label}
                          </td>
                          {KOREAN_DEPTHS.map((d) => {
                            const hit = p.korean?.depths?.find(
                              (x) => x.depth === d.depth,
                            );
                            const verdict: DepthVerdict = hit?.verdict ?? 'na';
                            return (
                              <td
                                key={d.depth}
                                className="px-2 py-1.5"
                                title={
                                  hit?.note?.trim() ||
                                  `${d.name} — ${DEPTH_VERDICT_LABEL[verdict]}`
                                }
                              >
                                <span className="inline-flex items-center gap-1 whitespace-nowrap">
                                  <span
                                    className="inline-block h-2 w-2 rounded-full"
                                    style={{
                                      background: DEPTH_VERDICT_COLOR[verdict],
                                    }}
                                  />
                                  <span
                                    style={{
                                      color:
                                        verdict === 'na' ? '#a3a3a0' : '#313138',
                                    }}
                                  >
                                    {DEPTH_VERDICT_LABEL[verdict]}
                                  </span>
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-1 text-[11px] text-ink-subtle">
                    칸에 마우스를 올리면 그렇게 본 근거가 보입니다.
                  </p>
                </div>
              )}
            </div>
          );
        })()}
        {s.id === 'koreanBehavior' && (() => {
          /* 행동 트렌드 (국어) — 펜 궤적에서 읽은 것만 쓴다.
             ① 숨은 킬러 문항: 맞혔는데 유난히 오래 멈칫한 문항
             ② 수정 궤적: 특히 정답 → 오답으로 고쳐 쓴 문항
             ③ 확신도 분포 */
          if (!koreanSummary) {
            return (
              <p className="text-[13px] text-ink-muted">
                국어 문항 분석이 아직 없습니다 — 문항 분석이 끝나면 채워집니다.
              </p>
            );
          }
          const killerLabels = new Set(koreanSummary.killers);
          const killers = vProblems.filter((p) => killerLabels.has(p.label));
          const rev = koreanSummary.revision;
          const revShown = REVISION_ORDER.filter((k) => (rev[k] ?? 0) > 0);
          const rightToWrong = vProblems.filter(
            (p) => p.korean?.revision === 'right_to_wrong',
          );
          const confRows = vProblems.filter((p) => p.korean?.confidence);
          const confOf = (p: ReportProblem): ConfidenceLevel => {
            const c = p.korean?.confidence;
            return c === 'high' || c === 'medium' || c === 'low' ? c : 'unknown';
          };
          const confCount = (lv: ConfidenceLevel) =>
            confRows.filter((p) => confOf(p) === lv).length;
          return (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <h3 className="text-[12.5px] font-bold text-[#19191c]">
                  숨은 킬러 문항
                </h3>
                <p className="text-[11.5px] leading-relaxed text-[#797988]">
                  <b className="text-ink">맞혔지만</b> 멈칫이 다른 문항 중앙값의
                  1.8배를 넘고 20초 이상이던 문항입니다. 정답률만 보면 안 보이지만
                  실제로는 부담이 컸던 자리라 수업에서 짚어야 합니다.
                </p>
                {killers.length === 0 ? (
                  <p className="text-[13px] text-ink-muted">
                    유난히 오래 멈칫한 정답 문항이 없습니다.
                  </p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {killers.map((p, i) => (
                      <div
                        key={`k-${p.label}-${i}`}
                        className="border-l-[3px] border-[#e8a33d] bg-[#f7f7f6] px-3 py-2"
                      >
                        <div className="text-[13.5px] font-bold text-[#19191c]">
                          {p.label}
                        </div>
                        <div className="mt-0.5 text-[12px] text-[#8a5a1c]">
                          멈칫 {fmtMs(hesitationMs(p))} — 맞혔지만 오래 망설였습니다
                        </div>
                        <div className="text-[11px] text-[#797988]">
                          시도 {p.attempts}회 · 실제 필기 {fmtMs(p.activeMs)} · 총{' '}
                          {fmtMs(p.spanMs)}
                          {p.revisits > 0 &&
                            ` · 다른 문제 풀다 ${p.revisits}회 복귀`}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <h3 className="text-[12.5px] font-bold text-[#19191c]">
                  수정 궤적
                </h3>
                {revShown.length === 0 ? (
                  <p className="text-[13px] text-ink-muted">
                    고쳐 쓴 흔적을 읽어내지 못했습니다.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
                    {revShown.map((k) => (
                      <span key={k} className="inline-flex items-center gap-1">
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{
                            background:
                              k === 'right_to_wrong'
                                ? '#e03131'
                                : k === 'wrong_to_right'
                                  ? '#2f9e44'
                                  : '#a3a3a0',
                          }}
                        />
                        {REVISION_LABEL[k]}{' '}
                        <b className="text-[#19191c]">{rev[k]}문항</b>
                      </span>
                    ))}
                  </div>
                )}
                {rightToWrong.length > 0 && (
                  <p className="text-[12px] leading-relaxed text-[#8a1c1c]">
                    <b>정답 → 오답으로 고쳐 쓴 문항</b>:{' '}
                    {rightToWrong.map((p) => p.label).join(', ')} — 처음 판단이
                    맞았는데 지웠습니다. 근거를 다시 확인하는 습관이 필요합니다.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <h3 className="text-[12.5px] font-bold text-[#19191c]">
                  확신도 분포
                </h3>
                {confRows.length === 0 ? (
                  <p className="text-[13px] text-ink-muted">
                    확신도를 판단할 자료가 없습니다.
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
                      {(['high', 'medium', 'low', 'unknown'] as ConfidenceLevel[])
                        .filter((lv) => confCount(lv) > 0)
                        .map((lv) => (
                          <span key={lv} className="inline-flex items-center gap-1">
                            <span
                              className="inline-block h-2 w-2 rounded-full"
                              style={{ background: CONFIDENCE_COLOR[lv] }}
                            />
                            {CONFIDENCE_LABEL[lv]}{' '}
                            <b className="text-[#19191c]">{confCount(lv)}문항</b>
                          </span>
                        ))}
                    </div>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {confRows.map((p, i) => (
                        <span
                          key={`c-${p.label}-${i}`}
                          className="inline-flex items-center gap-1 rounded border border-[#e8e8e4] px-1.5 py-0.5 text-[11.5px] text-[#313138]"
                          title={`${p.label} — 확신도 ${CONFIDENCE_LABEL[confOf(p)]}`}
                        >
                          <span
                            className="inline-block h-2 w-2 rounded-full"
                            style={{ background: CONFIDENCE_COLOR[confOf(p)] }}
                          />
                          {p.label}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <p className="border-t border-[#e8e8e4] pt-2 text-[11px] leading-relaxed text-ink-subtle">
                확신도는 필압이 아니라 필기 속도·멈칫·시도 횟수·수정 흔적으로
                산출합니다(이 펜은 필압을 0/1 로만 기록).
              </p>
            </div>
          );
        })()}
        {s.id === 'koreanScatter' && (() => {
          /* 인지-행동 산점도 — X 정답률, Y 평균 멈칫(초), Z 불안정도(점 크기·색).
             라이브러리 없이 인라인 SVG 라 인쇄(PDF)에도 그대로 나온다. */
          if (!koreanSummary || koreanSummary.scatter.length === 0) {
            return (
              <p className="text-[13px] text-ink-muted">
                국어 문항 분석이 아직 없습니다 — 문항 분석이 끝나면 채워집니다.
              </p>
            );
          }
          const pts = koreanSummary.scatter;
          const W = 620;
          const H = 320;
          const padL = 52;
          const padB = 46;
          const padT = 16;
          const padR = 18;
          const maxY = Math.max(...pts.map((p) => p.y), 0);
          const yMax = Math.max(10, Math.ceil(maxY / 10) * 10);
          const xOf = (v: number) =>
            padL + ((W - padL - padR) * Math.min(100, Math.max(0, v))) / 100;
          const yOf = (v: number) =>
            padT +
            (H - padT - padB) * (1 - Math.min(yMax, Math.max(0, v)) / yMax);
          const rOf = (z: number) => 4 + (Math.min(100, Math.max(0, z)) / 100) * 7;
          const zColor = (z: number) =>
            z >= 66 ? '#e03131' : z >= 33 ? '#e8a33d' : '#1c5fb8';
          const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) =>
            Math.round(yMax * f * 10) / 10,
          );
          return (
            <div className="space-y-2">
              <p className="text-[11.5px] leading-relaxed text-[#797988]">
                가로 = <b className="text-ink">정답률</b>, 세로 ={' '}
                <b className="text-ink">평균 멈칫 시간</b>, 점의 크기·색 ={' '}
                <b className="text-ink">불안정도</b>(멈칫 비율·시도·복귀·수정 방향).
                <b className="text-ink"> 오른쪽 위</b>에 큰 점이 있으면 맞히긴 했지만
                흔들린 문항입니다.
              </p>
              <div className="overflow-x-auto">
                <svg
                  data-testid="korean-scatter"
                  viewBox={`0 0 ${W} ${H}`}
                  style={{ width: W, maxWidth: 'none' }}
                  className="block"
                  role="img"
                  aria-label="인지-행동 산점도"
                >
                  {yTicks.map((t) => (
                    <g key={`y${t}`}>
                      <line
                        x1={padL}
                        y1={yOf(t)}
                        x2={W - padR}
                        y2={yOf(t)}
                        stroke="#e8e8e4"
                      />
                      <text
                        x={padL - 6}
                        y={yOf(t) + 3.5}
                        fontSize={10}
                        fill="#797988"
                        textAnchor="end"
                      >
                        {t}초
                      </text>
                    </g>
                  ))}
                  {[0, 25, 50, 75, 100].map((t) => (
                    <g key={`x${t}`}>
                      <line
                        x1={xOf(t)}
                        y1={padT}
                        x2={xOf(t)}
                        y2={H - padB}
                        stroke="#f2f2ef"
                      />
                      <text
                        x={xOf(t)}
                        y={H - padB + 16}
                        fontSize={10}
                        fill="#797988"
                        textAnchor="middle"
                      >
                        {t}%
                      </text>
                    </g>
                  ))}
                  {pts.map((p, i) => (
                    <g key={`p-${p.label}-${i}`}>
                      <circle
                        cx={xOf(p.x)}
                        cy={yOf(p.y)}
                        r={rOf(p.z)}
                        fill={zColor(p.z)}
                        fillOpacity={0.35 + (p.z / 100) * 0.45}
                        stroke={zColor(p.z)}
                        strokeWidth={1}
                      >
                        <title>{`${p.label} · 정답률 ${p.x}% · 멈칫 ${p.y}초 · 불안정도 ${p.z}`}</title>
                      </circle>
                      <text
                        x={xOf(p.x)}
                        y={yOf(p.y) - rOf(p.z) - 3}
                        fontSize={9.5}
                        fill="#797988"
                        textAnchor="middle"
                      >
                        {p.label}
                      </text>
                    </g>
                  ))}
                  <text
                    x={(padL + W - padR) / 2}
                    y={H - 6}
                    fontSize={10.5}
                    fill="#313138"
                    textAnchor="middle"
                  >
                    정답률(%)
                  </text>
                  <text
                    x={12}
                    y={(padT + H - padB) / 2}
                    fontSize={10.5}
                    fill="#313138"
                    textAnchor="middle"
                    transform={`rotate(-90 12 ${(padT + H - padB) / 2})`}
                  >
                    평균 멈칫(초)
                  </text>
                </svg>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-[#797988]">
                <span className="inline-flex items-center gap-1">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: '#1c5fb8' }}
                  />
                  불안정도 낮음
                </span>
                <span className="inline-flex items-center gap-1">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ background: '#e8a33d' }}
                  />
                  보통
                </span>
                <span className="inline-flex items-center gap-1">
                  <span
                    className="inline-block h-3 w-3 rounded-full"
                    style={{ background: '#e03131' }}
                  />
                  높음
                </span>
                <button
                  type="button"
                  data-testid="korean-scatter-copy"
                  onClick={() => {
                    void copyText(JSON.stringify(pts, null, 2)).then((ok) =>
                      toast(
                        ok
                          ? '산점도 Raw Data(JSON)를 복사했습니다.'
                          : '복사에 실패했습니다.',
                        ok ? 'positive' : 'critical',
                      ),
                    );
                  }}
                  className="inline-flex items-center gap-1 rounded border border-line-weak px-2 py-1 text-[11.5px] text-ink-muted hover:text-ink print:hidden"
                >
                  Raw Data 복사
                </button>
              </div>
            </div>
          );
        })()}
        {s.id === 'difficultyBars' && (() => {
          /* 문항별 **체감 난이도** 막대 — 문제 난이도(AI 판정) 막대는 폐지
             (사용자 2026-09-02). 막대 색: 쉬움 노랑 / 보통 녹색 / 어려움 빨강 /
             매우 어려움 검정. 파란 점선 = 같은 시험지를 푼 다른 학생들의 평균 체감.
             세로축도 숫자 대신 네 라벨로 읽는다. */
          const list = vProblems;
          if (list.length === 0) {
            return <p className="text-[13px] text-ink-muted">문항이 없습니다.</p>;
          }
          const med = medianActiveMs(list);
          const rows = list.map((p) => {
            const inp = {
              verdict: p.verdict,
              attempts: p.attempts,
              revisits: p.revisits,
              activeMs: p.activeMs,
            };
            return {
              label: p.label,
              felt: perceivedDifficulty10(inp, { medianActiveMs: med }),
              why: perceivedWhy(inp, { medianActiveMs: med }),
              avg: classAvg?.perceivedByLabel[p.label] ?? null,
            };
          });
          const W = Math.max(560, rows.length * 46);
          const H = 220;
          const padL = 64;
          const padB = 46;
          const padT = 12;
          const bw = (W - padL - 10) / rows.length;
          const yOf = (v: number) => padT + (H - padT - padB) * (1 - v / 10);
          const cx = (i: number) => padL + bw * i + bw / 2;
          const line = (get: (r: (typeof rows)[number]) => number | null) =>
            rows
              .map((r, i) => {
                const v = get(r);
                return v == null ? null : `${cx(i).toFixed(1)},${yOf(v).toFixed(1)}`;
              })
              .filter(Boolean)
              .join(' ');
          // 세로축 라벨 — 구간(쉬움 1~2 · 보통 3~5 · 어려움 6~7 · 매우 8~10)의 중간
          const axis: Array<{ y: number; label: string }> = [
            { y: 1.5, label: '쉬움' },
            { y: 4, label: '보통' },
            { y: 6.5, label: '어려움' },
            { y: 9, label: '매우 어려움' },
          ];
          return (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px]">
                {(['쉬움', '보통', '어려움', '매우 어려움'] as const).map((b) => (
                  <span key={b} className="inline-flex items-center gap-1">
                    <span
                      className="inline-block h-2.5 w-3.5 rounded-[2px]"
                      style={{ background: BAND_COLOR[b] }}
                    />
                    {b}
                  </span>
                ))}
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-0 w-5 border-t-2 border-dashed border-[#1c5fb8]" />
                  평균 체감
                  {classAvg ? ` (${classAvg.students}명)` : ' (자료 없음)'}
                </span>
              </div>
              <div className="overflow-x-auto">
                <svg
                  viewBox={`0 0 ${W} ${H}`}
                  style={{ width: W, maxWidth: 'none' }}
                  className="block"
                  role="img"
                  aria-label="문항별 체감 난이도"
                >
                  {[0, 2.5, 5.5, 7.5, 10].map((v) => (
                    <line
                      key={v}
                      x1={padL}
                      y1={yOf(v)}
                      x2={W - 6}
                      y2={yOf(v)}
                      stroke="#e8e8e4"
                    />
                  ))}
                  {axis.map((a) => (
                    <text
                      key={a.label}
                      x={padL - 6}
                      y={yOf(a.y) + 3.5}
                      fontSize={10}
                      fill="#797988"
                      textAnchor="end"
                    >
                      {a.label}
                    </text>
                  ))}
                  {rows.map((r, i) => (
                    <rect
                      key={r.label + i}
                      x={cx(i) - bw * 0.18}
                      y={yOf(r.felt)}
                      width={bw * 0.36}
                      height={yOf(0) - yOf(r.felt)}
                      fill={BAND_COLOR[difficultyBand(r.felt)]}
                      rx={2}
                    >
                      <title>{`${r.label} · 체감 ${difficultyBand(r.felt)} — ${r.why}`}</title>
                    </rect>
                  ))}
                  {rows.some((r) => r.avg != null) && (
                    <>
                      <polyline
                        points={line((r) => r.avg)}
                        fill="none"
                        stroke="#1c5fb8"
                        strokeWidth={2}
                        strokeDasharray="5 4"
                      />
                      {rows.map((r, i) =>
                        r.avg == null ? null : (
                          <circle key={`a${i}`} cx={cx(i)} cy={yOf(r.avg)} r={3} fill="#1c5fb8">
                            <title>{`${r.label} · 평균 체감 ${difficultyBand(r.avg)}`}</title>
                          </circle>
                        ),
                      )}
                    </>
                  )}
                  {rows.map((r, i) => (
                    <text
                      key={`t${i}`}
                      x={cx(i)}
                      y={H - padB + 14}
                      fontSize={9.5}
                      fill="#797988"
                      textAnchor="end"
                      transform={`rotate(-45 ${cx(i)} ${H - padB + 14})`}
                    >
                      {r.label}
                    </text>
                  ))}
                </svg>
              </div>
              <p className="text-[11px] leading-relaxed text-ink-subtle">
                막대 = <b>체감 난이도</b>(이 학생이 어떻게 느꼈나 — 시도·복귀·소요
                시간·정오로 계산). 막대에 마우스를 올리면 계산 근거가 보입니다.
                {!classAvg &&
                  ' 평균 체감 선은 같은 시험지를 푼 다른 학생의 리포트가 만들어지면 나타납니다.'}
              </p>
            </div>
          );
        })()}
        {s.id === 'aiProcess' && (
          <div className="mb-4 space-y-2">
            {/* 필터 탭(전체/틀린 것만/어렵게 푼 것만)은 걷어냈다 — 리포트는
                전 문항을 그대로 담는다(사용자 요구 2026-08-25).
                풀이 시간은 다시 넣었다(사용자 요구 2026-09-02: 문항별 시분초). */}
            {/* 풀이+답안(모범 풀이)이 없는 교재 — 학생 풀이만으로 분석했음을 밝힌다 */}
            {!doc.solutionsAvailable && (
              <p
                data-testid="no-model-solution-note"
                className="rounded-lg border border-dashed border-[#dcdcd8] bg-[#f7f7f6] px-3 py-2 text-[12px] leading-relaxed text-[#797988]"
              >
                이 교재는 풀이+답안 PDF 가 등록돼 있지 않아 학생의 풀이만으로
                분석했습니다. 교재 만들기에서 풀이+답안을 올리면 선생님 풀이와의
                비교가 문항마다 붙습니다.
              </p>
            )}
            {vProblems.length === 0 ? (
              <p className="text-[13px] text-ink-muted">분석된 문항이 없습니다.</p>
            ) : (
              /* 단계별로 갈라서 보여준다 (사용자 요구 2026-08-25) — 단계형
                 테스트지는 1단계·2단계로 나뉘고 번호가 단계마다 다시 시작한다.
                 단계가 없는 문제지는 묶음 제목 없이 그대로 나열된다. */
              groupProblems(doc.problems, hideP).map(([g, list]) => (
                <div key={g || '_'} className="space-y-2">
                  {g && (
                    <div className="flex items-center gap-2 pt-1">
                      <span className="rounded bg-[#19191c] px-2 py-0.5 text-[11.5px] font-bold text-white">
                        {g}
                      </span>
                      <span className="text-[11.5px] text-[#797988]">
                        {list.length}문항
                      </span>
                      <span className="h-px flex-1 bg-[#e8e8e4]" />
                    </div>
                  )}
                  {list.map(({ p, idx }) => {
                const unsolved = isUnsolved(p);
                const original = unsolved
                  ? '학생이 손대지 않은 문제입니다.'
                  : p.process || p.comment || '기록된 과정 요약이 없습니다.';
                const shown = p.processEdited ?? original;
                const isEditing = editingIdx === idx;
                return (
                  <div
                    key={idx}
                    className={
                      'rounded-xl border p-3.5 ' +
                      (unsolved
                        ? 'border-dashed border-[#dcdcd8] bg-[#f7f7f6]'
                        : 'border-line-weak bg-[#fafafa]')
                    }
                  >
                    <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
                      <b className="text-[#19191c]">{p.label}</b>
                      {unsolved ? (
                        <span className="rounded bg-[#e8e8e4] px-1.5 py-0.5 text-[11px] font-semibold text-[#797988]">
                          안 푼 문제
                        </span>
                      ) : (
                        <span
                          className={
                            vOf(p) === 'correct'
                              ? 'text-[#1a7f37]'
                              : 'text-[#e03131]'
                          }
                        >
                          {vOf(p) === 'correct' ? '○ 맞음' : '✕ 틀림'}
                        </span>
                      )}
                      {/* 이 문항이 어느 단원인지 문항마다 알려준다 (사용자 2026-08-25) */}
                      {p.unit && (
                        <span className="rounded bg-[#e9f2ff] px-1.5 py-0.5 text-[11px] font-semibold text-[#1c5fb8]">
                          {p.unit}
                          {p.subUnit && (
                            <span className="font-normal"> · {p.subUnit}</span>
                          )}
                        </span>
                      )}
                      {/* 문항별 풀이 시간 — 시·분·초 (사용자 요구 2026-09-02) */}
                      {!unsolved && p.activeMs > 0 && (
                        <span
                          data-testid="solve-time"
                          className="rounded bg-[#f1f1ef] px-1.5 py-0.5 text-[11px] font-semibold text-[#313138]"
                          title="8초 이상 손을 뗀 구간을 뺀 실제 필기 시간"
                        >
                          풀이 시간 {fmtMs(p.activeMs)}
                        </span>
                      )}
                      {p.processEdited != null && (
                        <span className="rounded bg-[#e8e8e4] px-1.5 py-0.5 text-[11px] font-semibold text-[#797988]">
                          수정함
                        </span>
                      )}
                      <span
                        className={
                          'ml-auto flex gap-1 print:hidden' +
                          (publicMode ? ' hidden' : '')
                        }
                      >
                        {/* 고치다 마음에 안 들면 되돌아갈 수 있어야 한다 —
                            원본(process)은 지우지 않고 그대로 둔다. */}
                        {p.processEdited != null && (
                          <button
                            type="button"
                            onClick={() => {
                              patchProblemAt(idx, { processEdited: undefined });
                              setEditingIdx(null);
                            }}
                            className="rounded border border-line-weak px-2 py-0.5 text-[11.5px] text-ink-muted hover:text-ink"
                          >
                            원래대로
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setEditingIdx(isEditing ? null : idx)}
                          className="rounded border border-line-weak px-2 py-0.5 text-[11.5px] text-ink-muted hover:text-ink"
                        >
                          {isEditing ? '완료' : '수정'}
                        </button>
                      </span>
                    </div>
                    {isEditing ? (
                      <textarea
                        // autoFocus 는 브라우저가 그 요소로 **스크롤**한다 —
                        // 목록 한가운데 카드를 열면 화면이 튄다(사용자 신고
                        // 2026-08-25). 스크롤 없이 커서만 놓는다.
                        ref={(el) => {
                          if (el && document.activeElement !== el)
                            el.focus({ preventScroll: true });
                        }}
                        value={shown}
                        onChange={(e) =>
                          patchProblemAt(idx, {
                            processEdited: e.currentTarget.value,
                          })
                        }
                        className="min-h-20 w-full resize-y rounded-lg border border-line-solid p-2.5 text-[13px] leading-relaxed text-ink outline-none focus:border-brand"
                      />
                    ) : (
                      <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">
                        <LatexText text={shown} />
                      </p>
                    )}
                    {/* 모범 풀이 비교 — 선생님 풀이+답안과 학생 풀이를 견준 결과
                        (사용자 요구 2026-09-02). 문항 분석 캐시에서 옮겨 심은 값. */}
                    {!unsolved && p.modelComparison && (() => {
                      const mc = p.modelComparison;
                      const V: Record<string, { label: string; cls: string }> = {
                        same: { label: '모범 풀이와 같음', cls: 'bg-[#e6f4ea] text-[#1a7f37]' },
                        similar: { label: '비슷하지만 일부 다름', cls: 'bg-[#fff3e6] text-[#b45309]' },
                        different: { label: '다른 접근', cls: 'bg-[#e9f2ff] text-[#1c5fb8]' },
                        unknown: { label: '비교 판정 불가', cls: 'bg-[#f1f1ef] text-[#797988]' },
                      };
                      const v = V[mc.verdict] ?? V.unknown;
                      const rows: Array<[string, string]> = [
                        ['학생의 풀이', mc.studentApproach],
                        ['선생님 모범 풀이', mc.modelApproach],
                        ...(mc.verdict !== 'same'
                          ? ([
                              ['어디가 다른가', mc.difference],
                              ['왜 그렇게 풀었을까', mc.whyDifferent],
                            ] as Array<[string, string]>)
                          : []),
                        ['정답과 풀이가 엇갈린 경우', mc.mismatchNote],
                        ['다음 지도 포인트', mc.advice],
                      ];
                      return (
                        <div
                          data-testid="report-model-comparison"
                          className="mt-2 rounded-lg border border-[#e8e8e4] bg-white px-3 py-2.5"
                        >
                          <div className="flex flex-wrap items-center gap-2 text-[12px]">
                            <b className="text-[#19191c]">모범 풀이 비교</b>
                            <span className={'rounded px-1.5 py-0.5 text-[11px] font-bold ' + v.cls}>
                              {v.label}
                            </span>
                            {mc.summary && (
                              <span className="text-[#313138]">
                                <LatexText text={mc.summary} />
                              </span>
                            )}
                          </div>
                          <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
                            {rows
                              .filter(([, val]) => val && val.trim())
                              .map(([k, val]) => (
                                <Fragment key={k}>
                                  <dt className="whitespace-nowrap text-[#797988]">{k}</dt>
                                  <dd className="whitespace-pre-wrap leading-relaxed text-[#313138]">
                                    <LatexText text={val} />
                                  </dd>
                                </Fragment>
                              ))}
                          </dl>
                        </div>
                      );
                    })()}
                  </div>
                );
                  })}
                </div>
              ))
            )}
          </div>
        )}
        {s.id === 'priority' && (() => {
          /* 우선 학습대상 — **가장 많이 틀린 유형 2개**만 (사용자 요구 2026-08-25).
             종전의 5순위(실수/원포인트/단기…)는 처방 분류라 "무엇부터 볼지" 가
             한눈에 안 들어왔다. 이제 틀린 문항을 **단원+세부내용**으로 묶어
             많이 틀린 순서로 1·2순위를 세운다. */
          const wrong = vProblems.filter((p) => vOf(p) === 'wrong');
          if (wrong.length === 0) {
            return (
              <p className="mb-4 text-[13px] text-ink-muted">
                틀린 문항이 없어 우선 학습대상이 없습니다.
              </p>
            );
          }
          const buckets = new Map<
            string,
            { unit: string; sub: string; labels: string[] }
          >();
          for (const p of wrong) {
            const unit = p.unit?.trim() || '단원 미확인';
            const sub = p.subUnit?.trim() || '';
            const key = `${unit}||${sub}`;
            if (!buckets.has(key)) buckets.set(key, { unit, sub, labels: [] });
            buckets.get(key)!.labels.push(p.label);
          }
          const ranked = [...buckets.values()]
            .sort((a, b) => b.labels.length - a.labels.length)
            .slice(0, 2);
          const TONE = [
            { bg: '#ff4d4d', fg: '#ffffff', sub: 'rgba(255,255,255,0.85)' },
            { bg: '#ffc9c9', fg: '#c1121f', sub: '#c1121f' },
          ];
          return (
            <div className="mb-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {[0, 1].map((i) => {
                const item = ranked[i];
                const tone = TONE[i];
                return (
                  <div
                    key={i}
                    className="relative min-h-[128px] overflow-hidden rounded-2xl p-4"
                    style={{ background: tone.bg }}
                  >
                    <span
                      aria-hidden
                      className="pointer-events-none absolute -bottom-3 right-2 text-[64px] font-black leading-none opacity-15"
                      style={{ color: tone.fg }}
                    >
                      {i + 1}
                    </span>
                    <div className="text-[15px] font-bold" style={{ color: tone.fg }}>
                      {i + 1}순위
                    </div>
                    {!item ? (
                      <div className="mt-3 text-[13px]" style={{ color: tone.sub }}>
                        해당 없음
                      </div>
                    ) : (
                      <>
                        <div
                          className="mt-2 text-[15px] font-bold"
                          style={{ color: tone.fg }}
                        >
                          {item.unit}
                        </div>
                        {item.sub && (
                          <div
                            className="mt-0.5 text-[12.5px]"
                            style={{ color: tone.sub }}
                          >
                            {item.sub}
                          </div>
                        )}
                        <div className="mt-1 text-[11.5px]" style={{ color: tone.sub }}>
                          이 유형에서 {item.labels.length}문항 틀림
                        </div>
                        <div className="relative mt-2 flex flex-wrap gap-1.5">
                          {item.labels.map((l, j) => (
                            <span
                              key={`${l}-${j}`}
                              className="rounded-lg bg-white/85 px-2.5 py-1 text-[12.5px] font-semibold text-[#19191c]"
                            >
                              {l}
                            </span>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}
        {(s.id === 'learner' || s.id === 'priority' || s.id === 'overall') &&
          (() => {
            /* 편집칸과 미리보기를 **따로 두지 않는다** — 같은 내용이 두 번 보였다
               (사용자 지적 2026-08-26). 보이는 글 자리에서 바로 고치고,
               [원래대로] 로 AI 원문으로 돌아간다.
               종합분석은 **마지막 총평**이라 눈에 띄게 강조한다. */
            const emph = s.id === 'overall';
            const shown = s.bodyEdited ?? s.body ?? '';
            const editing = editingSection === s.id;
            return (
              <div
                className={
                  emph
                    ? 'rounded-2xl border-2 border-[#ff5a5a] bg-white p-4 sm:p-5'
                    : 'rounded-xl border border-line-weak bg-white p-3.5'
                }
              >
                <div
                  className={
                    'mb-1.5 flex items-center gap-1.5 print:hidden' +
                    (publicMode ? ' hidden' : '')
                  }
                >
                  {s.bodyEdited != null && (
                    <span className="rounded bg-[#e8e8e4] px-1.5 py-0.5 text-[11px] font-semibold text-[#797988]">
                      수정함
                    </span>
                  )}
                  <span className="ml-auto flex gap-1">
                    {s.bodyEdited != null && (
                      <button
                        type="button"
                        onClick={() => {
                          patchSection(idx, { bodyEdited: undefined });
                          setEditingSection(null);
                        }}
                        className="rounded border border-line-weak px-2 py-0.5 text-[11.5px] text-ink-muted hover:text-ink"
                      >
                        원래대로
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setEditingSection(editing ? null : s.id)}
                      className="rounded border border-line-weak px-2 py-0.5 text-[11.5px] text-ink-muted hover:text-ink"
                    >
                      {editing ? '완료' : '수정'}
                    </button>
                  </span>
                </div>
                {editing ? (
                  <textarea
                    ref={(el) => {
                      if (el && document.activeElement !== el)
                        el.focus({ preventScroll: true });
                    }}
                    className="min-h-40 w-full resize-y rounded-lg border border-line-solid p-3 text-sm leading-relaxed text-ink outline-none focus:border-brand"
                    value={shown}
                    onChange={(e) =>
                      patchSection(idx, { bodyEdited: e.currentTarget.value })
                    }
                  />
                ) : (
                  <div className={emph ? 'text-[14px]' : ''}>
                    <MiniMarkdown text={shown} />
                  </div>
                )}
              </div>
            );
          })()}
      </section>
    );
  };

  return (
    // PC 는 1440px 고정, 태블릿·모바일은 화면 폭에 맞춘다 (사용자 요구 2026-08-26).
    // 🟦 **슬라이드 보기는 모바일 전용** — PC 에서도 휴대폰 폭으로 가둔다
    //    (사용자 요구 2026-08-27: "PC 버전은 필요 없다").
    <div
      className={
        slideMode
          ? 'mx-auto w-full max-w-[430px] px-0 pb-24'
          : 'mx-auto w-full max-w-[1440px] px-3 sm:px-4 lg:px-6'
      }
    >
      {/* ── 편집 툴바 (인쇄·공유 링크에서는 숨김) ── */}
      <div
        className={
          'mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden' +
          (publicMode ? ' hidden' : '')
        }
      >
        <Link to={`/t/submissions/${id}`} className="text-sm text-brand underline">
          ← 리뷰로 돌아가기
        </Link>
        <div className="flex items-center gap-2">
          {savedAt && (
            <span className="text-xs text-ink-subtle">저장됨 {savedAt}</span>
          )}
          {customPromptsEnabled && (
            <ActionButton
              variant="neutralWeak"
              size="small"
              onClick={() => setPromptOpen(true)}
            >
              리포트 프롬프트
            </ActionButton>
          )}
          {/* 공유 링크 — 로그인 없이 열리는 읽기 전용 주소를 복사한다.
              🔒 링크를 가진 사람은 학생 이름·문항별 결과를 전부 본다. */}
          <ActionButton
            variant="neutralWeak"
            size="small"
            onClick={() => setShareOpen(true)}
          >
            공유 링크 복사
          </ActionButton>
          <ActionButton
            variant="neutralOutline"
            onClick={() => {
              // 재생성은 리뷰 화면의 데이터(문항·채점)가 필요하다 — 플래그를
              // 남기고 리뷰로 돌아가면 준비되는 즉시 강제 재생성된다.
              if (!id) return;
              if (
                !window.confirm(
                  '리포트를 다시 생성할까요? 지금 문서는 새 결과로 대체됩니다.',
                )
              )
                return;
              sessionStorage.setItem(`report-regen:${id}`, '1');
              window.location.href = `/t/submissions/${id}`;
            }}
          >
            다시 생성
          </ActionButton>
          <ActionButton
            variant="neutralWeak"
            size="small"
            loading={saving}
            onClick={() => void save()}
          >
            <Save size={14} className="mr-1" /> 저장
          </ActionButton>
          <ActionButton
            variant="neutralWeak"
            size="small"
            onClick={() => {
              // 종이 인쇄용 — PC 앱은 네이티브 인쇄 다이얼로그, 브라우저는
              // window.print(). PDF 파일이 필요하면 [PDF 저장]을 쓴다.
              void save().then(() => {
                if (isDesk()) {
                  void deskPrint().catch(() => window.print());
                } else {
                  window.print();
                }
              });
            }}
          >
            <Printer size={14} className="mr-1" /> 인쇄
          </ActionButton>
          <ActionButton
            variant="brandSolid"
            size="small"
            loading={exporting}
            onClick={() => void exportPdf()}
          >
            <FileDown size={14} className="mr-1" /> PDF 저장
          </ActionButton>
        </div>
      </div>

      {/* 편집 안내 — 조작은 각 항목에서 직접 한다(화살표 패널 제거).
          웹 에디터처럼 끌어서 옮기고, 항목마다 숨기기 토글이 붙어 있다. */}
      <div
        className={
          'mb-4 rounded-xl border border-line-weak bg-layer-default px-4 py-3 text-xs leading-relaxed text-ink-muted print:hidden' +
          (publicMode ? ' hidden' : '')
        }
      >
        각 항목의 <b className="text-ink">⣿ 손잡이를 끌어</b> 순서를 바꾸고,{' '}
        <b className="text-ink">[숨기기]</b> 로 PDF 에서 뺄 수 있어요. 숨긴 항목도
        이 편집 화면에는 흐리게 남아 있어 언제든 다시 켤 수 있습니다.
      </div>

      {/* ⚠️ 옛 방식으로 만든 리포트 경고 — 정오를 **AI 응답**에서 가져오던 시절
          문서다. 라벨이 겹치면(단계마다 1번) 한 응답이 여러 문항에 복제돼
          채점과 리포트의 맞은 개수가 갈렸다(이정연J 사고, 2026-08-25).
          지금은 채점 결과가 정본이므로, 다시 생성하면 바로잡힌다. */}
      {doc.problems.some((p) => !p.problemId) && (
        <div
          data-testid="stale-report-warning"
          className="mb-4 rounded-xl border-2 border-[#e5484d] bg-[#fff1f2] px-4 py-3 text-sm leading-relaxed text-[#a1191d] print:hidden"
        >
          <b>이 리포트는 옛 방식으로 만들어졌습니다 — 정오가 실제 채점과 다를 수 있습니다.</b>
          <br />
          예전에는 정오를 AI 응답에서 가져왔고, 문항 번호가 겹치면 한 응답이 여러
          문항에 복제됐습니다. 지금은 <b>채점 결과가 정본</b>입니다 — 아래
          [다시 생성]을 누르면 바로잡힙니다.
          {(doc.duplicateLabels?.length ?? 0) > 0 && (
            <>
              <br />
              번호가 겹친 문항: {doc.duplicateLabels!.join(', ')} — 교재를 [다시
              인식]하면 "1단계(기본)-1번" 처럼 갈립니다.
            </>
          )}
        </div>
      )}

      {/* ── 리포트 본문 (인쇄 대상) ──
          첨부 양식: 연회색 바탕 위에 흰 카드들이 얹힌 구성. 맨 위는 빨간
          헤더 카드(이름·날짜)로 누구 리포트인지 한눈에 보이게 한다. */}
      <div
        ref={printRef}
        className={
          slideMode
            ? 'min-h-screen bg-[#f5f6f8] px-3 pt-3'
            : 'rounded-2xl bg-[#f5f6f8] p-4 print:bg-white print:p-0'
        }
      >
        <header
          className={
            'relative overflow-hidden bg-[#ff5a5a] text-white ' +
            // 슬라이드(모바일)에서는 헤더를 얇게 — 본문이 한 화면에 더 들어온다
            (slideMode
              ? 'mb-3 rounded-2xl px-4 py-3.5'
              : 'mb-4 rounded-2xl px-6 py-5')
          }
        >
          {/* 우측 삼각 그래픽 — 양식의 장식 */}
          <span
            aria-hidden
            className="pointer-events-none absolute -right-6 -top-2 h-[130%] w-40 opacity-30"
            style={{
              background: '#c92a2a',
              clipPath: 'polygon(50% 0%, 100% 100%, 0% 100%)',
            }}
          />
          <div className="relative">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-white/85">
              <span
                data-testid="report-subject"
                className="rounded bg-white/20 px-1.5 py-0.5 text-[11px]"
              >
                {doc.subject ?? '수학'}
              </span>
              <span>{doc.submissionTitle}</span>
            </div>
            <h1 className="mt-1 text-[24px] font-bold leading-tight">
              {doc.studentName}
            </h1>
            <div className="mt-1 text-[12.5px] text-white/85">
              {kstShortDate(doc.generatedAt)}
            </div>
          </div>
        </header>
        {!publicMode && !isCurrentAssessment(doc.assessment, doc.subject ?? '수학') && (
          <p data-testid="assessment-update-notice" className="mb-4 rounded-lg border border-line-weak bg-white p-3 text-sm text-ink-muted print:hidden">
            새 평가자료 기준을 적용하려면 [다시 생성]을 눌러 주세요. 기존 문서는 그대로 보존했습니다. 다시 생성하면 편집한 내용도 새 결과로 바뀝니다.
          </p>
        )}
        <AssessmentReferences assessment={doc.assessment} />
        {/* 'penData'(문제별 펜 데이터) 는 폐지된 섹션이다 — 정오 분석표와 값이
            겹쳐 사용자가 빼달라고 했다(2026-08-25). 이미 만들어진 리포트에는
            남아 있으므로 렌더에서 걸러낸다. */}
        {(() => {
          const list = doc.sections
            .map((s, i) => [s, i] as const)
            .filter(([s]) => s.id !== 'penData')
            // '난이도별 정답률'은 AI 문제 난이도 기반이라 폐지 (사용자 2026-09-02)
            .filter(([s]) => s.id !== 'difficultyChart')
            // 수학 전용 섹션 — 비수학 문서에는 태그가 없어 빈 표만 남는다 (027)
            .filter(([s]) => mathDoc || !MATH_ONLY_SECTIONS.has(s.id))
            .filter(([s]) => !(publicMode && !s.visible));
          if (!slideMode) return list.map(([s, i]) => renderSection(s, i));
          const at = Math.min(Math.max(slide, 0), list.length - 1);
          const [cur, curIdx] = list[at] ?? [];
          const pct = ((at + 1) / list.length) * 100;
          return (
            <div>
              {/* 📱 모바일 앱처럼 — 상단 진행바 + 제목, 아래 고정 이동 바.
                  PC 에서도 휴대폰 폭으로 갇혀 있어 같은 모습이다. */}
              <div className="sticky top-0 z-20 -mx-3 mb-3 bg-[#f5f6f8]/95 px-3 pb-2 pt-1 backdrop-blur">
                <div className="h-1 w-full overflow-hidden rounded-full bg-[#e2e2de]">
                  <div
                    className="h-full rounded-full bg-[#ff5a5a] transition-[width] duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-[15px] font-bold text-[#19191c]">
                    {cur?.title}
                  </span>
                  <span className="ml-auto text-[11.5px] tabular-nums text-[#797988]">
                    {at + 1} / {list.length}
                  </span>
                </div>
              </div>

              {cur ? renderSection(cur, curIdx as number) : null}

              {/* 하단 이동 바 — 엄지가 닿는 자리에 큼직하게 */}
              <div className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-[430px] border-t border-[#e8e8e4] bg-white px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-2.5">
                <div className="mb-2 flex items-center justify-center gap-1.5">
                  {list.map(([sx], i) => (
                    <button
                      key={sx.id}
                      type="button"
                      aria-label={sx.title}
                      onClick={() => {
                        setSlide(i);
                        window.scrollTo({ top: 0 });
                      }}
                      className={
                        'h-1.5 rounded-full transition-all ' +
                        (i === at ? 'w-6 bg-[#ff5a5a]' : 'w-1.5 bg-[#dcdcd8]')
                      }
                    />
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={at === 0}
                    onClick={() => {
                      setSlide(at - 1);
                      window.scrollTo({ top: 0 });
                    }}
                    className="h-12 flex-1 rounded-xl border border-[#e8e8e4] text-[15px] font-bold text-[#19191c] disabled:opacity-35"
                  >
                    이전
                  </button>
                  <button
                    type="button"
                    disabled={at >= list.length - 1}
                    onClick={() => {
                      setSlide(at + 1);
                      window.scrollTo({ top: 0 });
                    }}
                    className="h-12 flex-[2] rounded-xl bg-[#ff5a5a] text-[15px] font-bold text-white disabled:opacity-35"
                  >
                    {at >= list.length - 1 ? '마지막 장' : '다음'}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
      <ReportPromptDialog open={promptOpen} onClose={() => setPromptOpen(false)} />

      {/* 공유 형태 고르기 — 같은 리포트를 **어떻게 보여줄지**만 다르다.
          둘 다 선생님의 편집(수정·순서·숨김)을 그대로 따른다. */}
      <Dialog open={shareOpen} onOpenChange={(o) => !o && setShareOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>어떻게 보여줄까요?</DialogTitle>
            <DialogDescription>
              링크를 가진 사람은 로그인 없이 이 리포트를 봅니다. 선생님이 고치고
              숨긴 내용이 그대로 반영됩니다.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => copyShare('report')}
              className="w-full rounded-xl border border-line-weak p-3 text-left hover:border-brand"
            >
              <div className="text-sm font-bold text-ink">리포트 그대로</div>
              <div className="mt-0.5 text-xs text-ink-muted">
                지금 화면과 같은 한 장짜리 문서. 위에서 아래로 쭉 읽습니다.
              </div>
            </button>
            <button
              type="button"
              onClick={() => copyShare('slide')}
              className="w-full rounded-xl border border-line-weak p-3 text-left hover:border-brand"
            >
              <div className="text-sm font-bold text-ink">한 장씩 넘겨 보기</div>
              <div className="mt-0.5 text-xs text-ink-muted">
                섹션을 한 화면에 하나씩. 아래 [이전/다음]으로 넘깁니다 — 휴대폰으로
                보기 좋습니다.
              </div>
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
