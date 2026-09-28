/**
 * 출력 목록 서랍 — 보낸 ncode 출력 잡을 상태와 함께 보여준다.
 *
 * 사용자 요구 2026-09-04: "출력이 완료되면 완료됐다고 보여줘야 한다. 출력하고
 * 있는 목록을 볼 수 있게." 상태는 스토어가 3초마다 프린터에 물어 갱신한다
 * (데스크 0.2.30 `print_job_status`). 여기서는 그리기만 한다.
 */
import { AlertCircle, Check, Printer, Trash2 } from 'lucide-react';
import { ActionButton } from 'seed-design/ui/action-button';
import { Drawer } from '@/components/ui/drawer';
import { PRINT_STATE_LABEL, isActive, type PrintJob } from '@/lib/print-jobs';
import { usePrintJobsStore } from '@/store/print-jobs.store';
import { formatDateTime } from '../format';

function StateChip({ job }: { job: PrintJob }) {
  const label = PRINT_STATE_LABEL[job.state];
  if (job.state === 'done')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#E7F5EC] px-2 py-0.5 text-xs font-bold text-[#0F7B3F]">
        <Check size={11} strokeWidth={3} /> {label}
      </span>
    );
  if (job.state === 'failed' || job.state === 'canceled' || job.state === 'unknown')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#FDECEC] px-2 py-0.5 text-xs font-bold text-[#C0392B]">
        <AlertCircle size={11} /> {label}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-weak px-2 py-0.5 text-xs font-bold text-ink-muted">
      <span
        className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-line-weak"
        style={{ borderTopColor: 'var(--hc-brand, #e52727)' }}
      />
      {label}
      {job.state === 'printing' && job.impressionsCompleted != null
        ? ` · ${job.impressionsCompleted}면`
        : ''}
    </span>
  );
}

export function PrintQueueDrawer() {
  const jobs = usePrintJobsStore((s) => s.jobs);
  const open = usePrintJobsStore((s) => s.open);
  const setOpen = usePrintJobsStore((s) => s.setOpen);
  const remove = usePrintJobsStore((s) => s.remove);
  const clearDone = usePrintJobsStore((s) => s.clearDone);
  const active = jobs.filter((j) => isActive(j.state)).length;
  const doneCount = jobs.length - active;

  return (
    <Drawer
      open={open}
      onOpenChange={setOpen}
      title="출력 목록"
      description={
        jobs.length === 0
          ? '보낸 출력이 없습니다.'
          : `진행 중 ${active}건 · 나머지 ${doneCount}건. 진행 상태는 프린터 응답으로 확인합니다.`
      }
    >
      <div className="space-y-2 text-sm">
        {doneCount > 0 && (
          <div className="flex justify-end">
            <ActionButton variant="neutralWeak" size="small" onClick={clearDone}>
              <span className="inline-flex items-center gap-1">
                <Trash2 size={13} /> 지난 기록 지우기
              </span>
            </ActionButton>
          </div>
        )}
        {jobs.length === 0 && (
          <p className="py-8 text-center text-ink-subtle">
            교재 만들기의 [바로 출력]으로 보낸 출력이 여기에 쌓입니다.
          </p>
        )}
        {jobs.map((j) => (
          <div
            key={j.id}
            data-testid="print-job"
            data-state={j.state}
            className="rounded-lg border border-line-weak px-3 py-2.5"
          >
            <div className="flex items-start gap-2">
              <Printer size={15} className="mt-0.5 shrink-0 text-ink-subtle" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{j.title}</span>
                  <StateChip job={j} />
                </div>
                <div className="mt-0.5 text-xs text-ink-muted">
                  {j.printerName || j.uri.replace(/^ipp:\/\//, '')} · {j.dpi}dpi · {j.copies}매
                  {j.jobId != null ? ` · 잡 #${j.jobId}` : ''} · {formatDateTime(new Date(j.submittedAt).toISOString())}
                </div>
                {j.verdict === 'mismatch' && (
                  <div className="mt-1 text-xs text-[#C0392B]">
                    프린터가 {j.recordedDpi ?? '?'}dpi 로 기록 — 요청 {j.dpi}dpi 와 다릅니다. 이 출력물은 {j.dpi}dpi 로 믿으면 안 됩니다.
                  </div>
                )}
                {j.verdict === 'unknown' && (
                  <div className="mt-1 text-xs text-[#B7791F]">
                    해상도 미확인(프린터가 잡 기록을 안 줌) — 출력물을 버리지 마세요. 다시 보내면 사본이 나옵니다.
                  </div>
                )}
                {(j.state === 'failed' || j.state === 'canceled' || j.state === 'unknown') && j.note && (
                  <div className="mt-1 text-xs text-[#C0392B]">{j.note}</div>
                )}
              </div>
              {!isActive(j.state) && (
                <button
                  type="button"
                  aria-label="목록에서 지우기"
                  onClick={() => remove(j.id)}
                  className="shrink-0 text-ink-subtle hover:text-critical"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </Drawer>
  );
}
