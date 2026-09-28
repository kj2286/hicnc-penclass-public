/**
 * **한국 시간(KST) 고정 날짜 계산.**
 *
 * 사용자 요구(2026-08-17): "한국기준으로 날짜는 다 맞춰줘야돼. 모든 계정 동일하게."
 *
 * 브라우저 로컬 시간(`getFullYear` 등)을 쓰면 **보는 사람의 PC 시간대에 따라 같은
 * 필기가 다른 날짜로 보인다.** 학원은 한국에 있고 문서의 날짜는 학원 기준이어야
 * 하므로, 어느 계정에서 열어도 같은 답이 나오게 KST 로 고정한다.
 *
 * KST 는 **서머타임이 없다**(1988년 이후). 그래서 UTC+9 고정 오프셋이 정확하다 —
 * `toLocaleString('ko-KR', {timeZone})` 같은 파싱보다 싸고 결과가 흔들리지 않는다.
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** KST 로 옮긴 시각 — 반드시 `getUTC*` 로만 읽어야 한다. */
function shifted(ms: number): Date {
  return new Date(ms + KST_OFFSET_MS);
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** `2026-08-17` — 문서의 하루 키. 저장·조회가 같은 값을 써야 한다. */
export function kstDateKey(ms: number): string {
  const d = shifted(ms);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}

/** `2026.8.17` — 목록 그룹 제목용(0 을 채우지 않는다). */
export function kstDayLabel(key: string): string {
  const [y, m, d] = key.split('-');
  return `${y}.${Number(m)}.${Number(d)}`;
}

/** `8월 17일` — 문서 제목에 쓰는 표기. */
export function kstMonthDay(ms: number): string {
  const d = shifted(ms);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
}

/** `26.08.17 15:33` — 줄마다 붙는 시각. 빈 입력이면 빈 문자열. */
export function kstStamp(iso: string | number | null | undefined): string {
  if (iso == null) return '';
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = shifted(t);
  return (
    `${p2(d.getUTCFullYear() % 100)}.${p2(d.getUTCMonth() + 1)}.${p2(d.getUTCDate())}` +
    ` ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`
  );
}

/** `2026년 8월 17일` — 사람이 읽는 긴 표기. */
export function kstLongDate(ms: number): string {
  const d = shifted(ms);
  return `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
}

/** `8월 17일 (월)` — 요일까지. 받은함 날짜 머리글용. */
export function kstDayWithWeekday(ms: number): string {
  const d = shifted(ms);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${'일월화수목금토'[d.getUTCDay()]})`;
}

/** `26.08.19` — 짧은 날짜(연 2자리). ISO 를 그대로 slice 하면 UTC 날짜가 나온다
 *  (실사고 2026-08-18: 리포트 생성일이 한국 자정 이후 전날로 표시). */
export function kstShortDate(iso: string | number): string {
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = shifted(t);
  return `${p2(d.getUTCFullYear() % 100)}.${p2(d.getUTCMonth() + 1)}.${p2(d.getUTCDate())}`;
}
