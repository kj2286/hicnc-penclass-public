/**
 * 학생 필기 기록 — 학생 관리 리스트의 [필기 기록]으로 진입하는 상세 페이지.
 * 날짜별로 저장된 필기 데이터를 보여주고, [열기]를 누르면 제출 상세
 * (재생·AI 과정 분석·필기 인식·피드백)로 다시 진입한다.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { Skeleton } from '@seed-design/react';
import { ActionButton } from 'seed-design/ui/action-button';
import { Callout } from 'seed-design/ui/callout';
import { kstDateKey, kstDayLabel, kstStamp } from '@/lib/kst';
import { EmptyState } from '@/components/EmptyState';
import {
  deleteSubmission,
  listMyStudents,
  listStudentSubmissions,
  type SubmissionRow,
} from '@/lib/api';
import {
  loadAiStatus,
  wireAutoGradeCatchUp,
  type AiStatusDoc,
} from '@/lib/auto-grade';
import { pendingLearnReport } from '@/lib/learn-report';
import {
  getDocAiStatus,
  isAutoGrading,
  receiveStateVersion,
  subscribeReceiveState,
} from '@/lib/receive-state';
import { AI_EPOCH } from '@/lib/ai-epoch';
import { examSetTitle } from '@/lib/exam-set';
import { mergeExamSet } from '@/lib/merge-submissions';
import { MergeNotesDialog } from '../components/MergeNotesDialog';
import { SubmissionThumb } from '../components/SubmissionBits';

/** 행별 AI 상태 표시 — 진행 중이면 단계·프로그레스, 끝났으면 완료 배지 */
function AiStatusLine({
  sub,
  saved,
}: {
  sub: SubmissionRow;
  saved: AiStatusDoc | null | undefined;
}) {
  const prog = getDocAiStatus(sub.id);
  if (prog) {
    const pct =
      prog.total > 0
        ? Math.round((prog.done / prog.total) * 100)
        : 0;
    return (
      <div className="mt-1 flex items-center gap-2">
        <span className="inline-block size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-line-brand border-t-transparent" />
        <span className="text-[11px] font-semibold text-brand">
          AI {prog.stage} 중 {prog.done}/{prog.total}
        </span>
        <div className="h-1 w-24 overflow-hidden rounded-full bg-brand-weak">
          <div
            className="h-full rounded-full bg-brand transition-[width]"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  }
  if (pendingLearnReport(sub.id)) {
    return (
      <div className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold text-brand">
        <span className="inline-block size-3 animate-spin rounded-full border-[1.5px] border-line-brand border-t-transparent" />
        분석리포트 생성 중…
      </div>
    );
  }
  if (saved === undefined) return null; // 상태 조회 중 — 깜빡임 방지
  if (saved === null) {
    return (
      <div className="mt-1 text-[11px] text-ink-subtle">
        AI 분석 전 — 수신하면 자동으로 채점·분석됩니다
      </div>
    );
  }
  if (saved.epoch !== AI_EPOCH) {
    return (
      <div className="mt-1 text-[11px] font-semibold text-[#b45309]">
        분석 기준이 바뀌었습니다 — 자동으로 다시 처리됩니다
      </div>
    );
  }
  if (saved.strokeCount !== sub.strokeCount) {
    return (
      <div className="mt-1 text-[11px] font-semibold text-[#b45309]">
        새 필기 분석 대기 — 다음 수신 때 바뀐 문항만 자동 갱신됩니다
      </div>
    );
  }
  if (saved.failed > 0) {
    return (
      <div className="mt-1 text-[11px] font-semibold text-[#b45309]">
        AI 분석 일부 실패 — [열기]를 누르면 자동 재시도됩니다
      </div>
    );
  }
  if (saved.totalNumbered === 0) {
    return (
      <div className="mt-1 text-[11px] font-semibold text-[#1a7f37]">
        ✓ AI 확인 완료 — 채점할 문항 없음 (표지 등)
      </div>
    );
  }
  return (
    <div className="mt-1 text-[11px] font-semibold text-[#1a7f37]">
      ✓ AI 채점·분석 완료
    </div>
  );
}

/** 수치 한 칸 — 라벨과 값을 붙여 읽게 한다 */
function Stat({
  label,
  value,
  tone = 'muted',
}: {
  label: string;
  value: number;
  tone?: 'muted' | 'ok' | 'warn';
}) {
  const color =
    tone === 'ok'
      ? 'text-[#1a7f37]'
      : tone === 'warn'
        ? 'text-[#b45309]'
        : 'text-ink-subtle';
  return (
    <span className={`inline-flex items-baseline gap-1 ${color}`}>
      <span>{label}</span>
      <span className="font-bold tabular-nums">{value}</span>
    </span>
  );
}

/**
 * **총 페이지 · 총 문항 · AI 인식 완료 · 미풀이** 를 나눠 보여준다
 * (사용자 요구 2026-08-24). 종전에는 "문항 6/6" 한 덩어리여서 분모가 무엇인지,
 * 학생이 아직 안 푼 문항이 몇 개인지 구분되지 않았다.
 *
 * 문항 수치는 AI 처리 요약(ai-status)이 있어야 알 수 있다 — 없으면 페이지만 보인다.
 * `unsolved` 는 이번 변경 이후 저장된 요약에만 있으므로, 없으면 그 칸을 감춘다
 * (구버전 요약에 0 을 표시해 "다 풀었다"고 오해시키지 않는다).
 */
function CountsLine({
  sub,
  saved,
}: {
  sub: SubmissionRow;
  saved: AiStatusDoc | null | undefined;
}) {
  const parts = [<Stat key="page" label="페이지" value={sub.pageCount} />];
  if (saved) {
    parts.push(<Stat key="total" label="총 문항" value={saved.totalNumbered} />);
    if (saved.totalNumbered > 0) {
      parts.push(
        <Stat key="graded" label="AI 인식" value={saved.graded} tone="ok" />,
      );
      if (saved.unsolved != null) {
        parts.push(
          <Stat
            key="unsolved"
            label="미풀이"
            value={saved.unsolved}
            tone={saved.unsolved > 0 ? 'warn' : 'muted'}
          />,
        );
      }
    }
  }
  return (
    <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs text-ink-subtle">
      {parts.map((node, i) => (
        <span key={i} className="inline-flex items-baseline gap-1.5">
          {i > 0 && <span aria-hidden>·</span>}
          {node}
        </span>
      ))}
      {sub.feedbackVisible && (
        <span className="inline-flex items-baseline gap-1.5">
          <span aria-hidden>·</span> 피드백 공개됨
        </span>
      )}
    </div>
  );
}

/**
 * **언제 쓴 기록인가** — `writtenTo`(마지막 필기)를 정본으로 본다.
 *
 * `createdAt` 은 *문서가 만들어진* 시각이다. 같은 문서에 뒤늦게 필기가 합쳐지면
 * createdAt 은 그대로라서, 8/17 에 쓴 것이 8/16 로 보인다(사용자 지적 2026-08-17).
 * 필기 시각이 없는 옛 데이터는 createdAt 으로 되돌아간다.
 */
function writtenAt(s: SubmissionRow): number {
  const t =
    Date.parse(s.writtenTo ?? '') ||
    Date.parse(s.writtenFrom ?? '') ||
    Date.parse(s.createdAt) ||
    0;
  return t;
}

export function StudentNotesPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [studentName, setStudentName] = useState<string | null>(null);
  const [subs, setSubs] = useState<SubmissionRow[] | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  /**
   * 필기 기록 삭제 (사용자 요구 2026-08-17). 필기 원본·썸네일·피드백까지
   * 함께 사라지고 **되돌릴 수 없으므로** confirm 으로 한 번 막는다.
   */
  const removeSubmission = async (sub: SubmissionRow) => {
    const when = kstStamp(sub.createdAt);
    if (
      !window.confirm(
        `"${sub.title}" (${when}) 필기 기록을 삭제할까요?\n필기 원본과 피드백도 함께 삭제되며 되돌릴 수 없습니다.`,
      )
    )
      return;
    setDeleting(sub.id);
    setDeleteError(null);
    try {
      await deleteSubmission(sub);
      setSubs((list) => (list ?? []).filter((x) => x.id !== sub.id));
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(null);
    }
  };
  const [error, setError] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [mergeNote, setMergeNote] = useState<string | null>(null);

  /**
   * 같은 시험지 세트(표지 + 문제지)를 한 기록으로 합친다 — 되돌릴 수 없다.
   * 앞으로 수신되는 필기는 저장 단계에서 세트로 묶이므로 갈리지 않는다.
   */
  const [mergeOpen, setMergeOpen] = useState(false);

  const mergeSet = async (
    list: SubmissionRow[],
    title = '',
    fromDialog = false,
  ) => {
    if (!id || merging) return;
    if (!fromDialog) {
      const names = list.map((x) => `· ${x.title}`).join('\n');
      if (
        !window.confirm(
          `아래 ${list.length}건을 한 기록으로 합칠까요?\n\n${names}\n\n` +
            '되돌릴 수 없습니다. 합친 뒤에는 AI 채점·리포트를 다시 만들어야 합니다.',
        )
      )
        return;
    }
    setMerging(true);
    setMergeNote(null);
    try {
      const r = await mergeExamSet(id, list, {
        keepGivenOrder: fromDialog,
        title,
      });
      setMergeOpen(false);
      setSubs(
        (prev) =>
          (prev ?? [])
            .filter((x) => x.id === r.keptId || !list.some((y) => y.id === x.id))
            .map((x) =>
              x.id === r.keptId
                ? {
                    ...x,
                    title: r.title,
                    strokeCount: r.strokeCount,
                    pageCount: r.pageCount,
                  }
                : x,
            ),
      );
      setMergeNote(
        `합쳤습니다 — "${r.title}" (${r.pageCount}페이지 · 획 ${r.strokeCount}). ` +
          'AI 채점·분석을 바로 시작합니다 — 끝나면 리포트를 다시 생성해 주세요.',
      );
      // 합치면 문서 구성이 바뀐다 — 앱을 껐다 켜지 않아도 **즉시** 다시 훑어
      // 채점·분석이 붙게 한다(리스트에 진행률이 그대로 뜬다).
      void wireAutoGradeCatchUp({
        listStudents: listMyStudents,
        listSubmissions: listStudentSubmissions,
        force: true,
      });
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setMerging(false);
    }
  };

  // ── AI 진행 상태 구독 + 저장된 처리 요약(ai-status) 로드 ──
  useSyncExternalStore(subscribeReceiveState, receiveStateVersion);
  const [aiStatus, setAiStatus] = useState<
    Record<string, AiStatusDoc | null>
  >({});
  // 자동 파이프라인이 도는 문서 집합 — 멤버가 바뀌면(시작/완료) 요약을 다시 읽는다
  const activeDocIds = (subs ?? [])
    .filter((s) => isAutoGrading(s.id))
    .map((s) => s.id)
    .join(',');
  useEffect(() => {
    if (!id || !subs || subs.length === 0) return;
    let alive = true;
    void (async () => {
      const entries = await Promise.all(
        subs.map(
          async (s) => [s.id, await loadAiStatus(id, s.id)] as const,
        ),
      );
      if (alive) setAiStatus(Object.fromEntries(entries));
    })();
    return () => {
      alive = false;
    };
  }, [id, subs, activeDocIds]);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    Promise.all([listMyStudents(), listStudentSubmissions(id)])
      .then(([students, list]) => {
        if (!alive) return;
        setStudentName(students.find((st) => st.id === id)?.name ?? null);
        setSubs(list);
      })
      .catch((err) => {
        if (alive) {
          setError(
            err instanceof Error
              ? err.message
              : '필기 기록을 불러오지 못했습니다.',
          );
        }
      });
    return () => {
      alive = false;
    };
  }, [id]);

  /**
   * **날짜별**로 묶고, 각 줄에 문제지 이름과 시각을 보여준다
   * (사용자 요구 2026-08-17). 선생님은 "언제 썼나"로 먼저 찾고 그 안에서
   * 어느 교재였는지 가린다. 같은 날 여러 교재를 풀어도 한눈에 들어온다.
   * 날짜는 최근 순, 같은 날 안에서도 최근에 쓴 것부터.
   */
  const byDay = useMemo(() => {
    const m = new Map<string, SubmissionRow[]>();
    for (const s of subs ?? []) {
      const t = writtenAt(s);
      // **한국 시간 고정** — 보는 사람의 PC 시간대와 무관하게 같은 날짜로 묶인다
      const key = t ? kstDateKey(t) : '0000-00-00';
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(s);
    }
    for (const list of m.values()) {
      list.sort((a, b) => writtenAt(b) - writtenAt(a));
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [subs]);

  return (
    <div className="space-y-5">
      <div>
        <button
          type="button"
          onClick={() => navigate('/t/students')}
          className="inline-flex items-center gap-1.5 text-sm text-ink-subtle hover:text-ink"
        >
          <ArrowLeft size={15} /> 학생 관리
        </button>
        <h2 className="mt-2 text-lg font-bold text-ink">
          {studentName ? `${studentName} 필기 기록` : '필기 기록'}
        </h2>
        <p className="mt-0.5 text-sm text-ink-muted">
          날짜별로 묶어 최근에 쓴 것부터 보여줍니다. [열기]를 누르면 재생·AI
          과정 분석·필기 인식·피드백 작성 화면으로 이동합니다.
        </p>
      </div>

      {deleteError && (
        <Callout tone="critical" description={deleteError} />
      )}

      {mergeNote && <Callout tone="positive" description={mergeNote} />}

      {/* 합치기는 **상시 기능** — 자동 감지에만 기대면 못 합치는 구성이 생긴다
          (사용자 요구 2026-08-25). 여기서 문제지를 골라 순서까지 정한다. */}
      {(subs?.length ?? 0) >= 2 && (
        <div className="flex justify-end">
          <ActionButton
            variant="neutralOutline"
            size="xsmall"
            disabled={merging}
            onClick={() => setMergeOpen(true)}
          >
            필기 기록 합치기
          </ActionButton>
        </div>
      )}
      <MergeNotesDialog
        open={mergeOpen}
        subs={subs ?? []}
        busy={merging}
        onClose={() => setMergeOpen(false)}
        onMerge={(ordered, title) => void mergeSet(ordered, title, true)}
      />

      {error ? (
        <Callout
          tone="warning"
          description={`필기 기록을 불러오지 못했습니다. (${error})`}
        />
      ) : subs === null ? (
        <div className="space-y-3">
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-16 rounded-lg" />
        </div>
      ) : byDay.length === 0 ? (
        <div className="rounded-xl border border-line-weak bg-layer-default">
          <EmptyState
            illustration="pen"
            title="아직 저장된 필기가 없습니다"
            description="학생 관리에서 펜을 배정하고 학생이 쓰면 날짜별로 자동 저장됩니다."
          />
        </div>
      ) : (
        <div className="space-y-6">
          {byDay.map(([day, list]) => (
            <section key={day}>
              <h3 className="mb-2 flex flex-wrap items-baseline gap-2 text-sm font-bold text-ink">
                {kstDayLabel(day)}
                <span className="text-xs font-normal text-ink-subtle">{list.length}건</span>
              </h3>
              {/* 같은 시험지 세트가 갈려 있으면 합칠 수 있게 알려 준다 —
                  표지(계산력)와 문제지는 PDF 만 다를 뿐 한 시험이다. */}
              {(() => {
                const sets = new Map<string, SubmissionRow[]>();
                for (const x of list) {
                  const k = examSetTitle(x.title);
                  if (!k || k === x.title) continue; // 세트 표기가 없는 제목
                  if (!sets.has(k)) sets.set(k, []);
                  sets.get(k)!.push(x);
                }
                const candidates = [...sets.entries()].filter(
                  ([, v]) => v.length >= 2,
                );
                if (candidates.length === 0) return null;
                return (
                  <div className="mb-2 space-y-2">
                    {candidates.map(([k, v]) => (
                      <div
                        key={k}
                        data-testid="merge-set-banner"
                        className="flex flex-wrap items-center gap-2 rounded-lg border border-[#f0c9a4] bg-[#fff8ef] px-3 py-2 text-xs leading-relaxed text-[#8a5a1c]"
                      >
                        <span>
                          <b>{k}</b> 이(가) {v.length}건으로 갈려 있습니다 — 표지와
                          문제지는 한 시험지입니다.
                        </span>
                        <ActionButton
                          variant="neutralOutline"
                          size="xsmall"
                          loading={merging}
                          disabled={merging}
                          onClick={() => void mergeSet(v)}
                        >
                          한 기록으로 합치기
                        </ActionButton>
                      </div>
                    ))}
                  </div>
                );
              })()}
              <div className="overflow-hidden rounded-xl border border-line-weak bg-layer-default">
                {list.map((sub, i) => (
                  <div
                    key={sub.id}
                    className={
                      'flex items-center gap-3 px-4 py-3' +
                      (i > 0 ? ' border-t border-line-weak' : '')
                    }
                  >
                    <SubmissionThumb path={sub.thumbnailPath} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-ink">
                        {sub.title || '(제목 없음)'}
                        <span className="ml-1.5 text-xs font-normal text-ink-subtle">
                          ({kstStamp(writtenAt(sub))})
                        </span>
                      </div>
                      <CountsLine sub={sub} saved={aiStatus[sub.id]} />
                      {/* 본인 확인 — 표지 이름이 다르면 열어보기 전에 알아야 한다 */}
                      {aiStatus[sub.id]?.idNameMatch === false && (
                        <div className="mt-1 text-[11px] font-bold text-[#a1191d]">
                          ⚠ 표지 이름 불일치 — 시험지: {aiStatus[sub.id]?.idName || '(읽지 못함)'}
                        </div>
                      )}
                      <AiStatusLine sub={sub} saved={aiStatus[sub.id]} />
                    </div>
                    <ActionButton
                      variant="brandOutline"
                      size="xsmall"
                      onClick={() => navigate(`/t/submissions/${sub.id}`)}
                    >
                      열기
                    </ActionButton>
                    <ActionButton
                      variant="neutralOutline"
                      size="xsmall"
                      loading={deleting === sub.id}
                      disabled={!!deleting}
                      onClick={() => void removeSubmission(sub)}
                    >
                      <span className="inline-flex items-center gap-1 text-critical">
                        <Trash2 size={13} /> 삭제
                      </span>
                    </ActionButton>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
