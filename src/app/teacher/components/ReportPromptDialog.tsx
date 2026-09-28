/**
 * 학습분석 리포트 — 학원 섹션별 AI 프롬프트 편집 (2026-08-22 사용자 요구).
 *
 * 리포트의 4개 AI 영역(문항별 한 줄 평가·학습자 결과분석·우선 학습대상·
 * 종합분석/지도방향)의 작성 기준을 학원이 정의한다. 학원 공통(교재 무관),
 * sp_paper_prompts 에 pdf_id=0 센티널로 저장. 토글 OFF 면 공통 프롬프트.
 * 화면 구성(섹션 순서·숨기기)은 리포트 화면에서 직접 끌어서 바꾼다 — 여기는
 * 글의 "기준"만 다룬다.
 */
import { useEffect, useState } from 'react';
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
  EMPTY_REPORT_PROMPTS,
  REPORT_PROMPT_FIELDS,
  composeReportSectionDirective,
  loadReportPrompts,
  saveReportPrompts,
  type ReportPromptValues,
} from '@/lib/paper-prompts';
import { useSessionStore } from '@/store/session.store';
import { useToast } from './toast';

export function ReportPromptDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const academyId = useSessionStore((s) => s.profile?.academyId) ?? null;
  const [values, setValues] = useState<ReportPromptValues>(EMPTY_REPORT_PROMPTS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    if (!open || !academyId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setShowPreview(false);
    void loadReportPrompts(academyId)
      .then((v) => alive && setValues(v))
      .catch((e: unknown) => {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(
          /sp_paper_prompts|relation|schema/i.test(msg)
            ? '이 기능은 021 마이그레이션 적용 후 사용할 수 있습니다.'
            : msg,
        );
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, academyId]);

  const save = async () => {
    if (!academyId || saving) return;
    setSaving(true);
    setError(null);
    try {
      await saveReportPrompts(academyId, values);
      toast(
        '리포트 프롬프트를 저장했습니다 — 리포트에서 [다시 생성]을 누르면 새 기준으로 만들어집니다.',
        'positive',
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const preview = composeReportSectionDirective(values);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>학습분석 리포트 — AI 프롬프트</DialogTitle>
          <DialogDescription>
            우리 학원 기준으로 리포트의 각 영역이 작성되도록 지시문을 정의합니다
            (학원 공통 — 모든 학생·교재의 리포트에 적용). 섹션 순서·숨기기는
            리포트 화면에서 직접 끌어서 바꿀 수 있어요.
          </DialogDescription>
        </DialogHeader>

        {error && <Callout tone="critical" description={error} />}

        <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
          {REPORT_PROMPT_FIELDS.map((f) => (
            <div key={f.key}>
              <p className="mb-0.5 text-sm font-bold text-ink">{f.label}</p>
              <p className="mb-1.5 text-xs leading-relaxed text-ink-muted">
                {f.hint}
              </p>
              <textarea
                value={values[f.key]}
                disabled={loading}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [f.key]: e.currentTarget.value }))
                }
                placeholder="비우면 수학비서 공통 기준으로 작성됩니다."
                className="min-h-20 w-full resize-y rounded-lg border border-line-solid p-2.5 text-sm leading-relaxed text-ink outline-none focus:border-brand"
              />
            </div>
          ))}

          <div>
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              className="text-xs font-semibold text-brand underline"
            >
              {showPreview ? '미리보기 접기' : 'AI 에 전달되는 형태 미리보기'}
            </button>
            {showPreview && (
              <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-[#1f2430] p-3 text-xs leading-relaxed text-[#d7dce6]">
                {preview ||
                  '(작성된 내용이 없습니다 — 공통 기준으로만 리포트가 작성됩니다)'}
              </pre>
            )}
          </div>

          <p className="rounded-lg bg-layer-fill px-3 py-2.5 text-[11px] leading-relaxed text-ink-subtle">
            저장 후 만들어지는 리포트부터 적용됩니다. 이미 만들어진 리포트는
            해당 리포트 화면에서 <b className="text-ink">[다시 생성]</b>을 누르면
            새 기준으로 다시 작성돼요.
          </p>
        </div>

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
