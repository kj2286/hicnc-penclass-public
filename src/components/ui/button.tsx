/**
 * Thin adapter over SEED ActionButton keeping the shadcn-style API the ported
 * pen screens already use (`variant="outline" size="sm"`), so every button in
 * the app renders 100% seed styling from one place.
 */
import * as React from 'react';
import { ActionButton } from 'seed-design/ui/action-button';
import { cn } from '@/lib/utils';

type LegacyVariant =
  | 'default'
  | 'destructive'
  | 'outline'
  | 'secondary'
  | 'ghost'
  | 'link'
  | 'success';
type LegacySize = 'default' | 'sm' | 'lg' | 'icon';

const VARIANT_MAP = {
  default: 'brandSolid',
  destructive: 'criticalSolid',
  outline: 'neutralOutline',
  secondary: 'neutralWeak',
  ghost: 'ghost',
  link: 'ghost',
  success: 'neutralSolid',
} as const;

const SIZE_MAP = {
  default: 'medium',
  sm: 'small',
  lg: 'large',
  icon: 'small',
} as const;

export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'color'> {
  variant?: LegacyVariant;
  size?: LegacySize;
  loading?: boolean;
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'default', size = 'default', className, ...props }, ref) => (
    <ActionButton
      ref={ref}
      variant={VARIANT_MAP[variant]}
      size={SIZE_MAP[size]}
      className={cn(
        size === 'icon' && 'aspect-square !px-0 w-9 justify-center',
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = 'Button';
