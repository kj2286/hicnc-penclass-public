/**
 * **PC 직결 라이브 획 → 기존 도트 버스.**
 *
 * 네이티브(BLE)는 획이 완성될 때마다 `Stroke` 하나를 올린다. 라이브 화면·멀티펜
 * 스토어·캔버스는 전부 `penBus` 의 **도트** 를 먹고 산다. 그래서 여기서 획을 도트로
 * 되돌려 같은 버스에 흘린다 — 화면 코드를 하나도 바꾸지 않고 원격 모드와 **완전히
 * 같은 결과**가 나온다(사용자 요구 2026-08-17: "라이브에서도 같은 결과가 나와야").
 *
 * 반대 방향(도트를 그대로 올리기)을 택하지 않은 이유는 획 조립기가 이미 코어에
 * 있어서다 — 웹에 또 만들면 두 조립기가 서로 어긋난다.
 */
import { buildPageKey, penBus, type DotPayload } from '@/lib/pen-event-bus';
import type { Stroke } from '@/pen/live/model/stroke';

/** 스토어와 **같은 값이어야 한다** — 다르면 획이 조립되지 않는다. */
const DOT_DOWN = 0;
const DOT_MOVE = 1;
const DOT_UP = 2;

/**
 * 완성된 획 하나를 도트열로 풀어 버스에 올린다.
 *
 * `key` 는 스토어의 펜 식별자다. BLE 는 macOS 에서 MAC 을 못 읽으므로 펜 개체 id 를
 * 그대로 쓴다 — 배정도 같은 키로 걸어야 카드에 학생 이름이 뜬다.
 */
export function emitLiveStroke(key: string, s: Stroke): void {
  if (s.dots.length === 0) return;

  const pageKey = buildPageKey(s.section, s.owner, s.noteId, s.pageNumber);
  const base = {
    mac: key,
    pageKey,
    section: s.section,
    owner: s.owner,
    noteId: s.noteId,
    pageNumber: s.pageNumber,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    timeDiff: 0,
  };
  const at = (d: Stroke['dots'][number], dotType: number): DotPayload => ({
    ...base,
    x: d.x,
    y: d.y,
    pressure: d.pressure,
    maxPressure: d.maxPressure || 852,
    dotType,
    timeStamp: d.timeStamp || s.startedAt,
  });

  const first = s.dots[0];
  const last = s.dots[s.dots.length - 1];
  // DOWN 은 **획 시작 신호일 뿐** 도트로 쌓이지 않는다(스토어가 그렇게 읽는다).
  penBus.emit('dot', at(first, DOT_DOWN));
  for (let i = 0; i < s.dots.length - 1; i += 1) {
    penBus.emit('dot', at(s.dots[i], DOT_MOVE));
  }
  // 마지막 도트는 UP 으로 — 이게 있어야 획이 닫히고 다음 획과 섞이지 않는다.
  // 도트가 하나뿐이면 MOVE 없이 DOWN → UP 이 된다. UP 은 열려 있는 획에 도트를
  // 넣고 닫으므로 그 한 점도 정확히 한 번만 쌓인다.
  penBus.emit('dot', at(last, DOT_UP));
}
