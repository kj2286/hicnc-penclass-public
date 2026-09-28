/**
 * 시간 길이 표기 — **시·분·초** (사용자 요구 2026-08-25).
 * 화면 어디서나 같은 문장으로 보이게 한 곳에 모은다. 예전에는 파일마다
 * 제각각이라 "4021.9초" 나 "67분" 이 섞여 나왔다.
 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}초`;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return s > 0 ? `${h}시간 ${m}분 ${s}초` : `${h}시간 ${m}분`;
  return s > 0 ? `${m}분 ${s}초` : `${m}분`;
}

/** 재생 위치(시각) — 0:34 / 1:05:20 */
export function formatTimecode(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/**
 * 글 속의 **초 표기를 시·분·초로 바꾼다** (사용자 요구, 여러 차례 2026-08-25~27).
 *
 * 시간을 만들어 내는 코드는 이미 `formatDuration` 을 쓰지만, **AI 가 쓴 문장**과
 * **예전에 캐시된 글**에는 "180초", "2601.9초" 가 그대로 남아 있다. 그래서
 * 화면에 그릴 때 한 번 더 걸러 낸다 — 이게 마지막 방어선이다.
 *
 * 60초 미만은 건드리지 않는다("8초 이상 손을 뗀" 같은 설명이 깨지면 안 된다).
 * 수식 안($…$)은 손대지 않는다.
 */
export function humanizeSeconds(text: string): string {
  if (!text) return text;
  const convert = (chunk: string) =>
    chunk.replace(/(\d+(?:\.\d+)?)\s*초/g, (m, num: string) => {
      const sec = Number(num);
      if (!Number.isFinite(sec) || sec < 60) return m;
      return formatDuration(sec * 1000);
    });
  // $…$ 로 감싼 수식은 그대로 둔다
  return text
    .split(/(\$[^$]*\$)/g)
    .map((part) => (part.startsWith('$') && part.endsWith('$') ? part : convert(part)))
    .join('');
}
