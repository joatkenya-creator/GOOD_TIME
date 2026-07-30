import { cn } from '@/utils/cn';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Match the shape of the content being loaded. */
  shape?: 'block' | 'text' | 'circle';
}

/**
 * Skeleton placeholder.
 *
 * `aria-hidden` is deliberate: the surrounding region carries `aria-busy`, so
 * announcing a dozen empty boxes to a screen reader would be noise.
 */
export function Skeleton({ className, shape = 'block', ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-shimmer relative overflow-hidden bg-surface-muted',
        shape === 'block' && 'rounded-lg',
        shape === 'text' && 'h-4 rounded-sm',
        shape === 'circle' && 'rounded-full',
        className,
      )}
      {...props}
    />
  );
}

/** Multi-line text placeholder with a ragged last line, so it reads as prose. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} shape="text" className={index === lines - 1 ? 'w-3/5' : 'w-full'} />
      ))}
    </div>
  );
}
