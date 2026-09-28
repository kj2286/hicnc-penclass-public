/**
 * 펜 번호 로컬 폴백 — supabase/011_pen_number.sql 적용 전(pen_number 칼럼 없음)에도
 * 등록한 번호가 이 브라우저에서 유지되도록 localStorage 에 보관한다.
 * DB 값(pen_number)이 있으면 항상 DB 가 우선.
 */
const KEY = 'pc_pen_numbers_v1';

function keyOf(mac: string): string {
  return mac.toLowerCase().replace(/[^0-9a-f]/g, '');
}

export function localPenNumbers(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<
      string,
      number
    >;
  } catch {
    return {};
  }
}

export function rememberPenNumber(mac: string, n: number): void {
  try {
    const map = localPenNumbers();
    map[keyOf(mac)] = n;
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* 저장 실패는 무해 — 다음 등록 때 다시 시도 */
  }
}

export function localPenNumberOf(mac: string): number | null {
  return localPenNumbers()[keyOf(mac)] ?? null;
}
