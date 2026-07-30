import { cn } from '@/utils/cn';
import { formatPrice, formatPriceRange } from '@/utils/format';

export interface PriceProps extends React.HTMLAttributes<HTMLParagraphElement> {
  /** Current price in minor units (cents). Never a float. */
  cents: number;
  /** Was-price for the strike-through. Ignored when it is not actually higher. */
  compareAtCents?: number | null;
  /** Upper bound for a variant price range ("$29 – $49"). */
  maxCents?: number | null;
  currency?: string;
  size?: 'sm' | 'md' | 'lg';
  /** Shows the saving as a percentage next to the price. */
  showDiscount?: boolean;
}

const SIZES = {
  sm: { current: 'text-sm', compare: 'text-xs' },
  md: { current: 'text-base', compare: 'text-sm' },
  lg: { current: 'text-2xl', compare: 'text-base' },
} as const;

/**
 * Price display.
 *
 * The only component allowed to turn cents into a currency string, so rounding
 * and locale behave identically in a product grid, the cart and an order summary.
 *
 * The was-price is wrapped in `<s>` and given a screen-reader label, because
 * a strike-through alone communicates nothing to a non-visual user.
 */
export function Price({
  cents,
  compareAtCents,
  maxCents,
  currency,
  size = 'md',
  showDiscount = false,
  className,
  ...props
}: PriceProps) {
  const styles = SIZES[size];
  const onSale = typeof compareAtCents === 'number' && compareAtCents > cents;
  const discount = onSale ? Math.round(((compareAtCents - cents) / compareAtCents) * 100) : 0;

  return (
    <p className={cn('flex flex-wrap items-baseline gap-x-2 gap-y-1', className)} {...props}>
      <span className={cn('font-semibold tracking-tight text-foreground', styles.current)}>
        {typeof maxCents === 'number' && maxCents !== cents
          ? formatPriceRange(cents, maxCents, currency)
          : formatPrice(cents, currency)}
      </span>

      {onSale ? (
        <>
          <s className={cn('text-foreground-subtle', styles.compare)}>
            <span className="sr-only">Regular price </span>
            {formatPrice(compareAtCents, currency)}
          </s>
          {showDiscount ? (
            <span className={cn('font-semibold text-accent-text', styles.compare)}>
              Save {discount}%
            </span>
          ) : null}
        </>
      ) : null}
    </p>
  );
}
