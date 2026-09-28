/** Adapter over SEED Switch keeping the Radix-style API used by ported code. */
import * as React from 'react';
import { Switch as SeedSwitch } from 'seed-design/ui/switch';

export interface SwitchProps {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  'aria-label'?: string;
}

export const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ checked, onCheckedChange, ...props }, ref) => (
    <SeedSwitch
      ref={ref}
      checked={checked}
      onChange={(e) => {
        const input = e.target as unknown as HTMLInputElement;
        onCheckedChange?.(Boolean(input.checked));
      }}
      {...props}
    />
  ),
);
Switch.displayName = 'Switch';
