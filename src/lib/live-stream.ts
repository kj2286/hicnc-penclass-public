/**
 * 원격 실시간 라이브(Mode A) — 학생 기기의 펜 필기를 Supabase Realtime
 * 브로드캐스트로 선생님 화면에 스트리밍한다.
 *
 * 채널 토픽: `live-{teacherId}` (선생님별 교실 룸)
 * - 학생: penBus 'dot' 을 250ms 버퍼로 묶어 broadcast 'dots' 전송
 *   + presence 로 접속 상태 공유
 * - 선생님: 같은 토픽 구독 → 학생별 dot 배치 수신 + presence 목록
 *
 * Vercel(서버리스)에는 상시 WebSocket 서버가 없으므로 Supabase Realtime 을
 * 전송 계층으로 쓴다. dot 원본을 그대로 흘리지 않고 배치로 묶어
 * Realtime 기본 rate limit(초당 10msg) 아래로 유지한다.
 */
import type { RealtimeChannel } from '@supabase/supabase-js';
import { requireSupabase } from '@/lib/supabase';
import { penBus, type DotPayload } from '@/lib/pen-event-bus';

const FLUSH_INTERVAL_MS = 250;
const DOT_HOVER = 3;
const DOT_ERROR = 5;

/** 전송용 dot — DotPayload 에서 렌더에 필요한 필드만 추린다 */
export type RemoteDot = {
  section: number;
  owner: number;
  noteId: number;
  pageNumber: number;
  x: number;
  y: number;
  pressure: number;
  maxPressure: number;
  dotType: number;
  timeStamp: number;
};

export type RemoteDotsPayload = {
  studentId: string;
  studentName: string;
  dots: RemoteDot[];
};

export type RemotePresence = {
  studentId: string;
  studentName: string;
};

export function liveTopic(teacherId: string): string {
  return `live-${teacherId}`;
}

/**
 * 학생 측 — 펜 dot 을 선생님 룸으로 스트리밍 시작.
 * 반환된 함수를 호출하면 중지(채널 해제·버퍼 폐기).
 */
export function startLiveShare(args: {
  teacherId: string;
  studentId: string;
  studentName: string;
}): () => void {
  const supabase = requireSupabase();
  const channel = supabase.channel(liveTopic(args.teacherId), {
    config: { presence: { key: args.studentId } },
  });

  let buffer: RemoteDot[] = [];
  let ready = false;

  const onDot = (dot: DotPayload) => {
    if (dot.dotType === DOT_HOVER || dot.dotType === DOT_ERROR) return;
    buffer.push({
      section: dot.section,
      owner: dot.owner,
      noteId: dot.noteId,
      pageNumber: dot.pageNumber,
      x: dot.x,
      y: dot.y,
      pressure: dot.pressure,
      maxPressure: dot.maxPressure,
      dotType: dot.dotType,
      timeStamp: dot.timeStamp,
    });
  };

  const timer = setInterval(() => {
    if (!ready || buffer.length === 0) return;
    const dots = buffer;
    buffer = [];
    void channel.send({
      type: 'broadcast',
      event: 'dots',
      payload: {
        studentId: args.studentId,
        studentName: args.studentName,
        dots,
      } satisfies RemoteDotsPayload,
    });
  }, FLUSH_INTERVAL_MS);

  penBus.on('dot', onDot);
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      ready = true;
      void channel.track({
        studentId: args.studentId,
        studentName: args.studentName,
      } satisfies RemotePresence);
    }
  });

  return () => {
    clearInterval(timer);
    penBus.off('dot', onDot);
    buffer = [];
    void supabase.removeChannel(channel);
  };
}

/**
 * 선생님 측 — 교실 룸 구독. dot 배치와 참여자(presence) 변화를 콜백으로 전달.
 * 반환된 함수를 호출하면 구독 해제.
 */
export function subscribeLiveClass(
  teacherId: string,
  handlers: {
    onDots: (payload: RemoteDotsPayload) => void;
    onPresence: (students: RemotePresence[]) => void;
  },
): () => void {
  const supabase = requireSupabase();
  const channel: RealtimeChannel = supabase.channel(liveTopic(teacherId));

  channel.on('broadcast', { event: 'dots' }, ({ payload }) => {
    const p = payload as RemoteDotsPayload;
    if (p && p.studentId && Array.isArray(p.dots)) handlers.onDots(p);
  });

  const emitPresence = () => {
    const state = channel.presenceState<RemotePresence>();
    const list: RemotePresence[] = [];
    for (const entries of Object.values(state)) {
      const first = entries[0];
      if (first?.studentId) {
        list.push({ studentId: first.studentId, studentName: first.studentName });
      }
    }
    handlers.onPresence(list);
  };
  channel.on('presence', { event: 'sync' }, emitPresence);

  channel.subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
