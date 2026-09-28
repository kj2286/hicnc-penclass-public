/**
 * **난이도 10단계** — 리포트의 난이도 막대그래프 (사용자 요구 2026-08-25).
 *
 * 두 축을 나눠 본다:
 *  - **문제 난이도**: 문항 자체가 어려운가 (AI 가 지문·풀이를 보고 매긴 4단계).
 *  - **체감 난이도**: *이 학생이* 어렵게 느꼈는가 (펜 데이터 — 시도·복귀·시간·정오).
 * 같은 문제라도 학생마다 체감이 다르므로, 평균과 견줘야 의미가 산다.
 *
 * 구간(사용자 지정): 쉬움 1~2 · 보통 3~5 · 어려움 6~7 · 매우 어려움 8~10.
 * 화면에는 숫자 대신 이 네 라벨만 쓴다 (사용자 2026-09-02).
 */
import type { ReportDifficulty } from './learn-report';

export type DifficultyBand = '쉬움' | '보통' | '어려움' | '매우 어려움';

/** 막대 색 — 쉬움 노랑 / 보통 녹색 / 어려움 빨강 / 매우 어려움 검정 */
export const BAND_COLOR: Record<DifficultyBand, string> = {
  쉬움: '#f5a524',
  보통: '#1a7f37',
  어려움: '#e03131',
  '매우 어려움': '#19191c',
};

export function difficultyBand(n: number): DifficultyBand {
  if (n <= 2) return '쉬움';
  if (n <= 5) return '보통';
  if (n <= 7) return '어려움';
  return '매우 어려움';
}

const clamp10 = (n: number) => Math.max(1, Math.min(10, Math.round(n)));

/** AI 가 매긴 4단계 → 10단계 대표값 */
export function problemDifficulty10(d: ReportDifficulty | undefined): number {
  switch (d) {
    case '쉬움':
      return 2;
    case '어려움':
      return 7;
    case '매우 어려움':
      return 9;
    default:
      return 4; // 보통
  }
}

export type PerceivedInput = {
  verdict: 'correct' | 'wrong' | 'unknown';
  attempts: number;
  revisits: number;
  activeMs: number;
};

/**
 * **체감 난이도** — 펜 데이터로만 매긴다(추측 없음). 근거를 화면에 그대로 적을 수
 * 있도록 규칙을 단순하게 둔다.
 *
 *  - 시작점: 맞음 3 / 판정 불가·안 풂 5 / 틀림 7
 *  - 시도 2~3회 +1, 4회 이상 +2   (헤맨 만큼 어렵게 느낀 것)
 *  - 다른 문제 풀다 돌아왔으면 +1
 *  - 이 문제지의 **중앙값보다 2배 이상** 오래 걸렸으면 +1
 *  - 손도 못 댄 문항(활동 0)은 9 — 읽고 넘겼다는 뜻이다
 */
export function perceivedDifficulty10(
  p: PerceivedInput,
  ctx: { medianActiveMs: number },
): number {
  if (p.activeMs <= 0 && p.attempts <= 0) return 9;
  let n = p.verdict === 'correct' ? 3 : p.verdict === 'wrong' ? 7 : 5;
  if (p.attempts >= 4) n += 2;
  else if (p.attempts >= 2) n += 1;
  if (p.revisits > 0) n += 1;
  if (ctx.medianActiveMs > 0 && p.activeMs >= ctx.medianActiveMs * 2) n += 1;
  return clamp10(n);
}

/** 체감 난이도 계산의 기준값 — 그 문제지 안에서의 활동 시간 중앙값 */
export function medianActiveMs(list: ReadonlyArray<{ activeMs: number }>): number {
  const v = list.map((x) => x.activeMs).filter((x) => x > 0).sort((a, b) => a - b);
  if (v.length === 0) return 0;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

/** 화면 툴팁에 그대로 쓰는 근거 문장 */
export function perceivedWhy(
  p: PerceivedInput,
  ctx: { medianActiveMs: number },
): string {
  if (p.activeMs <= 0 && p.attempts <= 0) return '손대지 않은 문항 → 9';
  const parts = [
    p.verdict === 'correct' ? '맞음 3' : p.verdict === 'wrong' ? '틀림 7' : '판정 불가 5',
  ];
  if (p.attempts >= 4) parts.push(`시도 ${p.attempts}회 +2`);
  else if (p.attempts >= 2) parts.push(`시도 ${p.attempts}회 +1`);
  if (p.revisits > 0) parts.push(`복귀 ${p.revisits}회 +1`);
  if (ctx.medianActiveMs > 0 && p.activeMs >= ctx.medianActiveMs * 2)
    parts.push('중앙값의 2배 이상 소요 +1');
  return `${parts.join(' / ')} → ${perceivedDifficulty10(p, ctx)}`;
}

/**
 * **정오 확정** — 정답이 아니면 무조건 틀림 (사용자 지시 2026-08-26).
 *
 * 예전에는 채점이 답을 읽지 못하면 `unknown`(판정 불가)으로 남겨 화면에 "—" 가
 * 떴다. 실제로 박다민A 3단계-8번은 **11번 시도·3분 필기**인데도 판정 불가였다.
 * 선생님 입장에서 "채점 결과가 없는 문항" 은 있을 수 없다 — 정답이 아니거나
 * 답이 없으면 틀린 것이다.
 *
 * 손도 대지 않은 문항은 `안 풂` 으로 **표시만** 구분하고, 정오는 똑같이 틀림이다.
 */
export function finalVerdict(v: string | undefined): 'correct' | 'wrong' {
  return v === 'correct' ? 'correct' : 'wrong';
}
