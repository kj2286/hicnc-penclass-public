/**
 * 필기 타임라인 재생 뷰 — usePlayback + StrokeCanvas 조합.
 * 재생/일시정지, 배속(1·2·4), 시크 슬라이더, 경과/전체 시간을 제공한다.
 */
import { Pause, Play, RotateCcw } from 'lucide-react';
import { ActionButton } from 'seed-design/ui/action-button';
import {
  SegmentedControl,
  SegmentedControlItem,
} from 'seed-design/ui/segmented-control';
import { Slider } from '@/components/ui/slider';
import { PaperCanvas } from '@/pen/paper/PaperCanvas';
import { buildPageKey } from '@/lib/pen-event-bus';
import {
  usePlayback,
  type PlaybackSpeed,
  type UsePlaybackResult,
} from '@/pen/offline/hooks/usePlayback';
import type { Stroke } from '@/pen/live/model/stroke';
import { formatClock } from '../format';

const SEEK_RESOLUTION = 1000;

type PaperRef = {
  section?: number;
  owner?: number;
  noteId?: number;
  pageNumber?: number;
};

export function PlaybackView({
  strokes,
  playback: external,
  paperPage,
  emptyLabel,
  followPages = false,
  focusRect,
  highlight,
  highlightStrokeIds,
  regions,
  onRegionClick,
  marks,
  drawMode,
  onDrawRect,
}: {
  strokes: readonly Stroke[];
  /** 부모가 usePlayback 을 직접 쥐고 시크를 제어할 때 주입 (AI 분석 타임라인 점프) */
  playback?: UsePlaybackResult;
  /** 배경 페이지 지정 — undefined 면 strokes[0] 에서 유도, null 이면 배경 없음 */
  paperPage?: PaperRef | null;
  /** 필기가 없을 때 배경 위에 띄울 문구 (문항 선택 시 '아직 풀지 않았습니다') */
  emptyLabel?: string;
  /** 전체 재생 모드 — 재생 중인 스트로크의 페이지를 따라가며 배경·필기를 전환 */
  followPages?: boolean;
  /** 문항 포커스 — 지정 영역(ncode)이 꽉 차게 확대 (PaperCanvas 위임) */
  focusRect?: { minX: number; minY: number; maxX: number; maxY: number } | null;
  /** 선택 문항 표시 — ncode 사각형에 파란 하이라이트 (PaperCanvas 위임) */
  highlight?: {
    id?: string;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } | null;
  /** AI 분석 문제점 구간의 스트로크 — 빨간색으로 표시 */
  highlightStrokeIds?: ReadonlySet<string>;
  /** 문항 영역 오버레이 (편집 모드) */
  regions?: Array<{
    id?: string;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    label?: string;
    active?: boolean;
  }>;
  onRegionClick?: (id: string) => void;
  /** 문항 정오 마크 — 선생님 손그림 스타일 (PaperCanvas 위임) */
  marks?: Array<{
    id?: string;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    verdict: 'correct' | 'wrong';
  }>;
  /** 드래그로 문항 영역 그리기 */
  drawMode?: boolean;
  onDrawRect?: (rect: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }) => void;
}) {
  const internal = usePlayback(external ? [] : strokes);
  const playback = external ?? internal;
  const {
    filteredStrokes,
    progress,
    elapsedMs,
    totalMs,
    isPlaying,
    speed,
    togglePlay,
    stop,
    seek,
    setSpeed,
  } = playback;

  return (
    <div className="space-y-3">
      <div className="h-[440px] overflow-hidden rounded-xl border border-line-weak bg-layer-default">
        {strokes.length === 0 && paperPage ? (
          // 필기 없는 페이지 — 배경(교재)만 보여준다 (전체 페이지 표시 모드)
          <div className="relative h-full">
            <PaperCanvas
              section={paperPage.section}
              owner={paperPage.owner}
              noteId={paperPage.noteId}
              pageNumber={paperPage.pageNumber}
              strokes={[]}
              className="h-full w-full"
            />
            <div className="absolute left-3 top-3 rounded-md border border-line-weak bg-layer-default/90 px-2 py-1 text-xs text-ink-subtle">
              {emptyLabel ?? '이 페이지에는 아직 필기가 없습니다'}
            </div>
          </div>
        ) : strokes.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-ink-subtle">
            이 페이지에는 필기 데이터가 없습니다.
          </div>
        ) : (
          // 등록 교재(시험지)면 원본 PDF 배경 위에 재생 — 스트로크가 어느
          // 페이지에 쓰였는지는 스트로크 자체의 ncode 좌표가 알고 있다.
          (() => {
            let identity: PaperRef | undefined;
            let visible = filteredStrokes;
            if (followPages) {
              // 전체 재생: 방금 그려진 스트로크의 페이지를 따라간다
              const cursor =
                filteredStrokes[filteredStrokes.length - 1] ?? strokes[0];
              if (cursor) {
                identity = cursor;
                const k = buildPageKey(
                  cursor.section,
                  cursor.owner,
                  cursor.noteId,
                  cursor.pageNumber,
                );
                visible = filteredStrokes.filter(
                  (s) =>
                    buildPageKey(s.section, s.owner, s.noteId, s.pageNumber) === k,
                );
              }
            } else if (paperPage !== undefined) {
              identity = paperPage ?? undefined;
            } else {
              identity = strokes[0];
            }
            return (
              <PaperCanvas
                section={identity?.section}
                owner={identity?.owner}
                noteId={identity?.noteId}
                pageNumber={identity?.pageNumber}
                strokes={visible}
                focusRect={focusRect}
                highlight={highlight}
                highlightStrokeIds={highlightStrokeIds}
                regions={regions}
                onRegionClick={onRegionClick}
                marks={marks}
                drawMode={drawMode}
                onDrawRect={onDrawRect}
                className="h-full w-full"
              />
            );
          })()
        )}
      </div>

      <div className="flex items-center gap-3">
        <ActionButton
          variant="brandSolid"
          size="small"
          onClick={togglePlay}
          disabled={strokes.length === 0}
          aria-label={isPlaying ? '일시정지' : '재생'}
        >
          {isPlaying ? <Pause size={15} /> : <Play size={15} />}
        </ActionButton>
        <ActionButton
          variant="neutralWeak"
          size="small"
          onClick={stop}
          disabled={strokes.length === 0}
          aria-label="처음으로"
        >
          <RotateCcw size={15} />
        </ActionButton>

        <div className="min-w-0 flex-1">
          <Slider
            aria-label="재생 위치"
            value={[Math.round(progress * SEEK_RESOLUTION)]}
            min={0}
            max={SEEK_RESOLUTION}
            step={1}
            disabled={strokes.length === 0}
            onValueChange={(v) => seek((v[0] ?? 0) / SEEK_RESOLUTION)}
          />
        </div>

        <span className="shrink-0 text-xs tabular-nums text-ink-muted">
          {formatClock(elapsedMs)} / {formatClock(totalMs)}
        </span>

        <SegmentedControl
          aria-label="재생 배속"
          value={String(speed)}
          onValueChange={(v) => setSpeed(Number(v) as PlaybackSpeed)}
        >
          <SegmentedControlItem value="1">1×</SegmentedControlItem>
          <SegmentedControlItem value="2">2×</SegmentedControlItem>
          <SegmentedControlItem value="4">4×</SegmentedControlItem>
        </SegmentedControl>
      </div>
    </div>
  );
}
