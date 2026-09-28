import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Stroke } from '@/pen/live/model/stroke';
import {
  buildCompressedTimeline,
  computeTimeRange,
  filterByCutoff,
  realToVirtual,
  virtualToReal,
} from '../model/stroke-playback-filter';

export type PlaybackSpeed = 1 | 2 | 4;

export type UsePlaybackResult = {
  /** Strokes filtered to current timestamp */
  filteredStrokes: Stroke[];
  /** Full time range of source strokes (실제 시각 기준) */
  range: { min: number; max: number };
  /** Current cutoff timestamp (실제 시각) */
  currentTs: number;
  /** Progress ratio 0..1 (압축 타임라인 기준) */
  progress: number;
  /** Elapsed ms — 공백 제거된 실필기 시간 기준 */
  elapsedMs: number;
  /** Total duration ms — 공백 제거된 실필기 시간 */
  totalMs: number;
  /** Is the ticker actively advancing */
  isPlaying: boolean;
  speed: PlaybackSpeed;
  /** Play/Pause toggle */
  togglePlay: () => void;
  /** Stop and rewind to start */
  stop: () => void;
  /** Seek by ratio 0..1 (압축 타임라인 기준) */
  seek: (ratio: number) => void;
  /** 실제 시각(ms) 으로 시크 — AI 분석 타임라인 점프용 */
  seekToTs: (ts: number) => void;
  /** Change speed multiplier */
  setSpeed: (s: PlaybackSpeed) => void;
};

/**
 * requestAnimationFrame-based playback controller for offline strokes.
 *
 * **압축 타임라인**: 스트로크 사이 무필기 공백이 5초를 넘으면 그 구간을
 * 재생에서 통째로 제거한다 — 펜이 켜진 채 방치된 시간이 재생 길이를
 * 부풀리지 않게(실사고: 실필기 몇 분짜리가 600분으로 표시). progress·
 * elapsed·total·seek 는 전부 압축 시간 기준이고, `currentTs`/`filteredStrokes`
 * 는 실제 시각 기준을 유지해 캔버스 렌더와 호환된다.
 */
export function usePlayback(strokes: readonly Stroke[]): UsePlaybackResult {
  const range = useMemo(() => computeTimeRange(strokes), [strokes]);
  const timeline = useMemo(() => buildCompressedTimeline(strokes), [strokes]);
  // 기본 커서 = 끝 — 처음 열면 모든 필기가 입력된 "완성 상태"가 보인다.
  // 재생을 누르면 togglePlay 가 처음으로 되감아 처음부터 재생한다.
  const [currentTs, setCurrentTs] = useState<number>(range.max);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);

  const rafIdRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);
  const currentTsRef = useRef<number>(range.min);
  const speedRef = useRef<PlaybackSpeed>(1);

  // Keep refs in sync for access inside rAF closure
  speedRef.current = speed;
  currentTsRef.current = currentTs;

  // Reset cursor when stroke range changes — 완성 상태(끝)로
  useEffect(() => {
    setIsPlaying(false);
    setCurrentTs(range.max);
  }, [range.min, range.max]);

  const stopTicker = useCallback(() => {
    if (rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isPlaying) {
      stopTicker();
      return;
    }
    lastTickRef.current = performance.now();
    const frame = () => {
      const now = performance.now();
      const dt = now - lastTickRef.current;
      lastTickRef.current = now;
      // 압축 시간축에서 전진 — 구간 경계를 넘으면 공백을 건너뛴다
      const v = realToVirtual(timeline, currentTsRef.current) + dt * speedRef.current;
      if (v >= timeline.totalV) {
        currentTsRef.current = range.max;
        setCurrentTs(range.max);
        setIsPlaying(false);
        stopTicker();
        return;
      }
      const next = virtualToReal(timeline, v);
      currentTsRef.current = next;
      setCurrentTs(next);
      rafIdRef.current = requestAnimationFrame(frame);
    };
    rafIdRef.current = requestAnimationFrame(frame);
    return stopTicker;
  }, [isPlaying, range.max, timeline, stopTicker]);

  const filteredStrokes = useMemo(
    () => filterByCutoff(strokes, currentTs),
    [strokes, currentTs],
  );

  const togglePlay = useCallback(() => {
    setIsPlaying((prev) => {
      if (!prev && currentTsRef.current >= range.max) {
        // Restart from the beginning
        currentTsRef.current = range.min;
        setCurrentTs(range.min);
      }
      return !prev;
    });
  }, [range.max, range.min]);

  const stop = useCallback(() => {
    setIsPlaying(false);
    currentTsRef.current = range.min;
    setCurrentTs(range.min);
  }, [range.min]);

  const seek = useCallback(
    (ratio: number) => {
      const clamped = Math.max(0, Math.min(1, ratio));
      const next = virtualToReal(timeline, clamped * timeline.totalV);
      currentTsRef.current = next;
      setCurrentTs(next);
    },
    [timeline],
  );

  const seekToTs = useCallback(
    (ts: number) => {
      // 공백 안의 시각은 직전 필기 구간 끝으로 스냅된다
      const next = virtualToReal(timeline, realToVirtual(timeline, ts));
      currentTsRef.current = next;
      setCurrentTs(next);
    },
    [timeline],
  );

  const totalMs = timeline.totalV;
  const elapsedMs = Math.min(totalMs, realToVirtual(timeline, currentTs));
  const progress = totalMs > 0 ? elapsedMs / totalMs : 0;

  return {
    filteredStrokes,
    range,
    currentTs,
    progress,
    elapsedMs,
    totalMs,
    isPlaying,
    speed,
    togglePlay,
    stop,
    seek,
    seekToTs,
    setSpeed,
  };
}
