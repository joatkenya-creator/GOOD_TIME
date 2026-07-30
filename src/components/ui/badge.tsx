import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/utils/cn';

/**
 * Badge — merchandising flags ("New", "Best seller", "Low stock") and status
 * pills in the admin. Deliberately small and quiet; a grid full of shouting
 * badges reads as a discount site, not a premium one.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap [&_svg]:size-3',
  {
    variants: {
      variant: {
        neutral: 'bg-surface-muted text-foreground-muted',
        accent: 'bg-accent-soft text-brand-700',
        solid: 'bg-accent text-white',
        outline: 'border border-border-strong text-foreground-muted',
        success: 'bg-success-50 text-success-700',
        warning: 'bg-warning-50 text-warning-700',
        danger: 'bg-danger-50 text-danger-700',
        info: 'bg-info-50 text-info-700',
      },
      size: {
        sm: 'px-2 py-0.5 text-[0.6875rem]',
        md: 'px-2.5 py-1 text-xs',
      },
      uppercase: {
        true: 'text-eyebrow uppercase',
      },
    },
    defaultVariants: { variant: 'neutral', size: 'md' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, size, uppercase, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size, uppercase }), className)} {...props} />;
}

export { badgeVariants };
