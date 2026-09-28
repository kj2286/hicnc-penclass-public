/**
 * **획 지문(id) 기반 새 필기 판별** — 펜 시계를 믿지 않는다.
 *
 * 실사고(2026-08-17, 김경수 펜): 펜 내장 시계가 약 하루 늦어, 오늘 쓴 415획이
 * "8/16 필기"로 기록돼 어제 날짜 문서로 들어갔다. 사용자에게는 "업로드했는데
 * 오늘 기록에 없다 / 이상한 데로 들어간다"로 보였다 — 신뢰를 깎는 최악의 증상.
 *
 * 시각 기반 워터마크는 시계가 늦는 펜 앞에서 원리적으로 무력하다: "옛 시각이
 * 찍힌 새 획"과 "진짜 옛 획"을 시각만으로는 가를 수 없다. 그러나 획 id 는
 * 펜 데이터에서 결정적으로 만들어진다(`off_섹션_..._시작시각_점수`) — 같은 획은
 * 몇 번을 받아도 같은 id 다. 그래서:
 *
 *   지난 수거 때 본 적 없는 id = **새 필기** → 수신일(오늘) 문서로
 *   본 적 있는 id             = 이미 저장됨 → 병합에서 제외
 *
 * 첫 수거(본 적 목록이 없음)는 예외 — 몇 주치 옛 필기가 통째로 "오늘"이 되는
 * 것을 막기 위해 기존 시각 기반 규칙을 그대로 쓴다.
 */
import type { Stroke } from '@/pen/live/model/stroke';

const KEY = 'pc_desk_pen_seen_ids_v1';

type SeenMap = Record<string, string[]>;

function load(): SeenMap {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as SeenMap;
  } catch {
    return {};
  }
}

/** 이 펜을 전에 수거한 적이 있는가 — 없으면 시각 기반 규칙으로 폴백해야 한다. */
export function hasSeenRecord(penKey: string): boolean {
  return load()[penKey] !== undefined;
}

/** 지난 수거 이후의 **새 획**만 골라낸다 (id 기준). */
export function splitNewStrokes(penKey: string, incoming: Stroke[]): Stroke[] {
  const seen = new Set(load()[penKey] ?? []);
  return incoming.filter((s) => !seen.has(s.id));
}

/** 이 펜의 수거 기록을 지운다 — 서버 기록 삭제 후 재수거(처음부터 다시 저장)용. */
export function clearSeenRecord(penKey: string): void {
  const m = load();
  if (!(penKey in m)) return;
  delete m[penKey];
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* noop */
  }
}

/** 이번 수거에서 본 획 전부를 기록한다 — **저장이 성공한 뒤에만** 부를 것. */
export function recordSeen(penKey: string, incoming: Stroke[]): void {
  const m = load();
  const seen = new Set(m[penKey] ?? []);
  for (const s of incoming) seen.add(s.id);
  m[penKey] = [...seen];
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    // 저장소가 가득 차면 다음 수거가 시각 기반으로 동작할 뿐 — 치명적이지 않다
  }
}
