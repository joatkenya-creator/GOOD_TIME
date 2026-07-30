import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/utils/cn';

const cardVariants = cva('rounded-xl bg-surface', {
  variants: {
    variant: {
      /** Default surface: a hairline border, no shadow. Calm. */
      outline: 'border border-border',
      /** Lifts on hover — for anything clickable, like a product card. */
      interactive:
        'border border-border shadow-xs transition-shadow duration-(--duration-base) ease-(--ease-brand) hover:shadow-md',
      elevated: 'shadow-md',
      muted: 'bg-surface-muted',
      ghost: '',
    },
    padding: {
      none: '',
      sm: 'p-4',
      md: 'p-6',
      lg: 'p-8',
    },
  },
  defaultVariants: { variant: 'outline', padding: 'md' },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardVariants> {}

export function Card({ className, variant, padding, ...props }: CardProps) {
  return <div className={cn(cardVariants({ variant, padding }), className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mb-5 space-y-1.5', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn('font-display text-xl leading-tight tracking-tight text-foreground', className)}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn('text-sm leading-relaxed text-foreground-muted', className)} {...props} />
  );
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('text-sm text-foreground', className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-6 flex items-center gap-3', className)} {...props} />;
}

export { cardVariants };
