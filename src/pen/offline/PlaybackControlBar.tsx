import { Pause, Play, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import type { UsePlaybackResult, PlaybackSpeed } from './hooks/usePlayback';

type Props = {
  control: UsePlaybackResult;
  className?: string;
};

const SPEEDS: PlaybackSpeed[] = [1, 2, 4];

export function PlaybackControlBar({ control, className }: Props) {
  const { isPlaying, togglePlay, stop, progress, seek, elapsedMs, totalMs, speed, setSpeed } =
    control;

  return (
    <div
      className={cn(
        'flex flex-col gap-3 border-t border-border bg-background/95 p-3 backdrop-blur',
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <Button variant="outline" size="icon" onClick={stop} aria-label="정지">
          <Square className="h-4 w-4" />
        </Button>
        <Button size="icon" onClick={togglePlay} aria-label={isPlaying ? '일시정지' : '재생'}>
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <div className="flex flex-1 items-center gap-3">
          <Slider
            value={[Math.round(progress * 1000)]}
            min={0}
            max={1000}
            step={1}
            onValueChange={(v) => seek((v[0] ?? 0) / 1000)}
            className="flex-1"
          />
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {formatMs(elapsedMs)} / {formatMs(totalMs)}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">속도</span>
        <div className="inline-flex overflow-hidden rounded-md border border-border">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpeed(s)}
              className={cn(
                'px-3 py-1 text-xs font-medium transition-colors',
                s === speed
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background text-muted-foreground hover:bg-secondary hover:text-foreground',
              )}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
