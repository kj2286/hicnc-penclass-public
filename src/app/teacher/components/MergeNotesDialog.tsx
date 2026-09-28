/**
 * **필기 기록 합치기** — 선생님이 문제지를 골라 한 기록으로 합친다.
 *
 * 예전에는 제목으로 세트가 감지될 때만 배너가 떴다. 시험지 구성은 학원마다
 * 달라서 자동 감지에만 기대면 못 합치는 경우가 생긴다(사용자 요구 2026-08-25):
 *  ① 상시 기능으로 열고 ② n개를 직접 고르고 ③ **순서를 바꿀 수 있게**.
 * 앞에 둔 문제지가 앞 페이지·앞 번호가 된다.
 *
 * 🚨 되돌릴 수 없다 — 고른 기록의 획을 하나로 모으고 나머지는 삭제한다.
 */
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
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
import { kstStamp } from '@/lib/kst';
import type { SubmissionRow } from '@/lib/api';

export function MergeNotesDialog({
  open,
  subs,
  busy,
  onClose,
  onMerge,
}: {
  open: boolean;
  /** 고를 수 있는 기록 (최근 순) */
  subs: SubmissionRow[];
  busy: boolean;
  onClose: () => void;
  /** 고른 순서 그대로 넘어온다 — 앞이 앞 페이지 */
  onMerge: (ordered: SubmissionRow[], title: string) => void;
}) {
  /** 고른 id 를 **고른 순서대로** 담는다 — 순서가 곧 페이지 순서다 */
  const [picked, setPicked] = useState<string[]>([]);
  const [title, setTitle] = useState('');

  useEffect(() => {
    if (open) {
      setPicked([]);
      setTitle('');
    }
  }, [open]);

  const byId = new Map(subs.map((s) => [s.id, s]));
  const ordered = picked
    .map((id) => byId.get(id))
    .filter((x): x is SubmissionRow => !!x);

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const move = (i: number, dir: -1 | 1) =>
    setPicked((p) => {
      const j = i + dir;
      if (j < 0 || j >= p.length) return p;
      const next = [...p];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>필기 기록 합치기</DialogTitle>
          <DialogDescription>
            한 시험지가 여러 PDF 로 나뉘어 있으면(표지 + 문제지) 하나로 합칩니다.
            고른 <b>순서대로</b> 페이지가 이어집니다 — 앞에 둔 문제지가 p.1 부터입니다.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[46vh] space-y-4 overflow-y-auto pr-1">
          <div>
            <p className="mb-1.5 text-[13px] font-bold text-ink">
              합칠 기록 고르기
            </p>
            <div className="space-y-1.5">
              {subs.length === 0 ? (
                <p className="text-xs text-ink-subtle">합칠 기록이 없습니다.</p>
              ) : (
                subs.map((s) => {
                  const idx = picked.indexOf(s.id);
                  return (
                    <label
                      key={s.id}
                      className={
                        'flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm ' +
                        (idx >= 0
                          ? 'border-line-brand bg-brand-weak'
                          : 'border-line-weak hover:border-line-solid')
                      }
                    >
                      <input
                        type="checkbox"
                        checked={idx >= 0}
                        onChange={() => toggle(s.id)}
                        disabled={busy}
                      />
                      <span className="min-w-0 flex-1 truncate text-ink">
                        {s.title || '(제목 없음)'}
                        <span className="ml-1.5 text-xs text-ink-subtle">
                          {s.pageCount}페이지 · {kstStamp(s.createdAt)}
                        </span>
                      </span>
                      {idx >= 0 && (
                        <span className="shrink-0 rounded bg-brand-solid px-1.5 py-0.5 text-[11px] font-bold text-white">
                          {idx + 1}
                        </span>
                      )}
                    </label>
                  );
                })
              )}
            </div>
          </div>

          {ordered.length >= 2 && (
            <div>
              <p className="mb-1.5 text-[13px] font-bold text-ink">
                순서 — 위에 있는 것이 앞 페이지
              </p>
              <div className="space-y-1.5">
                {ordered.map((s, i) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-2 rounded-lg border border-line-weak px-3 py-2 text-sm"
                  >
                    <span className="w-5 shrink-0 text-center font-bold text-brand">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-ink">
                      {s.title}
                    </span>
                    <button
                      type="button"
                      aria-label="위로"
                      disabled={i === 0 || busy}
                      onClick={() => move(i, -1)}
                      className="rounded p-1 text-ink-subtle hover:text-ink disabled:opacity-30"
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label="아래로"
                      disabled={i === ordered.length - 1 || busy}
                      onClick={() => move(i, 1)}
                      className="rounded p-1 text-ink-subtle hover:text-ink disabled:opacity-30"
                    >
                      <ArrowDown size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[13px] font-bold text-ink">합친 기록 이름</p>
              <input
                value={title}
                onChange={(e) => setTitle(e.currentTarget.value)}
                placeholder="비워두면 자동으로 정합니다 (예: 6-1(A형)_테스트01_b4)"
                className="mt-1 w-full rounded-lg border border-line-solid px-3 py-2 text-sm text-ink outline-none focus:border-brand"
              />
            </div>
          )}

          <Callout
            tone="warning"
            description="합치면 되돌릴 수 없습니다. 고른 기록의 필기를 하나로 모으고 나머지 기록은 삭제합니다. 합친 뒤 AI 채점·분석은 자동으로 다시 돕니다."
          />
        </div>

        <DialogFooter>
          <ActionButton variant="neutralWeak" onClick={onClose} disabled={busy}>
            취소
          </ActionButton>
          <ActionButton
            variant="brandSolid"
            loading={busy}
            disabled={ordered.length < 2 || busy}
            onClick={() => onMerge(ordered, title)}
          >
            {ordered.length >= 2 ? `${ordered.length}건 합치기` : '2건 이상 고르세요'}
          </ActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
