/**
 * 교재·문항별 AI 프롬프트 편집 (2026-08-22 사용자 요구).
 *
 * v2 (같은 날 개선): 선생님이 문항 번호를 다 기억하지 못한다 — **교재 PDF 의
 * 문항을 자동 인식해 문제를 캡처 이미지로 보여주고**, 그 옆에서 프롬프트를
 * 입력한다. 일괄 적용 도구 포함.
 *  - 인식 결과는 기기 로컬 캐시(localStorage)에 남아 재진입 시 즉시 뜬다.
 *  - 인식 실패(NGS 미연동 등) 시 번호 직접 입력 방식으로 폴백.
 * (학원 설정에서 토글 ON 일 때만 교재 만들기에 진입 버튼이 보인다)
 */
import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Trash2 } from 'lucide-react';
import { ActionButton } from 'seed-design/ui/action-button';
import { Callout } from 'seed-design/ui/callout';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  PROMPT_TIPS,
  analysisDirective,
  gradeDirective,
  listPaperPrompts,
  reportDirective,
  savePaperPrompts,
  type PaperPromptConfig,
} from '@/lib/paper-prompts';
import {
  detectPrintedProblems,
  renderProblemRegionImage,
  type ProblemBBox,
} from '@/lib/problem-detect';
import { buildPageKey } from '@/lib/pen-event-bus';
import { listPdfPagesFromIndex } from '@/store/paper.store';
import { useSessionStore } from '@/store/session.store';
import { useToast } from './toast';

type PaperProblem = {
  no: number;
  page: { section: number; owner: number; noteId: number; pageNumber: number };
  pageIndex: number;
  bbox: ProblemBBox;
  numberY?: number;
};

const CACHE_VER = 'v1';
const cacheKey = (pdfId: number) => `pc_paper_problems_${CACHE_VER}:${pdfId}`;

