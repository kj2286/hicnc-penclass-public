import { ArrowDownToLine, ArrowUpFromLine, CircleDot, Gauge, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStrokeStore } from '@/store/stroke.store';

export function StatsRow() {
  const selectedKey = useStrokeStore((s) => s.selectedPageKey ?? s.currentPageKey);
  const byPage = useStrokeStore((s) => s.byPage);
  const isPenDown = useStrokeStore((s) => s.isPenDown);
  const lastPressure = useStrokeStore((s) => s.lastPressure);

  const strokes = selectedKey ? (byPage[selectedKey] ?? []) : [];
  const dotCount = strokes.reduce((sum, s) => sum + s.dots.length, 0);

  return (
    <div className="flex items-center gap-1.5">
      <Stat icon={Layers} label="Strokes" value={strokes.length.toString()} />
      <Stat icon={CircleDot} label="Dots" value={dotCount.toString()} />
      <Stat
        icon={Gauge}
        label="Pressure"
        value={lastPressure != null ? String(lastPressure) : '—'}
        accent={pressureAccent(lastPressure)}
      />
      <Stat
        icon={isPenDown ? ArrowDownToLine : ArrowUpFromLine}
        label="Pen"
        value={isPenDown ? 'DOWN' : 'UP'}
        accent={isPenDown ? 'text-success' : 'text-muted-foreground'}
      />
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
