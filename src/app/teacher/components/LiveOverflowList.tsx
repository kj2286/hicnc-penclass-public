/**
 * 실시간 화면 정원을 넘어 캔버스를 그리지 않는 참가자 목록.
 *
 * 정원 제한이 "안 보임"이 되지 않게 하는 장치 — 누가 접속해 있는지는 여기서
 * 계속 보이고, [보기] 를 누르면 화면 자리를 받아 캔버스가 그려진다.
 * (규칙은 src/lib/live-capacity.ts)
 */
import { ActionButton } from 'seed-design/ui/action-button';

export interface LiveOverflowItem {
  key: string;
  /** 화면에 보일 이름 (학생 이름 또는 펜 이름) */
  name: string;
  /** 보조 설명 — 마지막 활동 시각 등 */
  detail?: string;
}

export function LiveOverflowList({
  items,
  onShow,
}: {
  items: LiveOverflowItem[];
  /** [보기] — 이 참가자를 화면에 고정한다 */
  onShow: (key: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-xl border border-line-weak bg-layer-default">
      <div className="border-b border-line-weak px-4 py-2.5 text-xs font-semibold text-ink-subtle">
        화면에 없는 참가자 {items.length}명 — 필기는 정상 저장 중입니다
      </div>
      <ul className="divide-y divide-line-weak">
        {items.map((it) => (
          <li key={it.key} className="flex items-center gap-3 px-4 py-2.5">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-solid"
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-ink">
                {it.name}
              </div>
              {it.detail && (
                <div className="truncate text-xs text-ink-subtle">
                  {it.detail}
                </div>
              )}
            </div>
            <ActionButton
              variant="neutralOutline"
              size="small"
              onClick={() => onShow(it.key)}
            >
              보기
            </ActionButton>
          </li>
        ))}
      </ul>
    </div>
  );
}
