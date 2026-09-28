/** Adapter over SEED Badge keeping the shadcn-style `variant` API. */
import * as React from 'react';
import { Badge as SeedBadge } from '@seed-design/react';

type LegacyVariant =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline'
  | 'success'
  | 'warning';

const MAP: Record<
  LegacyVariant,
  { variant: 'weak' | 'solid' | 'outline'; tone: 'neutral' | 'brand' | 'critical' | 'positive' | 'warning' }
> = {
  default: { variant: 'solid', tone: 'brand' },
  secondary: { variant: 'weak', tone: 'neutral' },
  destructive: { variant: 'solid', tone: 'critical' },
  outline: { variant: 'outline', tone: 'neutral' },
  success: { variant: 'weak', tone: 'positive' },
  warning: { variant: 'weak', tone: 'warning' },
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: LegacyVariant;
}

export function Badge({ variant = 'default', ...props }: BadgeProps) {
  const mapped = MAP[variant];
  return (
    <SeedBadge
      size="medium"
      variant={mapped.variant}
      tone={mapped.tone}
      {...props}
    />
  );
}
