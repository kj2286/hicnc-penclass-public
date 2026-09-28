import { AssessmentReferences } from './AssessmentReferences';
/**
 * AI 과정 분석 패널 — 리뷰 페이지의 분석 결과 렌더 + 인라인 수정.
 *
 * 문항 범위일 때는 캔버스 좌/우 여백(aside)에, 전체·페이지 범위일 때는
 * 풀폭으로 배치된다 (배치는 ReviewPage 담당 — 이 컴포넌트는 내용만).
 *
 * 표시 순서: 헤드라인/개요 → 정답 판정 → 풀이 결과(펜 데이터: 도출·시도·
 * 재방문·소요·체감 난이도) → 심리 상태 → 단계(타임라인) → 문제점(빨간) →
 * 특성(속도·수정/멈춤 — 필압은 이 펜이 0/1 접촉값뿐이라 표시하지 않는다).
 */
import {
  BookOpenCheck,
  Brain,
  CircleAlert,
  ClipboardList,
  Gauge,
  Play,
  Plus,
  RefreshCcw,
  RotateCcw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { Skeleton } from '@seed-design/react';
import { ActionButton } from 'seed-design/ui/action-button';
import { Callout } from 'seed-design/ui/callout';
import type {
  AnalysisReport,
  AnalysisSolution,
  AnswerVerdict,
  SolveOutcome,
} from '@/lib/api';
import type { ProblemGrade } from '@/lib/grade-score';
import { Editable } from './Editable';
import { SolutionImage } from './SolutionImage';
import { LatexText } from '@/components/LatexText';
import { formatDuration, formatTimecode } from '@/lib/duration';
import {
  CONFIDENCE_LABEL,
  DEPTH_VERDICT_LABEL,
  KOREAN_DEPTHS,
  REVISION_LABEL,
  depthName,
  depthScoreRate,
  type DepthVerdict,
} from '@/lib/korean-analysis';

const formatGap = formatDuration;

/** Depth 판정별 점 색 — 표에서 눈으로 훑게 */
const DEPTH_DOT: Record<DepthVerdict, string> = {
  met: 'bg-[#34c759]',
  partial: 'bg-[#ff9f0a]',
  missed: 'bg-[#ff3b30]',
  na: 'bg-[#c7c7cc]',
};

/**
 * 국어 문항 분석 — 5-Depth 성취 × 행동 심리.
 * 국어 교재에서만 채워진다(다른 과목은 korean 이 없다).
 * ⚠️ 확신도는 **필압이 아니라** 속도·멈칫·시도·수정으로 본다 — 이 펜의 필압은 0/1 이다.
 */
function KoreanInsightBlock({
  korean,
}: {
  korean: NonNullable<AnalysisReport['korean']>;
}) {
  const depths = korean.depths ?? [];
  const rate = depthScoreRate(depths);
  const behavior = korean.behavior;
  return (
    <div
      data-testid="analysis-korean"
      className="rounded-lg border border-line-weak bg-layer-fill px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-ink">
        <BookOpenCheck size={14} className="text-brand" /> 국어 5-Depth 성취
        {rate != null && (
          <span className="rounded-full bg-brand-weak px-2 py-0.5 text-[11px] font-bold text-brand">
            {rate}점
          </span>
        )}
        {korean.area && (
          <span className="rounded-full border border-line-weak px-2 py-0.5 text-[11px] font-medium text-ink-muted">
            {korean.area}
          </span>
        )}
      </div>

      <ul className="mt-2 space-y-1.5">
        {KOREAN_DEPTHS.map((d) => {
          const hit = depths.find((x) => x.depth === d.depth);
          const verdict: DepthVerdict = hit?.verdict ?? 'na';
          return (
            <li key={d.depth} className="flex items-start gap-2 text-[13px]">
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DEPTH_DOT[verdict]}`}
                aria-hidden
              />
              <span className="w-[92px] shrink-0 font-medium text-ink">
                D{d.depth} {depthName(d.depth)}
              </span>
              <span className="w-[52px] shrink-0 text-ink-muted">
                {DEPTH_VERDICT_LABEL[verdict]}
              </span>
              <span className="min-w-0 flex-1 leading-relaxed text-ink-muted">
                {hit?.note?.trim() || '—'}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 grid gap-2 border-t border-line-weak pt-3 sm:grid-cols-2">
        <div>
          <div className="text-[11px] font-semibold text-ink-subtle">확신도</div>
          <div className="text-[13px] font-medium text-ink">
            {CONFIDENCE_LABEL[behavior?.confidence ?? 'unknown']}
          </div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">
            {behavior?.confidenceNote?.trim() || '—'}
          </p>
        </div>
        <div>
          <div className="text-[11px] font-semibold text-ink-subtle">수정 궤적</div>
          <div className="text-[13px] font-medium text-ink">
            {REVISION_LABEL[behavior?.revision ?? 'unknown']}
          </div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">
            {behavior?.revisionNote?.trim() || '—'}
          </p>
        </div>
      </div>

      {behavior?.overloadNote?.trim() && (
        <p className="mt-2 border-t border-line-weak pt-2 text-[12px] leading-relaxed text-ink-muted">
          <b className="text-ink">인지 과부하</b> {behavior.overloadNote}
        </p>
      )}
      {korean.coaching?.trim() && (
        <p className="mt-2 rounded-md bg-layer-default px-3 py-2 text-[12px] leading-relaxed text-ink">
          <b>지도 포인트</b> {korean.coaching}
        </p>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-ink-subtle">
        확신도는 필압이 아니라 필기 속도·멈칫·시도 횟수·수정 흔적으로 봅니다 (이 펜은
        필압을 종이에 닿았는지 여부로만 기록합니다).
      </p>
    </div>
  );
}

/**
 * 내신 시험지(수학) 문항 행동 데이터 — 번복·인지 블록·부분 점수.
 * 값이 없으면 그 줄을 아예 안 그린다(0 으로 채워 있는 척하지 않는다).
 */
function ExamInsightBlock({ exam }: { exam: NonNullable<AnalysisReport['exam']> }) {
  const rows: Array<[string, string]> = [];
  if (exam.overwrites != null) {
    rows.push([
      '풀이 번복',
      `${exam.overwrites}회${exam.overwriteNote?.trim() ? ` · ${exam.overwriteNote.trim()}` : ''}`,
    ]);
  } else if (exam.overwriteNote?.trim()) {
    rows.push(['풀이 번복', exam.overwriteNote.trim()]);
  }
  if (exam.partialPoints != null) rows.push(['부분 점수', `${exam.partialPoints}점`]);
  if (exam.blockNote?.trim()) rows.push(['막힌 지점', exam.blockNote.trim()]);
  if (rows.length === 0) return null;
  return (
    <div
      data-testid="analysis-exam"
      className="rounded-lg border border-line-weak bg-layer-fill px-4 py-3"
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
        <ClipboardList size={14} className="text-brand" /> 내신 행동 데이터
      </div>
      <dl className="mt-2 space-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-2 text-[13px]">
            <dt className="w-[64px] shrink-0 font-medium text-ink">{k}</dt>
            <dd className="min-w-0 flex-1 leading-relaxed text-ink-muted">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const OUTCOME_META: Record<
  SolveOutcome['status'],
  { label: string; cls: string }
> = {
  solved: { label: '결과 도출', cls: 'bg-[#15803d] text-white' },
  partial: { label: '중간까지 진행', cls: 'bg-[#b45309] text-white' },
  attempted: { label: '시도했으나 미완', cls: 'bg-[#dc2626] text-white' },
  not_attempted: { label: '거의 손대지 않음', cls: 'bg-neutral-weak text-ink-muted' },
  unknown: { label: '판정 불가', cls: 'bg-neutral-weak text-ink-muted' },
};

// 체감 난이도 표기는 리포트와 같은 네 단어로 통일한다 (사용자 2026-09-02)
const DIFF_LABEL: Record<SolveOutcome['perceivedDifficulty'], string> = {
  easy: '쉬움',
  normal: '보통',
  hard: '어려움',
  unknown: '비교 불가',
};

const fmtDur = formatDuration;

export function AnalysisPanel({
  analysis,
  loading,
  error,
  edited,
  scopeLabel,
  canRun,
  blockReason,
  onRun,
  onRevert,
  commit,
  jumpTo,
  delays = [],
  onPlayDelay,
  grade = null,
  compact = false,
  modelSolutionState = null,
  modelSolution = null,
}: {
  analysis: AnalysisReport | null;
  /**
   * 이 문항의 모범 풀이 상태 (사용자 요구 2026-09-02) — 'available' 이면 비교
   * 블록(없으면 재분석 안내), 'missing' 이면 "풀이+답안 PDF 가 없어 학생 풀이만으로
   * 분석했다" 안내. null = 문항 범위가 아니라 해당 없음.
   */
  modelSolutionState?: 'available' | 'missing' | null;
  /**
   * 이 문항의 선생님 모범 풀이 — 비교 블록 오른쪽 칸에 **전사(수식)+손풀이 이미지**로
   * 보여준다 (사용자 요구 2026-09-03: 비교를 확인하려면 모범 풀이 자체가 보여야 한다).
   */
  modelSolution?: {
    answer: string;
    solution: string | null;
    imageSrc: string | null;
    page: number | null;
    box: { x0: number; y0: number; x1: number; y1: number } | null;
    /** 크게 보기 (다이얼로그) */
    onEnlarge?: () => void;
  } | null;
  loading: boolean;
  error: string | null;
  edited: boolean;
  scopeLabel: string;
  canRun: boolean;
  /**
   * 분석을 지금 돌리면 **안 되는** 이유. 재생 중이거나 채점이 아직 끝나지 않았을 때
   * 채운다(사용자 요구 2026-08-17: "모든 상태가 다 마무리된 상태에서만").
   * 버튼만 흐리게 두면 왜 안 눌리는지 알 수 없어 문구로 같이 보여준다.
   */
  blockReason?: string | null;
  onRun: (force: boolean) => void;
  onRevert: () => void;
  commit: (mutate: (r: AnalysisReport) => void) => void;
  jumpTo: (fromMs: number) => void;
  /** 이 범위에서 필기가 **끊겼던 구간** (지연). 문항 범위에서 버튼으로 보여준다
   *  (사용자 요구 2026-08-24: 시간 나열 말고, 지연된 데를 눌러 재생하고 싶다). */
  delays?: Array<{ fromMs: number; toMs: number }>;
  /** 지연 구간 자동 재생 — 멈추기 직전 필기부터 다시 시작한 필기까지 */
  onPlayDelay?: (d: { fromMs: number; toMs: number }) => void;
  /** 이 범위의 채점 결과 — **정오 판정의 정본**. 있으면 AI 판정을 덮는다. */
  grade?: ProblemGrade | null;
  /** aside(좌/우 여백) 배치용 — 헤더·설명을 줄인다 */
  compact?: boolean;
}) {
  return (
    <section
      data-testid="analysis-panel"
      className="rounded-xl border border-line-weak bg-layer-default p-5"
    >
      <AssessmentReferences assessment={analysis?.assessment} />
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-ink">
            AI 과정 분석
            <span className="ml-2 align-middle text-xs font-medium text-brand">
              {scopeLabel}
            </span>
            {edited && (
              <span className="ml-2 align-middle text-xs font-medium text-ink-subtle">
                (수정됨)
              </span>
            )}
          </h3>
          {!compact && (
            <p className="mt-0.5 text-xs text-ink-subtle">
              펜 데이터(시도·재방문·속도)와 문제·풀이 인식 결과로 자동
              분석합니다.{' '}
              <strong className="font-semibold text-ink-muted">
                본문을 클릭하면 바로 수정
              </strong>
              되고, 시간을 클릭하면 해당 시점으로 이동해요.
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {edited && (
            <ActionButton
              variant="neutralWeak"
              size="xsmall"
              loading={loading}
              onClick={onRevert}
            >
              <span className="inline-flex items-center gap-1">
                <RotateCcw size={13} /> 원래대로
              </span>
            </ActionButton>
          )}
          {analysis ? (
            <ActionButton
              variant="neutralWeak"
              size="xsmall"
              loading={loading}
              onClick={() => onRun(true)}
            >
              <span className="inline-flex items-center gap-1">
                <RefreshCcw size={13} /> 다시 분석
              </span>
            </ActionButton>
          ) : (
            <ActionButton
              variant="brandSolid"
              size="small"
              loading={loading}
              disabled={!canRun}
              title={blockReason ?? undefined}
              onClick={() => onRun(false)}
            >
              <span className="inline-flex items-center gap-1.5">
                <Sparkles size={15} /> AI 분석
              </span>
            </ActionButton>
          )}
        </div>
      </div>

      {blockReason && (
        <div className="mb-3">
          <Callout tone="informative" description={blockReason} />
        </div>
      )}

      {error && (
        <div className="mb-3">
          <Callout tone="critical" description={error} />
        </div>
      )}

      {loading && !analysis && (
        <div className="space-y-2">
          <Skeleton className="h-7 w-56 rounded-lg" />
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-16 rounded-lg" />
          <p className="text-xs text-ink-subtle">
            펜 데이터를 분석하고 있어요… (수십 초 걸릴 수 있습니다)
          </p>
        </div>
      )}

      {analysis && (
        <div className="space-y-3">
          <div>
            <div className="text-lg font-bold text-brand">
              “
              <Editable
                value={analysis.headline}
                onCommit={(v) => commit((r) => void (r.headline = v))}
              />
              ”
            </div>
            <Editable
              as="p"
              multiline
              value={analysis.overview ?? ''}
              onCommit={(v) => commit((r) => void (r.overview = v))}
              className="mt-1 block text-sm text-ink-muted"
            />
          </div>

          {/* 정답 판정 — 학생 답 vs 올바른 답. **문항 범위에서만** 보인다.
              전체·페이지 범위는 답이 하나가 아니라 이 카드가 성립하지 않는다 —
              표지의 이름("김경수 입니다")을 학생 답으로 띄운 실사고(2026-08-18). */}
          {compact && (() => {
            // 정오 판정의 정본은 **채점 결과**다. AI 과정 분석은 지문 이미지를
            // 다시 보고 답을 재추론하다가 뒤집는 일이 있었다 — 학생이 분명히
            // 5 를 썼는데 "답 없음·오답" 으로 적은 사고(2026-08-17 2·4번).
            // 채점은 문항 이미지를 따로 보고 매기는 전용 패스이므로 그쪽을 따른다.
            const graded = !!grade &&
              (grade.verdict === 'correct' || grade.verdict === 'wrong');
            const sol: AnalysisSolution = graded
              ? {
                  studentAnswer: grade!.studentAnswer,
                  correctAnswer: grade!.correctAnswer,
                  verdict: grade!.verdict as AnswerVerdict,
                  explanation: grade!.explanation || analysis.solution?.explanation || '',
                }
              : (analysis.solution ?? {
                  studentAnswer: '',
                  correctAnswer: '',
                  verdict: 'unknown',
                  explanation: '',
                });
            const patchSol = (patch: Partial<AnalysisSolution>) =>
              commit((r) => void (r.solution = { ...sol, ...patch }));
            const META: Record<
              AnswerVerdict,
              { label: string; cls: string; next: AnswerVerdict }
            > = {
              correct: { label: '정답', cls: 'bg-[#15803d] text-white', next: 'wrong' },
              wrong: { label: '오답', cls: 'bg-[#dc2626] text-white', next: 'unknown' },
              unknown: {
                label: '판정 불가',
                cls: 'bg-neutral-weak text-ink-muted',
                next: 'correct',
              },
            };
            const vm = META[sol.verdict];
            return (
              <div
                data-testid="analysis-solution"
                className={
                  'rounded-lg border px-4 py-3 ' +
                  (sol.verdict === 'wrong'
                    ? 'border-[#dc2626]/50 bg-[#dc2626]/5'
                    : 'border-line-weak bg-layer-fill')
                }
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <button
                    type="button"
                    title={
                      graded
                        ? '채점 결과를 따릅니다 — 바꾸려면 위 채점을 다시 실행하세요'
                        : '클릭해서 정답/오답/판정 불가 전환'
                    }
                    disabled={graded}
                    onClick={() => patchSol({ verdict: vm.next })}
                    className={
                      'rounded-md px-2 py-0.5 text-xs font-bold ' +
                      vm.cls +
                      (graded ? ' cursor-default' : '')
                    }
                  >
                    {vm.label}
                  </button>
                  {graded && (
                    <span className="text-[11px] text-ink-subtle">채점 결과 기준</span>
                  )}
                  <span className="text-sm text-ink-muted">
                    학생 답:{' '}
                    <Editable
                      value={sol.studentAnswer || '(답 없음)'}
                      onCommit={(v) => patchSol({ studentAnswer: v })}
                      className="font-bold text-ink"
                    />
                  </span>
                  <span className="text-sm text-ink-muted">
                    정답:{' '}
                    <Editable
                      value={sol.correctAnswer || '(미확인)'}
                      onCommit={(v) => patchSol({ correctAnswer: v })}
                      className={
                        'font-bold ' +
                        (sol.verdict === 'wrong' ? 'text-[#dc2626]' : 'text-ink')
                      }
                    />
                  </span>
                </div>
                <Editable
                  as="p"
                  multiline
                  value={sol.explanation || '(풀이 설명 — 클릭해 입력)'}
                  onCommit={(v) => patchSol({ explanation: v })}
                  className="mt-1.5 block text-xs leading-relaxed text-ink-muted"
                />
              </div>
            );
          })()}

          {/* 풀이 결과 — 펜 데이터 기반 (도출·시도·재방문·소요·체감 난이도) */}
          {(() => {
            const oc: SolveOutcome = analysis.outcome ?? {
              status: 'unknown',
              reason: '',
              attempts: 0,
              revisits: 0,
              timeSpentMs: 0,
              perceivedDifficulty: 'unknown',
              difficultyNote: '',
            };
            const om = OUTCOME_META[oc.status];
            return (
              <div
                data-testid="analysis-outcome"
                className="rounded-lg border border-line-weak bg-layer-fill px-4 py-3"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
                    <Gauge size={14} className="text-brand" /> 풀이 결과
                  </span>
                  <span className={'rounded-md px-2 py-0.5 font-bold ' + om.cls}>
                    {om.label}
                  </span>
                  {oc.timeSpentMs > 0 && (
                    <span className="text-ink-muted">
                      실제 필기 <strong className="text-ink">{fmtDur(oc.timeSpentMs)}</strong>
                    </span>
                  )}
                  {oc.attempts > 0 && (
                    <span className="text-ink-muted">
                      시도 <strong className="text-ink">{oc.attempts}회</strong>
                    </span>
                  )}
                  {oc.revisits > 0 && (
                    <span className="text-ink-muted">
                      다른 문제 풀다 복귀{' '}
                      <strong className="text-ink">{oc.revisits}회</strong>
                    </span>
                  )}
                  <span className="text-ink-muted">
                    체감 난이도{' '}
                    <strong className="text-ink">
                      {DIFF_LABEL[oc.perceivedDifficulty]}
                    </strong>
                  </span>
                </div>
                {(oc.reason || oc.status !== 'solved') && (
                  <p className="mt-1.5 text-sm leading-relaxed text-ink">
                    <Editable
                      value={oc.reason || '(미해결 이유 — 클릭해 입력)'}
                      onCommit={(v) =>
                        commit((r) => void (r.outcome = { ...oc, reason: v }))
                      }
                      multiline
                    />
                  </p>
                )}
                {oc.difficultyNote && (
                  <p className="mt-1 text-xs text-ink-muted">
                    난이도 근거:{' '}
                    <Editable
                      value={oc.difficultyNote}
                      onCommit={(v) =>
                        commit(
                          (r) => void (r.outcome = { ...oc, difficultyNote: v }),
                        )
                      }
                    />
                  </p>
                )}
              </div>
            );
          })()}

          {/* 모범 풀이 비교 — 선생님이 올린 풀이+답안과 학생 풀이를 견준 결과
              (사용자 요구 2026-09-02). 같은지·다른지·왜 다른지·정답과 엇갈린 경우까지. */}
          {modelSolutionState != null && (() => {
            const mc = analysis.modelComparison ?? null;
            /** 오른쪽 칸 — 선생님 모범 풀이 (정답·전사·손풀이 원본) */
            const solutionPanel = modelSolution ? (
              <aside
                data-testid="model-solution-panel"
                className="rounded-lg border border-line-weak bg-white px-3 py-2.5 text-sm"
              >
                <div className="flex items-center gap-2 text-[11px] font-semibold text-ink-subtle">
                  선생님 모범 풀이 (해설 PDF)
                  {modelSolution.onEnlarge && modelSolution.imageSrc && (
                    <button
                      type="button"
                      onClick={modelSolution.onEnlarge}
                      className="ml-auto rounded border border-line-weak px-1.5 py-0.5 text-[11px] font-normal text-ink-muted hover:text-ink"
                    >
                      크게 보기
                    </button>
                  )}
                </div>
                <div className="mt-1 text-ink">
                  <span className="font-bold">정답</span>{' '}
                  <LatexText text={modelSolution.answer} />
                </div>
                {modelSolution.solution ? (
                  <div className="mt-1.5 whitespace-pre-wrap leading-relaxed text-ink">
                    <LatexText text={modelSolution.solution} />
                  </div>
                ) : (
                  <p className="mt-1.5 text-xs text-ink-muted">
                    이 문항은 답만 실려 있습니다 (풀이 전사 없음).
                  </p>
                )}
                {modelSolution.imageSrc && modelSolution.page != null ? (
                  <div className="mt-2">
                    <SolutionImage
                      src={modelSolution.imageSrc}
                      box={modelSolution.box}
                      page={modelSolution.page}
                      caption={modelSolution.solution ? '손풀이 원본' : '정답표'}
                    />
                  </div>
                ) : modelSolution.page != null ? (
                  <p className="mt-2 text-xs text-ink-subtle">해설 이미지를 불러오는 중…</p>
                ) : null}
              </aside>
            ) : null;
            if (!mc) {
              return (
                <div className="space-y-2">
                  <div
                    data-testid="analysis-model-note"
                    className="rounded-lg border border-dashed border-line-weak px-4 py-2.5 text-xs text-ink-muted"
                  >
                    {modelSolutionState === 'missing'
                      ? '풀이+답안 PDF 가 없어 학생의 풀이만으로 분석했습니다. 교재 만들기에서 풀이+답안을 올리면 선생님 풀이와 비교해 드립니다.'
                      : '모범 풀이가 등록됐지만 이 분석은 그 전에 만들어졌습니다 — [다시 분석]하면 선생님 풀이와의 비교가 붙습니다.'}
                  </div>
                  {solutionPanel}
                </div>
              );
            }
            const V: Record<string, { label: string; cls: string }> = {
              same: { label: '모범 풀이와 같음', cls: 'bg-[#15803d] text-white' },
              similar: { label: '비슷하지만 일부 다름', cls: 'bg-[#b45309] text-white' },
              different: { label: '다른 접근', cls: 'bg-[#1c5fb8] text-white' },
              unknown: { label: '비교 판정 불가', cls: 'bg-neutral-weak text-ink-muted' },
            };
            const v = V[mc.verdict] ?? V.unknown;
            const patch = (part: Partial<typeof mc>) =>
              commit((r) => void (r.modelComparison = { ...mc, ...part }));
            const row = (
              key: keyof typeof mc,
              title: string,
              placeholder: string,
            ) =>
              mc[key] || !compact ? (
                <div key={key}>
                  <div className="text-[11px] font-semibold text-ink-subtle">{title}</div>
                  <Editable
                    as="p"
                    multiline
                    value={String(mc[key] || placeholder)}
                    onCommit={(val) => patch({ [key]: val } as Partial<typeof mc>)}
                    className="block text-sm leading-relaxed text-ink"
                  />
                </div>
              ) : null;
            return (
              <div
                data-testid="analysis-model-comparison"
                className="rounded-lg border border-line-weak bg-layer-fill px-4 py-3"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
                    <Gauge size={14} className="text-brand" /> 모범 풀이 비교
                  </span>
                  <span className={'rounded-md px-2 py-0.5 font-bold ' + v.cls}>
                    {v.label}
                  </span>
                </div>
                {mc.summary && (
                  <Editable
                    as="p"
                    value={mc.summary}
                    onCommit={(val) => patch({ summary: val })}
                    className="mt-1.5 block text-sm font-semibold leading-relaxed text-ink"
                  />
                )}
                {/* 왼쪽 = 비교 서술, 오른쪽 = 선생님 손풀이 (사용자 요구 2026-09-03) */}
                <div
                  className={
                    'mt-2 grid gap-4 ' +
                    (solutionPanel ? 'md:grid-cols-[minmax(0,1fr)_minmax(260px,42%)]' : '')
                  }
                >
                  <div className="space-y-2">
                    {row('studentApproach', '학생의 풀이', '(학생이 어떻게 풀었는지 — 클릭해 입력)')}
                    {row('modelApproach', '선생님 모범 풀이', '(모범 풀이의 접근 — 클릭해 입력)')}
                    {mc.verdict !== 'same' &&
                      row('difference', '어디가 다른가', '(다른 점 — 클릭해 입력)')}
                    {mc.verdict !== 'same' &&
                      row('whyDifferent', '왜 그렇게 풀었을까 (학생의 의도)', '(의도 추정 — 클릭해 입력)')}
                    {mc.mismatchNote &&
                      row('mismatchNote', '정답과 풀이가 엇갈린 경우', '')}
                    {row('advice', '다음 지도 포인트', '(지도 포인트 — 클릭해 입력)')}
                  </div>
                  {solutionPanel}
                </div>
              </div>
            );
          })()}

          {/* 국어 5-Depth × 행동 심리 (국어 교재에서만) */}
          {analysis.korean && <KoreanInsightBlock korean={analysis.korean} />}

          {/* 내신 시험지 행동 데이터 (수학 교재에서만) */}
          {analysis.exam && <ExamInsightBlock exam={analysis.exam} />}

          {/* 심리 상태 */}
          <div
            data-testid="analysis-psychology"
            className="rounded-lg border border-line-weak bg-layer-fill px-4 py-3"
          >
            <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
              <Brain size={14} className="text-brand" /> 심리 상태
            </div>
            <Editable
              as="p"
              multiline
              value={analysis.psychology || '(관찰 없음 — 클릭해 직접 입력할 수 있어요)'}
              onCommit={(v) => commit((r) => void (r.psychology = v))}
              className="mt-1 block text-sm leading-relaxed text-ink-muted"
            />
          </div>

          {/* 풀이 과정 — **시간대 나열 대신 서술형** (사용자 요구 2026-08-24).
              구버전 분석에는 narrative 가 없으므로 단계 본문을 이어 붙여 글로 만든다
              (그때도 "0:34~7:15" 같은 시각 라벨은 보여주지 않는다). */}
          {!compact &&
            (() => {
              const text =
                analysis.narrative?.trim() ||
                analysis.stages
                  .map((st) => st.body?.trim())
                  .filter(Boolean)
                  .join(' ');
              if (!text) return null;
              return (
                <div
                  data-testid="analysis-narrative"
                  className="rounded-lg border border-line-weak bg-layer-fill px-4 py-3"
                >
                  <div className="text-xs font-semibold text-ink">풀이 과정</div>
                  <Editable
                    as="p"
                    multiline
                    value={text}
                    onCommit={(v) => commit((r) => void (r.narrative = v))}
                    className="mt-1 block text-sm leading-relaxed text-ink-muted"
                  />
                </div>
              );
            })()}

          {/* 지연 구간 — 문항 범위에서 "여기서 멈췄다"를 눌러 재생한다.
              (문항 상세에서는 시간 단계 목록을 아예 띄우지 않는다.) */}
          {compact && delays.length > 0 && onPlayDelay && (
            <div
              data-testid="analysis-delays"
              className="rounded-lg border border-line-weak bg-layer-fill px-4 py-3"
            >
              <div className="text-xs font-semibold text-ink">
                멈춘 구간 {delays.length}곳
                <span className="ml-1 font-normal text-ink-subtle">
                  — 누르면 그 지점 앞뒤를 재생합니다
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {delays.map((d) => (
                  <button
                    key={`${d.fromMs}-${d.toMs}`}
                    type="button"
                    onClick={() => onPlayDelay(d)}
                    className="inline-flex items-center gap-1 rounded-lg border border-line-solid px-2 py-1 text-xs font-semibold text-ink hover:border-brand hover:text-brand"
                  >
                    <Play size={11} />
                    {formatGap(d.toMs - d.fromMs)} 멈춤
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 풀이 중 문제점 — 빨간 표시 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#dc2626]">
                <CircleAlert size={14} /> 풀이 중 문제점
                {(analysis.issues ?? []).length > 0 &&
                  ` ${(analysis.issues ?? []).length}건`}
                {!compact && (
                  <span className="font-normal text-ink-subtle">
                    — 해당 구간 필기가 화면에 빨간색으로 표시됩니다
                  </span>
                )}
              </div>
              <ActionButton
                variant="neutralWeak"
                size="xsmall"
                onClick={() =>
                  commit((r) => {
                    r.issues = [
                      ...(r.issues ?? []),
                      {
                        fromMs: 0,
                        toMs: 0,
                        title: '새 문제점',
                        why: '왜 문제인지 클릭해 입력하세요.',
                        suggestion: '',
                      },
                    ];
                  })
                }
              >
                <span className="inline-flex items-center gap-1">
                  <Plus size={12} /> 직접 추가
                </span>
              </ActionButton>
            </div>
            {(analysis.issues ?? []).length === 0 ? (
              <p className="rounded-lg border border-line-weak bg-layer-fill px-4 py-3 text-xs text-ink-subtle">
                발견된 문제점이 없습니다. 직접 추가할 수도 있어요.
              </p>
            ) : (
              (analysis.issues ?? []).map((issue, i) => (
                <div
                  key={`${issue.fromMs}-${i}`}
                  data-testid="analysis-issue"
                  className="rounded-lg border border-[#dc2626]/50 bg-[#dc2626]/5 px-4 py-3"
                >
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      title="해당 시점으로 이동"
                      onClick={() => jumpTo(issue.fromMs)}
                      className="text-xs font-semibold tabular-nums text-[#dc2626] underline-offset-2 hover:underline"
                    >
                      {formatTimecode(issue.fromMs)} ~ {formatTimecode(issue.toMs)}
                    </button>
                    <Editable
                      value={issue.title}
                      onCommit={(v) =>
                        commit((r) => void ((r.issues ?? [])[i].title = v))
                      }
                      className="text-sm font-bold text-[#b91c1c]"
                    />
                    <button
                      type="button"
                      aria-label="문제점 삭제"
                      title="문제점 삭제"
                      onClick={() =>
                        commit((r) => {
                          r.issues = (r.issues ?? []).filter((_, j) => j !== i);
                        })
                      }
                      className="ml-auto rounded p-1 text-ink-subtle hover:bg-neutral-weak hover:text-critical"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <Editable
                    as="p"
                    multiline
                    value={issue.why}
                    onCommit={(v) =>
                      commit((r) => void ((r.issues ?? [])[i].why = v))
                    }
                    className="mt-1 block text-sm leading-relaxed text-ink"
                  />
                  <p className="mt-1 text-xs text-ink-muted">
                    지도 포인트:{' '}
                    <Editable
                      value={issue.suggestion || '(클릭해 입력)'}
                      onCommit={(v) =>
                        commit((r) => void ((r.issues ?? [])[i].suggestion = v))
                      }
                    />
                  </p>
                </div>
              ))
            )}
          </div>

          {/* 특성 — 필압 카드는 없다 (이 펜의 필압은 0/1 접촉 여부뿐) */}
          <div className={compact ? 'grid gap-2' : 'grid gap-2 sm:grid-cols-2'}>
            {(
              [
                ['필기 속도', 'pace'],
                ['수정·멈춤', 'corrections'],
              ] as const
            ).map(([label, key]) => (
              <div
                key={key}
                className="rounded-lg border border-line-weak bg-layer-fill px-3 py-2.5"
              >
                <div className="text-xs font-medium text-ink-subtle">{label}</div>
                <Editable
                  as="div"
                  multiline
                  value={analysis.traits[key] ?? ''}
                  onCommit={(v) => commit((r) => void (r.traits[key] = v))}
                  className="mt-0.5 block text-xs leading-relaxed text-ink"
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
