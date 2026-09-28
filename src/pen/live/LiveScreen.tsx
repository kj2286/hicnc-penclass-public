import { useEffect, useMemo, useRef, useState } from 'react';
import { Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStrokeStore } from '@/store/stroke.store';
import { useOcrStore } from '@/store/ocr.store';
import { isOcrEnabled } from '@/lib/ocr-client';
import { PaperCanvas, type HighlightRect } from '@/pen/paper/PaperCanvas';
import { PageInfoBar } from './PageInfoBar';
import { PageSelector } from './PageSelector';
import { StatsRow } from './StatsRow';
import { NoiseFilterToggle } from './NoiseFilterToggle';
import { NotebookRail } from './NotebookRail';
import { groupStrokes, type StrokeGroup } from './model/stroke-groups';
import type { Stroke } from './model/stroke';

/** Settle window after pen-up before OCRing the trailing group. Just
 *  shorter than `DEFAULT_TIME_GAP_MS` (2500) so we don't OCR a group
 *  that's about to absorb the next stroke. */
const TRAILING_OCR_DELAY_MS = 1200;

const EMPTY_STROKES: readonly Stroke[] = Object.freeze([]);

export function LiveScreen() {
  const selectedKey = useStrokeStore((s) => s.selectedPageKey ?? s.currentPageKey);
  const strokes = useStrokeStore((s) =>
    selectedKey && s.byPage[selectedKey] ? s.byPage[selectedKey] : EMPTY_STROKES,
  ) as readonly Stroke[];
  const currentPage = useStrokeStore((s) => {
    const key = s.selectedPageKey ?? s.currentPageKey;
    return key ? s.livePages.find((p) => p.key === key) : undefined;
  });
  const hasAny = useStrokeStore((s) => s.livePages.length > 0);
  const isPenDown = useStrokeStore((s) => s.isPenDown);
  const undoOnPage = useStrokeStore((s) => s.undoOnPage);
  const clearPage = useStrokeStore((s) => s.clearPage);

  const groups = useMemo<StrokeGroup[]>(() => groupStrokes(strokes), [strokes]);

  // Auto-trigger OCR for groups as they finalise. Non-trailing groups
  // are immediately stable (proximity rules already split them). The
  // trailing group needs a settle window in case the user starts another
  // stroke that merges into it.
  const recognizeGroup = useOcrStore((s) => s.recognizeGroup);
  useEffect(() => {
    if (!isOcrEnabled()) return;
    for (let i = 0; i < groups.length - 1; i++) {
      void recognizeGroup(groups[i]);
    }
    const last = groups[groups.length - 1];
    if (!last || isPenDown) return;
    const timer = window.setTimeout(() => {
      void recognizeGroup(last);
    }, TRAILING_OCR_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [groups, isPenDown, recognizeGroup]);

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null);

  // When pages change, drop the selection — old group ids no longer exist.
  useEffect(() => {
    setSelectedGroupId(null);
    setHoveredGroupId(null);
  }, [selectedKey]);

  // While the pen is actively drawing the user almost certainly cares about
  // the latest annotation. Auto-follow the trailing group, but only when the
  // user hasn't pinned a card themselves.
  const userPinnedRef = useRef(false);
  useEffect(() => {
    if (!isPenDown) return;
    if (userPinnedRef.current) return;
    const last = groups[groups.length - 1];
    if (last && last.id !== selectedGroupId) {
      setSelectedGroupId(last.id);
    }
  }, [groups, isPenDown, selectedGroupId]);

  function handleSelect(id: string) {
    userPinnedRef.current = true;
    setSelectedGroupId((prev) => (prev === id ? null : id));
  }

  function handleHover(id: string | null) {
    setHoveredGroupId(id);
  }

  const selectedGroup = useMemo(
    () => groups.find((g) => g.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );
  const hoveredGroup = useMemo(
    () => groups.find((g) => g.id === hoveredGroupId) ?? null,
    [groups, hoveredGroupId],
  );

  const highlight: HighlightRect | null = selectedGroup
    ? {
        id: selectedGroup.id,
        minX: selectedGroup.highlightBox.minX,
        minY: selectedGroup.highlightBox.minY,
        maxX: selectedGroup.highlightBox.maxX,
        maxY: selectedGroup.highlightBox.maxY,
      }
    : null;

  const hoverHighlight: HighlightRect | null = hoveredGroup
    ? {
        id: hoveredGroup.id,
        minX: hoveredGroup.highlightBox.minX,
        minY: hoveredGroup.highlightBox.minY,
        maxX: hoveredGroup.highlightBox.maxX,
        maxY: hoveredGroup.highlightBox.maxY,
      }
    : null;

  return (
    <div
      data-testid="live-screen"
      className="flex h-full min-h-0 w-full flex-col bg-parchment-100"
    >
      <PageSelector />
      <div className="flex flex-wrap items-center gap-2 px-5 pt-3 pb-2">
        <PageInfoBar />
        <div className="min-w-0 flex-1" />
        <NoiseFilterToggle />
        <StatsRow />
      </div>

      {/* Split layout: paper on the left, annotation rail on the right. */}
      <div
        data-testid="live-split"
        className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]"
      >
        <section
          data-testid="paper-pane"
          className="relative min-h-0 px-4 pb-4 pt-1"
        >
          {hasAny ? (
            <PaperCanvas
              section={currentPage?.section}
              owner={currentPage?.owner}
              noteId={currentPage?.noteId}
              pageNumber={currentPage?.pageNumber}
              strokes={strokes}
              highlight={highlight}
              hoverHighlight={hoverHighlight}
              className="shadow-paper-drop"
              overlay={
                <div className="absolute left-3 top-3 z-10 flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-parchment-300 bg-white/95 text-ink shadow-card-rest backdrop-blur hover:bg-marker-tint hover:text-ink"
                    onClick={() => undoOnPage()}
                  >
                    <RotateCcw className="h-4 w-4" />
                    Undo
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-parchment-300 bg-white/95 text-ink shadow-card-rest backdrop-blur hover:bg-marker-tint hover:text-ink"
                    onClick={() => clearPage()}
                  >
                    <Trash2 className="h-4 w-4" />
                    Clear
                  </Button>
                </div>
              }
            />
          ) : (
            <ScreenEmptyState />
          )}
        </section>

        <NotebookRail
          groups={groups}
          selectedGroupId={selectedGroupId}
          hoveredGroupId={hoveredGroupId}
          onSelect={handleSelect}
          onHover={handleHover}
          isPenDown={isPenDown}
        />
      </div>
    </div>
  );
}

function ScreenEmptyState() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="relative max-w-md rounded-2xl border border-parchment-300/80 bg-white px-10 py-12 text-center shadow-paper-drop">
        <div
          aria-hidden
          className="absolute -top-3 left-1/2 h-6 w-24 -translate-x-1/2 rounded-sm bg-marker/55 shadow-[0_2px_6px_rgba(27,54,193,0.22)]"
          style={{ transform: 'translateX(-50%) rotate(-2.4deg)' }}
        />
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-marker-tint text-ink">
          <Pencil className="h-6 w-6" />
        </div>
        <p className="font-display text-[20px] tracking-tight text-ink">
          Awaiting your first stroke.
        </p>
        <p className="mx-auto mt-2 max-w-[28ch] text-sm text-ink-muted">
          Begin writing on a Neo notebook page — your annotations and bounded notes will appear
          on the right.
        </p>
      </div>
    </div>
  );
}
