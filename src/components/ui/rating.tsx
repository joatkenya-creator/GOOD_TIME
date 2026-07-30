import { Star } from 'lucide-react';

import { cn } from '@/utils/cn';
import { formatCompactNumber } from '@/utils/format';

export interface RatingProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 0–5, fractional values render a partial star. */
  value: number;
  count?: number;
  size?: 'sm' | 'md' | 'lg';
  /** Hides the numeric count, leaving stars only. */
  hideCount?: boolean;
}

const SIZES = { sm: 'size-3.5', md: 'size-4', lg: 'size-5' } as const;

/**
 * Star rating.
 *
 * The stars are `aria-hidden` and the real value is exposed as text, so a screen
 * reader announces "Rated 4.5 out of 5" rather than five ambiguous icons.
 *
 * Partial stars are drawn by clipping a filled layer over an outline layer —
 * no half-star icon set required.
 */
export function Rating({
  value,
  count,
  size = 'md',
  hideCount = false,
  className,
  ...props
}: RatingProps) {
  const clamped = Math.max(0, Math.min(5, value));
  const iconSize = SIZES[size];

  return (
    <div className={cn('flex items-center gap-2', className)} {...props}>
      <span className="relative inline-flex" aria-hidden="true">
        <span className="flex gap-0.5 text-ink-300">
          {Array.from({ length: 5 }, (_, index) => (
            <Star key={index} className={iconSize} strokeWidth={1.5} />
          ))}
        </span>

        <span
          className="absolute inset-0 flex gap-0.5 overflow-hidden text-warning-500"
          style={{ width: `${(clamped / 5) * 100}%` }}
        >
          {Array.from({ length: 5 }, (_, index) => (
            <Star key={index} className={iconSize} strokeWidth={1.5} fill="currentColor" />
          ))}
        </span>
      </span>

      <span className="sr-only">Rated {clamped.toFixed(1)} out of 5</span>

      {!hideCount && count !== undefined ? (
        <span className="text-sm text-foreground-muted">
          <span aria-hidden="true">{clamped.toFixed(1)}</span>{' '}
          <span className="text-foreground-subtle">({formatCompactNumber(count)})</span>
        </span>
      ) : null}
    </div>
  );
}