function loadProblemCache(pdfId: number): PaperProblem[] | null {
  try {
    const raw = localStorage.getItem(cacheKey(pdfId));
    if (!raw) return null;
    const arr = JSON.parse(raw) as PaperProblem[];
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

function saveProblemCache(pdfId: number, list: PaperProblem[]) {
  try {
    localStorage.setItem(cacheKey(pdfId), JSON.stringify(list));
  } catch {
    /* 저장소 가득 참 — 다음에 다시 인식할 뿐 */
  }
}

export function PaperPromptDialog({
  pdf,
  onClose,
  focusNo = null,
  onSaved,
}: {
  pdf: { id: number; title: string | null } | null;
  onClose: () => void;
  /** 열자마자 이 문항으로 스크롤·강조 — 문제지 상세에서 문항을 보다 들어온 경우
   *  (사용자 요구 2026-08-24: "문항별 내가 작성한 프롬프트를 여기서 바로") */
  focusNo?: number | null;
  /** 저장 성공 시 — 부른 화면이 프롬프트 설정을 다시 읽게 한다 */
  onSaved?: () => void;
}) {
  const toast = useToast();
  const academyId = useSessionStore((s) => s.profile?.academyId) ?? null;

  const [paper, setPaper] = useState('');
  /** 문항 번호 → 프롬프트 (인식 여부와 무관하게 저장 데이터의 정본) */
  const [promptByNo, setPromptByNo] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');

  // ── 문항 자동 인식 ──
  const [problems, setProblems] = useState<PaperProblem[] | null>(null);
  const [detectNote, setDetectNote] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [imgByNo, setImgByNo] = useState<Record<number, string>>({});
  /** 인식 실패 시 번호 직접 추가 폴백 입력 */
  const [manualNo, setManualNo] = useState('');
  const [bulk, setBulk] = useState('');
  /** 문제 이미지 보기 크기 — 작게(옆 배치) / 크게(전폭) */
  const [imgSize, setImgSize] = useState<'small' | 'large'>('small');

  // 저장된 프롬프트 로드
  useEffect(() => {
    if (!pdf || !academyId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setTab('edit');
    setBulk('');
    void listPaperPrompts(academyId, pdf.id)
      .then((d) => {
        if (!alive) return;
        setPaper(d.paper);
        const m: Record<number, string> = {};
        for (const q of d.byNo) m[q.no] = q.prompt;
        setPromptByNo(m);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(
          /sp_paper_prompts|relation|schema/i.test(msg)
            ? '이 기능은 021 마이그레이션(supabase/021_paper_prompts.sql) 적용 후 사용할 수 있습니다.'
            : msg,
        );
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [pdf, academyId]);

  // 문항 인식 — 캐시 우선, [다시 인식]으로 강제 재실행
  const runDetection = async (pdfId: number) => {
    setDetecting(true);
    setProblems(null);
    setDetectNote(null);
    try {
      const pages = await listPdfPagesFromIndex(pdfId);
      if (pages.length === 0) {
        setProblems([]);
        setDetectNote(
          '이 교재의 페이지 정보를 찾지 못했습니다 — 아래에서 번호로 직접 추가하세요.',
        );
        return;
      }
      const out: PaperProblem[] = [];
      for (let i = 0; i < pages.length; i++) {
        const ip = pages[i];
        setDetectNote(
          `문제 파악 중 — p.${ip.pageIndex} (${i + 1}/${pages.length})` +
            (out.length > 0 ? ` · 지금까지 ${out.length}문항 발견` : ''),
        );
        const key = buildPageKey(ip.section, ip.owner, ip.noteId, ip.pageNumber);
        const clusters = await detectPrintedProblems(key, ip, []).catch(() => null);
        for (const c of clusters ?? []) {
          if (c.meta?.no == null) continue;
          out.push({
            no: c.meta.no,
            page: {
              section: ip.section,
              owner: ip.owner,
              noteId: ip.noteId,
              pageNumber: ip.pageNumber,
            },
            pageIndex: ip.pageIndex,
            bbox: c.bbox,
            numberY: c.meta.numberY,
          });
        }
      }
      out.sort((a, b) => a.pageIndex - b.pageIndex || a.no - b.no);
      setProblems(out);
      setDetectNote(
        out.length === 0
          ? '이 교재에서 번호 있는 문항을 찾지 못했습니다 — 아래에서 번호로 직접 추가하세요.'
          : null,
      );
      if (out.length > 0) saveProblemCache(pdfId, out);
    } catch {
      setProblems([]);
      setDetectNote('문항 인식에 실패했습니다 — 아래에서 번호로 직접 추가하세요.');
    } finally {
      setDetecting(false);
    }
  };

  useEffect(() => {
    if (!pdf) {
      setProblems(null);
      setImgByNo({});
      setDetectNote(null);
      return;
    }
    const cached = loadProblemCache(pdf.id);
    if (cached) setProblems(cached);
    else void runDetection(pdf.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf]);

  const redetect = () => {
    if (!pdf || detecting) return;
    try {
      localStorage.removeItem(cacheKey(pdf.id));
    } catch {
      /* noop */
    }
    setImgByNo({});
    void runDetection(pdf.id);
  };

  // 문항 캡처 이미지 — 배경만(필기 없이) 잘라 보여준다
  useEffect(() => {
    if (!pdf || !problems || problems.length === 0) return;
    let alive = true;
    void (async () => {
      for (const pb of problems) {
        if (!alive) return;
        if (imgByNo[pb.no]) continue;
        const url = await renderProblemRegionImage({
          page: pb.page,
          bbox: pb.bbox,
          strokes: [],
          includeStrokeIds: [],
          topLimit: pb.numberY,
          maxWidth: 1000,
        }).catch(() => null);
        if (!alive) return;
        if (url) setImgByNo((m) => ({ ...m, [pb.no]: url }));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, problems]);

  const setPrompt = (no: number, v: string) =>
    setPromptByNo((m) => ({ ...m, [no]: v }));

  const save = async () => {
    if (!pdf || !academyId || saving) return;
    setSaving(true);
    setError(null);
    try {
      await savePaperPrompts(academyId, pdf.id, {
        paper,
        byNo: Object.entries(promptByNo).map(([no, prompt]) => ({
          no: parseInt(no, 10),
          prompt,
        })),
      });
      toast(
        '프롬프트를 저장했습니다 — 바뀐 문항은 다음 열람/수신 때 자동으로 다시 분석됩니다.',
        'positive',
      );
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // 미리보기 — 실제 합성 함수로 (화면·파이프라인과 같은 결과 보장)
  const previewCfg: PaperPromptConfig = useMemo(() => {
    const byNo: Record<number, string> = {};
    for (const [no, v] of Object.entries(promptByNo)) {
      if (v.trim()) byNo[parseInt(no, 10)] = v;
    }
    return { enabled: true, byPdf: pdf ? { [pdf.id]: { paper, byNo } } : {} };
  }, [pdf, paper, promptByNo]);
  const firstNoWithPrompt = useMemo(() => {
    const nos = Object.entries(promptByNo)
      .filter(([, v]) => v.trim())
      .map(([n]) => parseInt(n, 10))
      .sort((a, b) => a - b);
    return nos[0] ?? null;
  }, [promptByNo]);

  /** 인식된 번호 목록 + 인식 안 됐지만 저장돼 있는 번호(잃지 않게 함께 표시) */
  const allNos = useMemo(() => {
    const s = new Set<number>((problems ?? []).map((p) => p.no));
    for (const k of Object.keys(promptByNo)) s.add(parseInt(k, 10));
    return [...s].sort((a, b) => a - b);
  }, [problems, promptByNo]);
  const problemByNo = useMemo(() => {
    const m = new Map<number, PaperProblem>();
    for (const p of problems ?? []) if (!m.has(p.no)) m.set(p.no, p);
    return m;
  }, [problems]);

  /** focusNo 로 열렸으면 그 문항 줄로 스크롤하고 잠시 강조한다.
   *  목록은 문항 인식이 끝난 뒤에 그려지므로 allNos 가 채워질 때까지 기다린다. */
  const [flashNo, setFlashNo] = useState<number | null>(null);
  useEffect(() => {
    if (!pdf || focusNo == null || loading) return;
    if (!allNos.includes(focusNo)) return;
    const el = document.querySelector<HTMLElement>(
      `[data-prompt-no="${focusNo}"]`,
    );
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    setFlashNo(focusNo);
    const t = setTimeout(() => setFlashNo(null), 2000);
    return () => clearTimeout(t);
  }, [pdf, focusNo, loading, allNos]);

  const applyBulk = (mode: 'fill' | 'overwrite') => {
    const v = bulk.trim();
    if (!v) return;
    const targets = (problems ?? []).map((p) => p.no);
    if (targets.length === 0) {
      toast('인식된 문항이 없어 일괄 적용할 수 없습니다.', 'critical');
      return;
    }
    if (
      mode === 'overwrite' &&
      !window.confirm(
        `문항 ${targets.length}개의 프롬프트를 전부 이 내용으로 덮어쓸까요?`,
      )
    )
      return;
    setPromptByNo((m) => {
      const next = { ...m };
      for (const no of targets) {
        if (mode === 'fill' && next[no]?.trim()) continue;
        next[no] = v;
      }
      return next;
    });
    toast(
      mode === 'fill' ? '빈 문항에 채웠습니다.' : '전체에 적용했습니다.',
      'positive',
    );
  };

  return (
    <Dialog open={pdf !== null} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            AI 프롬프트 — {pdf?.title || `교재 #${pdf?.id}`}
          </DialogTitle>
          <DialogDescription>
            우리 학원의 평가 기준을 적으면 이 교재의 채점·과정 분석·학습분석
            리포트에 반영됩니다. 비워두면 수학비서 공통 프롬프트로 동작해요.
          </DialogDescription>
        </DialogHeader>

        <div className="mb-3 flex items-center justify-between">
          <div className="flex gap-1">
            {(
              [
                ['edit', '작성'],
                ['preview', '미리보기'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={
                  'rounded-md px-3 py-1.5 text-[13px] font-semibold ' +
                  (tab === k
                    ? 'bg-ink text-white'
                    : 'bg-neutral-weak text-ink-muted hover:text-ink')
                }
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'edit' && (
            <button
              type="button"
              onClick={redetect}
              disabled={detecting}
              className="inline-flex items-center gap-1 text-xs text-ink-subtle hover:text-ink disabled:opacity-40"
              title="문항 인식을 다시 실행합니다"
            >
              <RefreshCw size={12} /> 문항 다시 인식
            </button>
          )}
        </div>

        {error && <Callout tone="critical" description={error} />}

        {tab === 'edit' ? (
          <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
            <div>
              <p className="mb-1 text-sm font-bold text-ink">교재 전체 프롬프트</p>
              <p className="mb-2 text-xs text-ink-muted">
                이 교재의 <b className="text-ink">모든 문항에 공통</b>으로
                적용됩니다. (공통 기준은 여기 한 번만 쓰면 돼요)
              </p>
              <textarea
                value={paper}
                disabled={loading}
                onChange={(e) => setPaper(e.currentTarget.value)}
                placeholder={
                  '예) 풀이 과정 없이 답만 맞은 문항은 "개념 확인 필요"로 평가해줘.\n예) 지도 제안은 반드시 다음 수업에서 할 행동 1가지로 적어줘.'
                }
                className="min-h-24 w-full resize-y rounded-lg border border-line-solid p-3 text-sm leading-relaxed text-ink outline-none focus:border-brand"
              />
            </div>

            {/* 인식 중 — 총 문항 수가 확정되기 전에는 목록·숫자를 보여주지
                않는다 (사용자 지적 2026-08-22: 파악이 끝나기 전에 숫자가 보임) */}
            {detecting && (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-line-weak bg-layer-fill px-4 py-10">
                <span className="inline-block size-6 animate-spin rounded-full border-2 border-line-brand border-t-transparent" />
                <p className="text-sm font-semibold text-ink">
                  {detectNote ?? '교재를 읽고 문제를 파악하는 중…'}
                </p>
                <p className="text-xs text-ink-subtle">
                  교재 전체를 훑어 문제 번호와 위치를 파악합니다 — 교재당 처음
                  한 번만 걸리고, 다음부터는 바로 열려요.
                </p>
              </div>
            )}

            {!detecting && (
            <>
            {/* 일괄 적용 — 문항별 프롬프트를 한 번에 */}
            <div className="rounded-xl border border-line-weak bg-layer-fill p-3">
              <p className="mb-1.5 text-[13px] font-bold text-ink">
                문항별 프롬프트 일괄 적용
              </p>
              <textarea
                value={bulk}
                onChange={(e) => setBulk(e.currentTarget.value)}
                placeholder="여기에 쓰고 [빈 문항만 채우기] 또는 [전체 덮어쓰기]"
                className="min-h-14 w-full resize-y rounded-lg border border-line-solid p-2.5 text-sm leading-relaxed text-ink outline-none focus:border-brand"
              />
              <div className="mt-2 flex gap-2">
                <ActionButton
                  variant="neutralWeak"
                  size="xsmall"
                  disabled={!bulk.trim()}
                  onClick={() => applyBulk('fill')}
                >
                  빈 문항만 채우기
                </ActionButton>
                <ActionButton
                  variant="neutralWeak"
                  size="xsmall"
                  disabled={!bulk.trim()}
                  onClick={() => applyBulk('overwrite')}
                >
                  전체 덮어쓰기
                </ActionButton>
              </div>
            </div>

            {/* 문항 목록 — 캡처 이미지 + 프롬프트 입력 */}
            <div>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-bold text-ink">
                  문항별 프롬프트
                  {(problems?.length ?? 0) > 0 && (
                    <span className="ml-1.5 text-xs font-semibold text-brand">
                      총 {problems!.length}문항
                    </span>
                  )}
                  {(problems?.length ?? 0) > 0 &&
                    problems!.some((pb) => !imgByNo[pb.no]) && (
                      <span className="ml-2 inline-flex items-center gap-1 text-[11px] font-medium text-ink-subtle">
                        <span className="inline-block size-2.5 animate-spin rounded-full border-[1.5px] border-line-brand border-t-transparent" />
                        문제 이미지 준비{' '}
                        {problems!.filter((pb) => imgByNo[pb.no]).length}/
                        {problems!.length}
                      </span>
                    )}
                </p>
                {(problems?.length ?? 0) > 0 && (
                  <div className="flex gap-1">
                    {(
                      [
                        ['small', '작게 보기'],
                        ['large', '크게 보기'],
                      ] as const
                    ).map(([k, label]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setImgSize(k)}
                        className={
                          'rounded-md px-2 py-1 text-[11px] font-semibold ' +
                          (imgSize === k
                            ? 'bg-ink text-white'
                            : 'bg-neutral-weak text-ink-muted hover:text-ink')
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {detectNote && (
                <p className="mb-2 rounded-lg bg-layer-fill px-3 py-2 text-xs text-ink-subtle">
                  {detectNote}
                </p>
              )}
              <div className="space-y-3">
                {allNos.map((no) => {
                  const p = problemByNo.get(no);
                  return (
                    <div
                      key={no}
                      data-prompt-no={no}
                      className={
                        (imgSize === 'small'
                          ? 'flex items-start gap-3 '
                          : 'flex flex-col gap-2 ') +
                        'rounded-xl border p-3 transition-colors ' +
                        (flashNo === no
                          ? 'border-line-brand bg-brand-weak'
                          : 'border-line-weak')
                      }
                    >
                      <div
                        className={
                          imgSize === 'small' ? 'w-[220px] shrink-0' : 'w-full'
                        }
                      >
                        <p className="mb-1 text-[13px] font-bold text-ink">
                          {no}번
                          {p && (
                            <span className="ml-1 text-[11px] font-normal text-ink-subtle">
                              p.{p.pageIndex}
                            </span>
                          )}
                        </p>
                        {p ? (
                          imgByNo[no] ? (
                            <img
                              src={imgByNo[no]}
                              alt={`${no}번 문제`}
                              className="w-full rounded-md border border-line-weak bg-white"
                              style={
                                imgSize === 'large'
                                  ? { maxHeight: 480, objectFit: 'contain' }
                                  : undefined
                              }
                            />
                          ) : (
                            <div className="flex h-20 items-center justify-center rounded-md border border-line-weak bg-layer-fill text-[11px] text-ink-subtle">
                              문제 이미지 준비 중…
                            </div>
                          )
                        ) : (
                          <div className="flex h-20 items-center justify-center rounded-md border border-dashed border-line-weak text-[11px] text-ink-subtle">
                            인식되지 않은 번호 (저장은 유지됨)
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <textarea
                          value={promptByNo[no] ?? ''}
                          onChange={(e) => setPrompt(no, e.currentTarget.value)}
                          placeholder="이 문항의 평가 기준 — 예) 식 세우기가 핵심, 답이 맞아도 식이 없으면 지적해줘."
                          className="min-h-24 w-full resize-y rounded-lg border border-line-solid p-2.5 text-sm leading-relaxed text-ink outline-none focus:border-brand"
                        />
                        {(promptByNo[no] ?? '').trim() && (
                          <button
                            type="button"
                            onClick={() => setPrompt(no, '')}
                            className="mt-1 inline-flex items-center gap-1 text-[11px] text-ink-subtle hover:text-critical"
                          >
                            <Trash2 size={11} /> 이 문항 프롬프트 비우기
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* 인식 실패 폴백 — 번호 직접 추가 */}
              <div className="mt-3 flex items-center gap-2">
                <input
                  value={manualNo}
                  onChange={(e) =>
                    setManualNo(e.currentTarget.value.replace(/[^0-9]/g, ''))
                  }
                  placeholder="번호"
                  className="w-16 rounded-lg border border-line-solid px-2 py-1.5 text-center text-sm font-bold text-ink outline-none focus:border-brand"
                />
                <ActionButton
                  variant="neutralWeak"
                  size="xsmall"
                  disabled={!manualNo}
                  onClick={() => {
                    const n = parseInt(manualNo, 10);
                    if (Number.isFinite(n) && n > 0) {
                      setPromptByNo((m) => ({ ...m, [n]: m[n] ?? '' }));
                      setManualNo('');
                    }
                  }}
                >
                  번호로 직접 추가
                </ActionButton>
              </div>
            </div>

            </>
            )}

            <div className="rounded-xl border border-line-weak bg-layer-fill p-3">
              <p className="mb-2 text-[13px] font-bold text-ink">✏️ 작성 팁</p>
              <ul className="space-y-2">
                {PROMPT_TIPS.map((t) => (
                  <li key={t.title} className="text-xs leading-relaxed">
                    <span className="font-semibold text-ink">{t.title}</span>
                    <span className="text-ink-muted"> — {t.body}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
            <p className="text-xs leading-relaxed text-ink-muted">
              작성한 프롬프트가 AI 에 <b className="text-ink">실제로 전달되는
              형태</b>입니다. 아래 블록이 수학비서 공통 지시문 뒤에 그대로
              붙습니다.
            </p>
            <div>
              <p className="mb-1 text-[13px] font-bold text-ink">
                ① 채점할 때{firstNoWithPrompt ? ` (예: ${firstNoWithPrompt}번)` : ''}
              </p>
              <pre className="whitespace-pre-wrap rounded-lg bg-[#1f2430] p-3 text-xs leading-relaxed text-[#d7dce6]">
                {gradeDirective(previewCfg, pdf?.id, firstNoWithPrompt) ||
                  '(작성된 내용이 없습니다 — 공통 기준으로만 채점)'}
              </pre>
            </div>
            <div>
              <p className="mb-1 text-[13px] font-bold text-ink">② 과정 분석할 때</p>
              <pre className="whitespace-pre-wrap rounded-lg bg-[#1f2430] p-3 text-xs leading-relaxed text-[#d7dce6]">
                {analysisDirective(previewCfg, pdf?.id, firstNoWithPrompt) ||
                  '(작성된 내용이 없습니다)'}
              </pre>
            </div>
            <div>
              <p className="mb-1 text-[13px] font-bold text-ink">
                ③ 학습분석 리포트 만들 때
              </p>
              <pre className="whitespace-pre-wrap rounded-lg bg-[#1f2430] p-3 text-xs leading-relaxed text-[#d7dce6]">
                {reportDirective(previewCfg, pdf ? [pdf.id] : []) ||
                  '(교재 전체 프롬프트가 없으면 리포트에는 붙지 않습니다)'}
              </pre>
            </div>
            <div className="rounded-xl border border-line-weak p-3">
              <p className="mb-2 text-[13px] font-bold text-ink">
                결과에 반영되는 위치 (예시)
              </p>
              <div className="space-y-1.5 text-xs leading-relaxed">
                <p>
                  <span className="font-semibold text-ink">채점 — 6번 ✗</span>{' '}
                  <span className="text-ink-muted">
                    학생 답 ①, 정답 ④. 통분 과정에서 분모를 잘못 곱했습니다.
                  </span>{' '}
                  <span className="font-semibold text-[#c1121f]">
                    ← 문제점 서술에 학원 기준 반영
                  </span>
                </p>
                <p>
                  <span className="font-semibold text-ink">과정 분석</span>{' '}
                  <span className="text-ink-muted">
                    2번의 시도와 45초 멈춤이 있었고, 식을 세우지 않고 바로
                    계산에 들어갔습니다…
                  </span>{' '}
                  <span className="font-semibold text-[#c1121f]">
                    ← 서술 관점·문제점 기준에 반영
                  </span>
                </p>
                <p>
                  <span className="font-semibold text-ink">리포트 — 지도 제안</span>{' '}
                  <span className="text-ink-muted">
                    다음 수업에서 통분 연습 5문제를 먼저 풀리세요.
                  </span>{' '}
                  <span className="font-semibold text-[#c1121f]">
                    ← 총평·지도 제안 말투/형식에 반영
                  </span>
                </p>
              </div>
              <p className="mt-2 text-[11px] text-ink-subtle">
                저장하면 프롬프트가 바뀐 문항만 다음 열람/수신 때 자동으로 다시
                분석됩니다. 이미 만들어진 리포트는 [다시 생성]을 눌러야 새
                기준이 반영돼요.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <ActionButton variant="neutralWeak" size="small" onClick={onClose}>
            닫기
          </ActionButton>
          <ActionButton
            variant="brandSolid"
            size="small"
            loading={saving}
            disabled={loading || !!error}
            onClick={() => void save()}
          >
            저장
          </ActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
