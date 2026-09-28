/**
 * Range slider keeping the Radix Slider array-value API used by ported code,
 * rendered as a native input styled with SEED tokens (reliable across
 * pointer/touch without extra deps).
 */
import * as React from 'react';
import { cn } from '@/lib/utils';

export interface SliderProps {
  value: number[];
  onValueChange?: (value: number[]) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}

export const Slider = React.forwardRef<HTMLInputElement, SliderProps>(
  (
    { value, onValueChange, min = 0, max = 100, step = 1, disabled, className, ...rest },
    ref,
  ) => (
    <input
      ref={ref}
      type="range"
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      value={value[0] ?? 0}
      onChange={(e) => onValueChange?.([Number(e.currentTarget.value)])}
      className={cn('seed-range w-full', className)}
      {...rest}
    />
  ),
);
Slider.displayName = 'Slider';
