import { Switch } from '@/components/ui/switch';
import { useNoiseFilterStore } from '@/store/noise-filter.store';

/**
 * On/off switch for the SDK dot noise filter. OFF (default) draws raw dots
 * losslessly — fixes fast-handwriting strokes breaking up / disappearing. ON
 * re-enables the SDK's jitter smoothing. Applies live to connected pens.
 */
export function NoiseFilterToggle() {
  const enabled = useNoiseFilterStore((s) => s.enabled);
  const setEnabled = useNoiseFilterStore((s) => s.setEnabled);

  return (
    <label
      className="flex cursor-pointer select-none items-center gap-2 text-sm text-muted-foreground"
      title="펜 SDK 노이즈 필터. 켜면 지그재그 점을 제거해 획을 부드럽게 만들지만, 빠른 필기·급커브·짧은 획에서 정상 점까지 지워질 수 있습니다. 끄면 원본 점을 손실 없이 그립니다."
    >
      <span>노이즈 제거</span>
      <Switch
        checked={enabled}
        onCheckedChange={setEnabled}
        aria-label="펜 스트로크 노이즈 제거 토글"
      />
    </label>
  );
}
