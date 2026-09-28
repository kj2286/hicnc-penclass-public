/**
 * 실시간 라이브 용량 규칙 — 순수 함수 (교실 모드·원격 모드 공용).
 *
 * 라이브 카드 하나가 캔버스 하나를 계속 다시 그린다. 펜이 20~30자루씩 붙으면
 * 캔버스도 그만큼 늘어 브라우저가 버티지 못한다. 그래서 **라이브는 소규모용**으로
 * 못박고(사용자 결정, 2026-08-14), 동시에 그리는 캔버스 수를 제한한다.
 *
 * 제한을 "숨김"으로 만들지는 않는다 — 넘친 참가자도 목록으로 계속 보이고,
 * [보기] 로 고정하면 화면 자리를 차지하던 다른 카드와 교대한다. 즉 **누가 접속했는지는
 * 항상 알 수 있고, 동시에 그리는 것만 줄인다.**
 */

/** 동시에 캔버스를 그릴 최대 인원. 이 수를 넘으면 나머지는 목록으로 표시한다. */
export const LIVE_RECOMMENDED_MAX = 8;

export interface CapacitySplit<T> {
  /** 캔버스까지 실시간으로 그리는 항목 */
  shown: T[];
  /** 접속해 있지만 캔버스는 그리지 않는 항목 (목록으로 표시) */
  overflow: T[];
}

/**
 * 참가자를 "그릴 것"과 "목록으로 둘 것"으로 가른다.
 *
 * 고정(pinned)한 항목이 항상 먼저 자리를 잡는다 — 선생님이 특정 학생을 보겠다고
 * 골랐는데 접속 순서에 밀려 사라지면 안 된다. 남는 자리는 원래 순서대로 채운다.
 *
 * @param keyOf   항목의 고유 키 (pinned 와 대조할 값)
 * @param pinned  선생님이 [보기] 로 고정한 키 집합
 * @param max     동시에 그릴 최대 수 (기본 LIVE_RECOMMENDED_MAX)
 */
export function splitByCapacity<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  pinned: ReadonlySet<string> = new Set(),
  max: number = LIVE_RECOMMENDED_MAX,
): CapacitySplit<T> {
  if (max <= 0) return { shown: [], overflow: [...items] };
  if (items.length <= max) return { shown: [...items], overflow: [] };

  const shown: T[] = [];
  const rest: T[] = [];
  // 1순위: 고정된 항목 (원래 순서 유지)
  for (const item of items) {
    if (pinned.has(keyOf(item)) && shown.length < max) shown.push(item);
    else rest.push(item);
  }
  // 2순위: 남은 자리를 원래 순서대로
  const overflow: T[] = [];
  for (const item of rest) {
    if (shown.length < max) shown.push(item);
    else overflow.push(item);
  }
  return { shown, overflow };
}

/**
 * 넘친 인원을 알리는 문구. 넘치지 않으면 null (배너를 아예 안 띄운다).
 * 숫자를 문구에 넣어 "왜 일부만 그려지는지"가 바로 읽히게 한다.
 */
export function capacityNotice(
  total: number,
  max: number = LIVE_RECOMMENDED_MAX,
): { title: string; description: string } | null {
  if (total <= max) return null;
  return {
    title: `실시간 화면은 ${max}명까지 동시에 보여줍니다`,
    description:
      `지금 ${total}명이 연결돼 있어 ${total - max}명은 아래 목록으로 표시됩니다. ` +
      `보고 싶은 사람의 [보기] 를 누르면 화면에 올라옵니다. ` +
      `필기는 모두 정상 저장되니 나중에 학생 관리 > 필기 기록에서 전부 확인할 수 있습니다.`,
  };
}
