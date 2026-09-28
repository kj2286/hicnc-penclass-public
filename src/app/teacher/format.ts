/** 선생님 포털 공용 포맷터/상수. */
import { kstLongDate } from '@/lib/kst';
import type { PenPlan } from '@/lib/api';

export const PLAN_PRICE: Record<PenPlan, number> = {
  none: 0,
  basic_3900: 3900,
  plus_4900: 4900,
};

/** 짧은 플랜 이름 (Badge 등 좁은 곳용) */
export const PLAN_SHORT_LABEL: Record<PenPlan, string> = {
  none: '구독 없음',
  basic_3900: '베이직',
  plus_4900: '플러스',
};

export function formatWon(n: number): string {
  return `${n.toLocaleString('ko-KR')}원`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  // **한국 시간 고정** — toLocaleDateString 은 보는 사람의 PC 시간대를 따른다
  return kstLongDate(d.getTime());
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "방금 전 / n분 전 / n시간 전 / 날짜" 상대 시각 */
export function formatRelative(ts: number | string | null | undefined): string {
  if (ts == null) return '-';
  const t = typeof ts === 'string' ? new Date(ts).getTime() : ts;
  if (!Number.isFinite(t)) return '-';
  const diff = Date.now() - t;
  if (diff < 30_000) return '방금 전';
  if (diff < 60_000) return '1분 전';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  return formatDate(new Date(t).toISOString());
}

/** ms → "m:ss" (재생 타임라인용) */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 구독 시작일 + 1개월 = 다음 결제 예정일 */
export function nextBillingDate(startedAtIso: string): Date {
  const d = new Date(startedAtIso);
  d.setMonth(d.getMonth() + 1);
  return d;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
