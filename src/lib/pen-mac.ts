/**
 * 펜 MAC 매칭 — 순수 함수 (브라우저·네트워크 의존 없음).
 *
 * 크래들은 MAC 을 **뒷자리만** 주는 경우가 있다. 예전에는 "뒷자리가 걸치는 첫
 * 번째" 를 돌려줬는데, 그러면 서로 다른 펜이 같은 등록 펜으로 매칭된다
 * (2026-08-17 실사고: 슬롯 두 곳이 모두 같은 학생으로 표시됨).
 *
 * 학생을 잘못 붙이면 그 학생 필기 기록에 **남의 필기가 저장된다.** 되돌리기
 * 어려운 오염이라, 애매하면 차라리 "못 찾음" 으로 두고 사람이 정하게 한다.
 */

/** 구분자·대소문자를 지운 MAC (16진수만) */
export function looseMac(mac: string): string {
  return mac.toLowerCase().replace(/[^0-9a-f]/g, '');
}

/**
 * MAC 이 겹치는 등록들 — 0개면 문제 없음, 2개 이상이면 **사람이 정리해야 한다.**
 *
 * 2026-08-17 실사고: 같은 펜이 세 선생님 계정에 등록돼 있어 크래들 업로드가
 * 학생을 못 정하고 조용히 PC 폴더에만 저장했다. 사용자에게는 "업로드했는데
 * 필기가 안 보인다" 로 보였다. 그래서 **모호함을 값으로 돌려준다** — 화면이
 * 로그 한 줄이 아니라 경고로 띄울 수 있어야 한다.
 */
export function ambiguousPens<T extends { mac: string }>(
  pens: readonly T[],
  mac: string,
): T[] {
  const k = looseMac(mac);
  if (!k) return [];
  const exact = pens.filter((p) => looseMac(p.mac) === k);
  return exact.length > 1 ? exact : [];
}

export function findPenByMac<T extends { mac: string; teacherId?: string }>(
  pens: readonly T[],
  mac: string,
  /**
   * 로그인한 선생님 id. 같은 MAC 이 여러 계정에 등록돼 있으면 **내 등록을
   * 고른다** — 학원 공유 구조라 남의 등록까지 보이는 게 정상이고, 그중 내
   * 것이 있으면 그게 답이다. 그래도 못 가리면 여전히 undefined.
   */
  preferTeacherId?: string,
): T | undefined {
  const k = looseMac(mac);
  if (!k) return undefined;

  const exact = pens.filter((p) => looseMac(p.mac) === k);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    const mine = exact.filter((p) => p.teacherId && p.teacherId === preferTeacherId);
    return mine.length === 1 ? mine[0] : undefined;
  }

  // 뒷자리 매칭은 **충분히 길고 유일할 때만** 인정한다.
  // 6자리(24비트) 미만은 우연히 겹칠 수 있어 아예 쓰지 않는다.
  if (k.length < 6) return undefined;
  const partial = pens.filter((p) => {
    const key = looseMac(p.mac);
    return key.length >= 6 && (key.endsWith(k) || k.endsWith(key));
  });
  return partial.length === 1 ? partial[0] : undefined;
}
