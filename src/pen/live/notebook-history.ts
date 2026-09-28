/**
 * 라이브 노트/페이지 기록 영속화 — 펜 연결이 끊기거나 새로고침해도
 * "이전에 쓰던 노트"를 다시 볼 수 있도록 localStorage 에 스냅샷을 남긴다.
 *
 * 저장 단위는 화면(스토어)별 스냅샷 하나. localStorage 전체 한도(~5MB)를
 * 고려해 스냅샷이 한도를 넘으면 가장 오래된 페이지부터 지운다.
 */

const MAX_JSON_BYTES = 3_500_000;

export function loadSnapshot<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * 스냅샷 저장. 직렬화 크기가 한도를 넘으면 evictOldest 를 반복 호출해
 * 줄인 뒤 저장한다. evictOldest 는 페이지 하나를 제거하면 true,
 * 더 지울 것이 없으면 false 를 반환해야 한다.
 */
export function saveSnapshot(
  key: string,
  snapshot: unknown,
  evictOldest: () => boolean,
): void {
  try {
    let json = JSON.stringify(snapshot);
    while (json.length > MAX_JSON_BYTES && evictOldest()) {
      json = JSON.stringify(snapshot);
    }
    try {
      window.localStorage.setItem(key, json);
    } catch {
      // 쿼터 초과 — 절반 수준까지 더 비우고 한 번만 재시도
      const target = Math.floor(json.length / 2);
      while (json.length > target && evictOldest()) {
        json = JSON.stringify(snapshot);
      }
      window.localStorage.setItem(key, json);
    }
  } catch {
    // 영속화 실패(프라이빗 모드 등)는 라이브 기능을 막지 않는다
  }
}

const timers = new Map<string, number>();

/** 같은 key 저장을 800ms 디바운스한다. */
export function debouncedSave(key: string, run: () => void): void {
  const prev = timers.get(key);
  if (prev) window.clearTimeout(prev);
  timers.set(
    key,
    window.setTimeout(() => {
      timers.delete(key);
      run();
    }, 800),
  );
}

/** `{updatedAt}` 를 가진 목록에서 가장 오래된 항목의 인덱스. 비면 -1. */
export function oldestIndex(items: readonly { updatedAt?: number }[]): number {
  let idx = -1;
  let best = Infinity;
  for (let i = 0; i < items.length; i++) {
    const t = items[i].updatedAt ?? 0;
    if (t < best) {
      best = t;
      idx = i;
    }
  }
  return idx;
}
