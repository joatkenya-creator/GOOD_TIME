'use client';

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { MediaPlaceholder } from '@/components/common/media-placeholder';
import type { CartView } from '@/services/cart.service';
import { formatPrice } from '@/utils/format';
import { cn } from '@/utils/cn';

/**
 * Order summary beside the checkout form.
 *
 * Read-only. Quantity steppers and a remove button here invite second-guessing
 * at the exact moment you want none — anyone who wants to change the order has a
 * "back to bag" link two inches away.
 *
 * Collapsed on mobile with the total always visible: a full item list above the
 * form pushes the first input below the fold on a phone.
 */
export function CartSummaryPanel({ cart }: { cart: CartView }) {
  const [open, setOpen] = useState(false);
  const { totals } = cart;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="order-summary-items"
        className="flex min-h-14 w-full items-center justify-between gap-3 px-5 py-4 text-left lg:pointer-events-none"
      >
        <span className="flex items-center gap-2 text-body-sm font-medium text-foreground">
          Order summary
          <ChevronDown
            aria-hidden="true"
            className={cn('size-4 transition-transform lg:hidden', open && 'rotate-180')}
          />
        </span>

        <span className="text-h5 font-bold tabular-nums text-foreground">
          {formatPrice(totals.totalCents)}
        </span>
      </button>

      <div
        id="order-summary-items"
        className={cn('border-t border-border px-5 py-4', !open && 'hidden lg:block')}
      >
        <ul className="space-y-3">
          {cart.lines.map((line) => (
            <li key={line.id} className="flex items-start gap-3">
              <div className="relative shrink-0">
                <MediaPlaceholder seed={line.imageSeed} ratio="square" className="size-14 rounded-lg" />
                <span className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-[0.625rem] font-semibold text-surface">
                  {line.quantity}
                  <span className="sr-only"> of this item</span>
                </span>
              </div>

              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-body-sm font-medium text-foreground">
                  {line.productName}
                </p>
                <p className="text-body-xs text-foreground-subtle">{line.variantName}</p>
              </div>

              <span className="shrink-0 text-body-sm tabular-nums text-foreground">
                {formatPrice(line.lineTotalCents)}
              </span>
            </li>
          ))}
        </ul>

        <dl className="mt-5 space-y-2 border-t border-border pt-4 text-body-sm">
          <Row label="Subtotal">{formatPrice(totals.subtotalCents)}</Row>

          {totals.discountCents > 0 ? (
            <Row label={`Discount${cart.couponCode ? ` · ${cart.couponCode}` : ''}`} accent>
              −{formatPrice(totals.discountCents)}
            </Row>
          ) : null}

          <Row label="Shipping">
            {totals.shippingCents === 0 ? 'Free' : formatPrice(totals.shippingCents)}
          </Row>

          <Row label={totals.taxBreakdown.length ? 'Sales tax' : 'Sales tax (added at review)'}>
            {totals.taxBreakdown.length ? formatPrice(totals.taxCents) : '—'}
          </Row>

          <div className="flex items-baseline justify-between border-t border-border pt-3">
            <dt className="text-body font-semibold text-foreground">Total</dt>
            <dd className="text-h5 font-bold tabular-nums text-foreground">
              {formatPrice(totals.totalCents)}
            </dd>
          </div>
        </dl>

        {cart.giftNote ? (
          <p className="mt-4 rounded-lg bg-surface-muted p-3 text-body-xs text-foreground-muted">
            <span className="font-medium text-foreground">Gift note:</span> {cart.giftNote}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Row({
  label,
  children,
  accent,
}: {
  label: string;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-foreground-muted">{label}</dt>
      <dd className={cn('tabular-nums', accent ? 'font-medium text-accent-text' : 'text-foreground')}>
        {children}
      </dd>
    </div>
  );
}
