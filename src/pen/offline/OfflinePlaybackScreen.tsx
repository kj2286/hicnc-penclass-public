import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CircleDot, FileText, Gauge, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { PaperCanvas } from '@/pen/paper/PaperCanvas';
import { useOfflineStore } from '@/store/offline.store';
import { usePlayback } from './hooks/usePlayback';
import { PlaybackControlBar } from './PlaybackControlBar';
import type { Stroke } from '@/pen/live/model/stroke';

const EMPTY: readonly Stroke[] = Object.freeze([]);

export function OfflinePlaybackScreen() {
  const navigate = useNavigate();
  const download = useOfflineStore((s) => s.download);

  const isDownloaded = download.kind === 'downloaded';
  const strokesByPage = isDownloaded ? download.strokesByPage : {};
  const note = isDownloaded ? download.note : null;

  const pages = useMemo(
    () => Object.keys(strokesByPage).map(Number).sort((a, b) => a - b),
    [strokesByPage],
  );

  const [selectedPage, setSelectedPage] = useState<number | null>(null);

  // Pick first page by default
  useEffect(() => {
    if (selectedPage == null && pages.length > 0) {
      setSelectedPage(pages[0]);
    } else if (selectedPage != null && !pages.includes(selectedPage)) {
      setSelectedPage(pages[0] ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages]);

  const strokes = useMemo<readonly Stroke[]>(() => {
    if (selectedPage == null) return EMPTY;
    return strokesByPage[selectedPage] ?? EMPTY;
  }, [strokesByPage, selectedPage]);

  const control = usePlayback(strokes);

  const totalDots = useMemo(
    () => strokes.reduce((sum, s) => sum + s.dots.length, 0),
    [strokes],
  );
  const lastPressure = control.filteredStrokes.length > 0
    ? control.filteredStrokes[control.filteredStrokes.length - 1].dots.slice(-1)[0]?.pressure ?? null
    : null;

  if (!isDownloaded || pages.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <FileText className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-semibold">재생할 오프라인 데이터가 없습니다</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Offline 탭에서 노트를 먼저 다운로드해 주세요.
            </p>
            <Button variant="outline" size="sm" onClick={() => navigate('/home/offline')}>
              오프라인 목록으로
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-4xl flex-col">
      <div className="flex items-center gap-2 px-4 py-2">
        <Button variant="ghost" size="icon" onClick={() => navigate('/home/offline')} aria-label="목록">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            Note {note?.noteId} · Section {note?.section} · Owner {note?.owner}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {pages.length}개 페이지 · 재생 중인 페이지 {selectedPage}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Stat icon={Layers} label="Strokes" value={`${control.filteredStrokes.length}/${strokes.length}`} />
          <Stat icon={CircleDot} label="Dots" value={String(totalDots)} />
          <Stat
            icon={Gauge}
            label="Pressure"
            value={lastPressure != null ? String(lastPressure) : '—'}
            accent={pressureAccent(lastPressure)}
          />
        </div>
      </div>

      {pages.length > 1 && (
        <div className="no-scrollbar flex items-center gap-2 overflow-x-auto px-4 pb-2">
          {pages.map((p) => (
            <button
              key={p}
              onClick={() => setSelectedPage(p)}
              className={cn(
                'whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                p === selectedPage
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-muted-foreground hover:text-foreground',
              )}
            >
              Page {p}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 px-4 pb-2">
        <PaperCanvas
          section={note?.section}
          owner={note?.owner}
          noteId={note?.noteId}
          pageNumber={selectedPage}
          strokes={control.filteredStrokes}
        />
      </div>

      <PlaybackControlBar control={control} />
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div
      className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1"
      title={label}
    >
      <Icon className={cn('h-3.5 w-3.5 shrink-0', accent ?? 'text-muted-foreground')} />
      <span className={cn('text-xs font-semibold tabular-nums', accent)}>{value}</span>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
    </div>
  );
}

function pressureAccent(p: number | null): string | undefined {
  if (p == null) return undefined;
  if (p < 300) return 'text-success';
  if (p < 600) return 'text-warning';
  return 'text-destructive';
}
