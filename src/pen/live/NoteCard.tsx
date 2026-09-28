import { Clock3, Hash, PenLine, RotateCw, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LatexText } from '@/components/LatexText';
import { useOcrStore, type OcrEntry } from '@/store/ocr.store';
import type { StrokeGroup } from './model/stroke-groups';
import { NoteThumbnail } from './NoteThumbnail';

type Props = {
  group: StrokeGroup;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  /** Wall-clock anchor that "12s ago" / "1m ago" is computed against. */
  nowMs: number;
};

export function NoteCard({ group, isSelected, onSelect, onHover, nowMs }: Props) {
  const durationS = Math.max(0, (group.endedAt - group.startedAt) / 1000);
  const ago = formatRelative(nowMs - group.startedAt);
  const ocr = useOcrStore((s) => s.byGroupId[group.id]);
  const retry = useOcrStore((s) => s.retry);

  return (
    <button
      type="button"
      data-testid="note-card"
      data-group-id={group.id}
      data-selected={isSelected ? 'true' : 'false'}
      onClick={() => onSelect(group.id)}
      onMouseEnter={() => onHover(group.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(group.id)}
      onBlur={() => onHover(null)}
      aria-pressed={isSelected}
      className={cn(
        'group relative w-full overflow-hidden rounded-2xl border px-4 pt-4 pb-3 text-left',
        'animate-card-in transition-[transform,box-shadow,border-color,background-color] duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marker focus-visible:ring-offset-2 focus-visible:ring-offset-parchment-100',
        isSelected
          ? 'border-marker bg-white shadow-card-selected'
          : 'border-parchment-300/80 bg-white/70 shadow-card-rest hover:-translate-y-[1px] hover:border-parchment-400 hover:bg-white hover:shadow-card-hover',
      )}
    >
      {/* Index ribbon */}
      <span
        aria-hidden
        className={cn(
          'absolute left-0 top-4 h-7 w-1 rounded-r-full transition-colors',
          isSelected ? 'bg-marker' : 'bg-parchment-300 group-hover:bg-marker-soft',
        )}
      />

      <div className="flex items-start gap-3">
        <div
          className={cn(
            'flex h-9 w-9 shrink-0 select-none items-center justify-center rounded-md font-mono text-[13px] font-medium tabular-nums',
            'transition-colors',
            isSelected
              ? 'bg-marker text-white shadow-[inset_0_0_0_1px_rgba(27,54,193,0.55)]'
              : 'bg-parchment-200 text-ink-muted group-hover:bg-marker-tint group-hover:text-marker-deep',
          )}
        >
          {String(group.index).padStart(2, '0')}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-display text-[15px] font-medium tracking-tight text-ink">
              Annotation
              <span className="ml-1 align-baseline font-mono text-[11px] tracking-tight text-ink-muted">
                #{String(group.index).padStart(2, '0')}
              </span>
            </span>
          </div>

          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-muted">
            <span className="inline-flex items-center gap-1">
              <Clock3 className="h-3 w-3" aria-hidden />
              <span className="font-mono tabular-nums">{ago}</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <PenLine className="h-3 w-3" aria-hidden />
              <span className="font-mono tabular-nums">
                {group.strokes.length} stroke{group.strokes.length === 1 ? '' : 's'}
              </span>
            </span>
            <span className="inline-flex items-center gap-1">
              <Hash className="h-3 w-3" aria-hidden />
              <span className="font-mono tabular-nums">
                {durationS < 10 ? durationS.toFixed(1) : Math.round(durationS)}s
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* Mini thumbnail */}
      <div
        className={cn(
          'mt-3 h-[88px] w-full rounded-md border bg-parchment-50 transition-colors',
          isSelected ? 'border-marker/60' : 'border-parchment-300/80',
        )}
      >
        <NoteThumbnail strokes={group.strokes} bbox={group.bbox} />
      </div>

      <OcrResult
        entry={ocr}
        isSelected={isSelected}
        onRetry={(e) => {
          e.stopPropagation();
          void retry(group);
        }}
      />
    </button>
  );
}

type OcrResultProps = {
  entry: OcrEntry | undefined;
  isSelected: boolean;
  onRetry: (e: React.MouseEvent<HTMLSpanElement>) => void;
};

function OcrResult({ entry, isSelected, onRetry }: OcrResultProps) {
  // Don't reserve any space when we have nothing to show. Pre-pending
  // groups don't render this block, keeping the card's idle height
  // identical to before OCR existed.
  if (!entry) return null;

  if (entry.status === 'pending') {
    return (
      <div
        data-testid="ocr-result"
        data-status="pending"
        className={cn(
          'mt-3 flex items-center gap-2 rounded-md border border-dashed px-3 py-2',
          'border-parchment-300/80 bg-parchment-50/60',
        )}
      >
        <Spinner />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
          recognising…
        </span>
      </div>
    );
  }

  if (entry.status === 'error') {
    return (
      <div
        data-testid="ocr-result"
        data-status="error"
        className="mt-3 flex items-center gap-2 rounded-md border border-rose-200/80 bg-rose-50/60 px-3 py-2"
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-rose-700/90">
          ocr failed
        </span>
        <span
          className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded font-mono text-[10px] uppercase tracking-[0.18em] text-rose-700 hover:underline"
          role="button"
          tabIndex={0}
          onClick={onRetry}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.stopPropagation();
              e.preventDefault();
              onRetry(
                e as unknown as React.MouseEvent<HTMLSpanElement>,
              );
            }
          }}
          title={entry.error}
          aria-label="Retry OCR"
        >
          <RotateCw className="h-3 w-3" aria-hidden />
          retry
        </span>
      </div>
    );
  }

  // success
  const text = entry.text?.trim() || '';
  const isUnreadable = !text || text === '[unreadable]';
  return (
    <div
      data-testid="ocr-result"
      data-status="success"
      className={cn(
        'mt-3 rounded-md border px-3 py-2.5 transition-colors',
        isSelected
          ? 'border-marker/30 bg-marker-tint/60'
          : 'border-parchment-300/80 bg-parchment-50/70',
      )}
    >
      <div className="flex items-center gap-1.5">
        <Sparkles
          className={cn(
            'h-3 w-3',
            isSelected ? 'text-marker-deep' : 'text-ink-muted',
          )}
          aria-hidden
        />
        <span
          className={cn(
            'font-mono text-[9.5px] uppercase tracking-[0.22em]',
            isSelected ? 'text-marker-deep' : 'text-ink-muted',
          )}
        >
          recognised
        </span>
      </div>
      {isUnreadable ? (
        <p className="mt-1 font-display text-[13px] italic leading-snug text-ink-muted">
          unreadable
        </p>
      ) : (
        <p className="mt-1 break-words font-display text-[15px] leading-snug text-ink">
          <LatexText text={text} />
        </p>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="relative inline-flex h-3 w-3 items-center justify-center"
    >
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-marker/30" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-marker" />
    </span>
  );
}

function formatRelative(deltaMs: number): string {
  const s = Math.max(0, Math.floor(deltaMs / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
