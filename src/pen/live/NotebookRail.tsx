import { useEffect, useMemo, useRef, useState } from 'react';
import { BookMarked, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StrokeGroup } from './model/stroke-groups';
import { NoteCard } from './NoteCard';

type Props = {
  groups: StrokeGroup[];
  selectedGroupId: string | null;
  hoveredGroupId: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  /** Whether the pen is currently drawing (used to show a live indicator). */
  isPenDown: boolean;
  className?: string;
};

export function NotebookRail({
  groups,
  selectedGroupId,
  hoveredGroupId,
  onSelect,
  onHover,
  isPenDown,
  className,
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  const listRef = useRef<HTMLDivElement | null>(null);
  const lastSeenIdsRef = useRef<Set<string>>(new Set());
  const [shouldStickBottom, setShouldStickBottom] = useState(true);

  // Tick every 5s so "10s ago" labels stay fresh without thrashing renders.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, []);

  // Detect new groups for an "auto-follow" scroll-to-bottom UX, but only when
  // the user was already near the bottom — don't yank them while they're
  // reading earlier notes.
  useEffect(() => {
    const seen = lastSeenIdsRef.current;
    const isNew = groups.some((g) => !seen.has(g.id));
    groups.forEach((g) => seen.add(g.id));
    if (isNew && shouldStickBottom && listRef.current) {
      const el = listRef.current;
      // RAF so layout has finished after the new card is appended.
      requestAnimationFrame(() => {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      });
    }
  }, [groups, shouldStickBottom]);

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const distFromBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
    setShouldStickBottom(distFromBottom < 32);
  }

  const totals = useMemo(() => {
    const strokeCount = groups.reduce((n, g) => n + g.strokes.length, 0);
    const dotCount = groups.reduce((n, g) => n + g.dotCount, 0);
    return { strokeCount, dotCount };
  }, [groups]);

  return (
    <aside
      data-testid="notebook-rail"
      className={cn(
        'relative flex h-full min-h-0 flex-col border-l border-parchment-300 bg-parchment-100',
        className,
      )}
    >
      {/* Decorative "binding holes" along the left edge — adds editorial flair. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 hidden w-3 flex-col items-center justify-evenly pt-12 pb-12 md:flex"
      >
        {Array.from({ length: 7 }).map((_, i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-parchment-300 shadow-[inset_0_0_0_1px_rgba(26,24,21,0.06)]"
          />
        ))}
      </div>

      <header className="flex shrink-0 items-baseline gap-3 border-b border-parchment-300/70 px-6 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-marker-tint">
          <BookMarked className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="inline-flex items-baseline gap-1.5 text-[20px] font-semibold leading-none tracking-tight text-ink">
            Annotations
            <span aria-hidden className="h-1.5 w-1.5 translate-y-[-1px] rounded-full bg-marker" />
          </h2>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
            {groups.length === 0 ? 'awaiting notes' : `${groups.length} captured`}
            {' · '}
            {totals.strokeCount} strokes
          </p>
        </div>
        {isPenDown && (
          <span
            data-testid="rail-live-indicator"
            className="inline-flex items-center gap-1 rounded-full bg-marker px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-white shadow-[inset_0_0_0_1px_rgba(27,54,193,0.55)]"
            title="Pen is currently writing"
          >
            <span className="relative inline-flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
            </span>
            live
          </span>
        )}
      </header>

      {groups.length === 0 ? (
        <EmptyState />
      ) : (
        <div
          ref={listRef}
          onScroll={onScroll}
          data-testid="notebook-list"
          className="flex-1 overflow-y-auto px-5 pt-4 pb-8"
        >
          <ul className="flex flex-col gap-3">
            {groups.map((g) => (
              <li key={g.id}>
                <NoteCard
                  group={g}
                  isSelected={selectedGroupId === g.id}
                  onSelect={onSelect}
                  onHover={(id) => onHover(id ?? hoveredGroupId)}
                  nowMs={now}
                />
              </li>
            ))}
          </ul>
          <p className="mt-4 px-1 text-center font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
            <span className="opacity-70">— end of margin —</span>
          </p>
        </div>
      )}
    </aside>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-parchment-200 text-ink-muted">
        <Sparkles className="h-5 w-5" aria-hidden />
      </div>
      <p className="font-display text-[18px] tracking-tight text-ink">
        Your annotations will land here.
      </p>
      <p className="max-w-[24ch] text-xs text-ink-muted">
        Each pause in the writing becomes a numbered card you can revisit and pin to the page.
      </p>
    </div>
  );
}
