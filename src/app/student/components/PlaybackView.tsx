/**
 * 필기 타임라인 재생 뷰 (재사용 컴포넌트).
 * - 페이지가 여러 개면 상단에 페이지 선택 칩을 보여준다.
 * - 캔버스(StrokeCanvas) + 재생/일시정지, 배속(1/2/4), 진행 슬라이더, 시간 표시.
 */
import { useEffect, useMemo, useState } from 'react';
import { Pause, Play, Square } from 'lucide-react';
import { ActionButton } from 'seed-design/ui/action-button';
import {
  SegmentedControl,
  SegmentedControlItem,
} from 'seed-design/ui/segmented-control';
import { ChipLabel, RadioChipItem, RadioChipRoot } from 'seed-design/ui/chip';
import { Slider } from '@/components/ui/slider';
import { StrokeCanvas } from '@/pen/live/StrokeCanvas';
import { usePlayback, type PlaybackSpeed } from '@/pen/offline/hooks/usePlayback';
import type { Stroke } from '@/pen/live/model/stroke';

export type PlaybackPage = {
  /** 페이지 선택 값으로 쓰는 고유 키 */
  id: string;
  /** 칩에 표시할 라벨 (예: "3쪽") */
  label: string;
  strokes: Stroke[];
};

const EMPTY: readonly Stroke[] = Object.freeze([]);

export function formatMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function PlaybackView({
  pages,
  canvasClassName,
}: {
  pages: PlaybackPage[];
  canvasClassName?: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    pages[0]?.id ?? null,
  );

  // 페이지 목록이 바뀌면 선택을 보정한다.
  useEffect(() => {
    if (pages.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!pages.some((p) => p.id === selectedId)) {
      setSelectedId(pages[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages]);

  const strokes = useMemo<readonly Stroke[]>(() => {
    if (!selectedId) return EMPTY;
    return pages.find((p) => p.id === selectedId)?.strokes ?? EMPTY;
  }, [pages, selectedId]);

  const control = usePlayback(strokes);
  const {
    filteredStrokes,
    elapsedMs,
    totalMs,
    progress,
    isPlaying,
    speed,
    togglePlay,
    stop,
    seek,
    setSpeed,
  } = control;

  return (
    <div className="flex flex-col gap-3">
      {pages.length > 1 && (
        <RadioChipRoot
          value={selectedId ?? ''}
          onValueChange={(v) => setSelectedId(String(v))}
          aria-label="페이지 선택"
        >
          <div className="flex flex-wrap items-center gap-2">
            {pages.map((p) => (
              <RadioChipItem key={p.id} value={p.id} size="small">
                <ChipLabel>{p.label}</ChipLabel>
              </RadioChipItem>
            ))}
          </div>
        </RadioChipRoot>
      )}

      <div className={canvasClassName ?? 'h-[420px] w-full'}>
        <StrokeCanvas strokes={filteredStrokes} className="bg-layer-default" />
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-line-weak bg-layer-default p-4">
        <div className="flex items-center gap-3">
          <ActionButton
            variant="neutralOutline"
            size="small"
            onClick={stop}
            aria-label="정지"
            className="aspect-square !px-0 w-9 justify-center"
          >
            <Square size={14} />
          </ActionButton>
          <ActionButton
            variant="brandSolid"
            size="small"
            onClick={togglePlay}
            aria-label={isPlaying ? '일시정지' : '재생'}
            className="aspect-square !px-0 w-9 justify-center"
          >
            {isPlaying ? <Pause size={14} /> : <Play size={14} />}
          </ActionButton>
          <Slider
            value={[Math.round(progress * 1000)]}
            min={0}
            max={1000}
            step={1}
            onValueChange={(v) => seek((v[0] ?? 0) / 1000)}
            className="flex-1"
            aria-label="재생 위치"
          />
          <span className="shrink-0 font-mono text-xs tabular-nums text-ink-muted">
            {formatMs(elapsedMs)} / {formatMs(totalMs)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-ink-muted">배속</span>
          <SegmentedControl
            aria-label="재생 배속"
            value={String(speed)}
            onValueChange={(v) => setSpeed(Number(v) as PlaybackSpeed)}
            className="w-48"
          >
            <SegmentedControlItem value="1">1배속</SegmentedControlItem>
            <SegmentedControlItem value="2">2배속</SegmentedControlItem>
            <SegmentedControlItem value="4">4배속</SegmentedControlItem>
          </SegmentedControl>
        </div>
      </div>
    </div>
  );
}
