import { cn } from '@/utils/cn';

const SIZES = {
  sm: 'size-4 border-2',
  md: 'size-5 border-2',
  lg: 'size-8 border-[3px]',
} as const;

export interface SpinnerProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: keyof typeof SIZES;
  /** Announced to screen readers. Set to null inside a button that already has a label. */
  label?: string | null;
}

/** Indeterminate loading indicator. CSS-only — no animation library involved. */
export function Spinner({ size = 'md', label = 'Loading', className, ...props }: SpinnerProps) {
  return (
    <span
      role={label ? 'status' : undefined}
      aria-live={label ? 'polite' : undefined}
      className={cn('inline-flex items-center', className)}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn('animate-spin rounded-full border-current border-r-transparent', SIZES[size])}
      />
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}
