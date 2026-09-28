/** Plain input styled with SEED tokens; API-compatible with the old kit. */
import * as React from 'react';
import { cn } from '@/lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'flex h-10 w-full rounded-lg border border-line-weak bg-layer-default px-3 text-sm text-ink',
        'placeholder:text-placeholder',
        'focus:outline-none focus:ring-2 focus:ring-focus-ring focus:border-line-brand',
        'disabled:cursor-not-allowed disabled:bg-bg-disabled disabled:text-fg-disabled',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
