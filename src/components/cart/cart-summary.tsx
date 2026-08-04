'use client';

import { Gift, Lock, Tag, Truck, X } from 'lucide-react';
import Link from 'next/link';
import { useState, useTransition } from 'react';

import { RedemptionPanel } from '@/components/cart/redemption-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { ROUTES } from '@/constants/routes';
import { US_STATES } from '@/features/checkout/schemas';
import {
  applyCouponAction,
  applyGiftCardAction,
  removeCouponAction,
  removeGiftCardAction,
  setEstimateAction,
  setGiftNoteAction,
} from '@/server/actions/cart';
import type { CartView } from '@/services/cart.service';
import { formatPrice } from '@/utils/format';

/**
 * Order summary, promo code, estimate and gift note.
 *
 * The total is never hidden behind a step. Unexpected shipping and tax at the
 * last screen is the single most cited reason for cart abandonment, so the
 * estimator sits here — before checkout — and says plainly when a number is an
 * estimate rather than a charge.
 */
export function CartSummary({ cart }: { cart: CartView }) {
  const { totals } = cart;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="text-body-lg font-semibold text-foreground">Order summary</h2>

        <dl className="mt-4 space-y-2.5 text-body-sm">
          <Row label={`Subtotal (${totals.itemCount} ${totals.itemCount === 1 ? 'item' : 'items'})`}>
            {formatPrice(totals.subtotalCents)}
          </Row>

          {totals.discountCents > 0 ? (
            <Row label={`Discount${cart.couponCode ? ` · ${cart.couponCode}` : ''}` } accent>
              −{formatPrice(totals.discountCents)}
            </Row>
          ) : null}

          <Row label={cart.shipping.label}>
            {totals.shippingCents === 0 ? 'Free' : formatPrice(totals.shippingCents)}
          </Row>

          {/* An empty breakdown means no jurisdiction is configured for the
              destination, which is different from a 0% rate — say so. */}
          <Row label={totals.taxBreakdown.length ? 'Sales tax' : 'Sales tax (estimated at checkout)'}>
            {totals.taxBreakdown.length ? formatPrice(totals.taxCents) : '—'}
          </Row>

          {totals.taxBreakdown.length > 1 ? (
            <ul className="ml-1 space-y-1 border-l border-border pl-3 text-body-xs text-foreground-subtle">
              {totals.taxBreakdown.map((entry) => (
                <li key={entry.label} className="flex justify-between gap-2">
                  <span>
                    {entry.label} ({(entry.rateBasisPoints / 100).toFixed(2)}%)
                  </span>
                  <span className="tabular-nums">{formatPrice(entry.amountCents)}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="border-t border-border pt-3">
            <Row label="Total" large>
              {formatPrice(totals.totalCents)}
            </Row>
          </div>

          {/* Loyalty is shown below the total, not inside it. Credit and points
              are tender against a bill that was already taxed in full — folding
              them into the total would imply they reduced the taxable base. */}
          {cart.redemption.totalCents > 0 ? (
            <>
              <Row label="Rewards applied" accent>
                −{formatPrice(cart.redemption.totalCents)}
              </Row>
              <div className="border-t border-border pt-3">
                <Row label="To pay" large>
                  {formatPrice(cart.redemption.amountDueCents)}
                </Row>
              </div>
            </>
          ) : null}
        </dl>

        <Button asChild size="lg" className="mt-5 w-full" disabled={cart.hasIssues}>
          <Link href={ROUTES.checkout}>
            <Lock aria-hidden="true" className="size-4" />
            Checkout securely
          </Link>
        </Button>

        {cart.hasIssues ? (
          <p role="alert" className="mt-2 text-body-xs text-(--color-error)">
            Adjust the quantities flagged above before checking out.
          </p>
        ) : null}

        <p className="mt-3 text-center text-body-xs text-foreground-subtle">
          Discreet billing · Plain packaging · Free returns within 30 days
        </p>
      </div>

      <RedemptionPanel redemption={cart.redemption} />
      <CouponForm code={cart.couponCode} message={cart.couponMessage} />
      <GiftCardForm applied={cart.giftCard} />
      <EstimateForm />
      <GiftNoteForm note={cart.giftNote} />
    </div>
  );
}

function Row({
  label,
  children,
  accent,
  large,
}: {
  label: string;
  children: React.ReactNode;
  accent?: boolean;
  large?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={large ? 'text-body font-semibold text-foreground' : 'text-foreground-muted'}>
        {label}
      </dt>
      <dd
        className={
          large
            ? 'text-h5 font-bold tabular-nums text-foreground'
            : accent
              ? 'font-medium tabular-nums text-accent-text'
              : 'tabular-nums text-foreground'
        }
      >
        {children}
      </dd>
    </div>
  );
}

function CouponForm({ code, message }: { code: string | null; message: string | null }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(message);
  const { toast } = useToast();

  if (code && !message) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent-subtle px-4 py-3">
        <span className="flex items-center gap-2 text-body-sm font-medium text-accent-text">
          <Tag aria-hidden="true" className="size-4" />
          {code} applied
        </span>

        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(() => void removeCouponAction())}
          aria-label={`Remove promo code ${code}`}
          className="flex size-8 items-center justify-center rounded-full text-accent-text hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await applyCouponAction(formData);
          setError(result.ok ? null : result.message);
          if (result.ok) toast({ variant: 'success', title: result.message });
        })
      }
      className="rounded-xl border border-border bg-surface p-4"
    >
      <label htmlFor="coupon-code" className="text-body-sm font-medium text-foreground">
        Promo code
      </label>

      <div className="mt-2 flex gap-2">
        <Input
          id="coupon-code"
          name="code"
          placeholder="Enter code"
          autoComplete="off"
          autoCapitalize="characters"
          className="flex-1 uppercase"
          {...(error ? { 'aria-invalid': true, 'aria-describedby': 'coupon-error' } : {})}
        />
        <Button type="submit" variant="secondary" isLoading={pending}>
          Apply
        </Button>
      </div>

      {error ? (
        <p id="coupon-error" role="alert" className="mt-2 text-body-xs text-(--color-error)">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/**
 * Gift card entry.
 *
 * Separate from the promo code on purpose. A discount and a gift card are
 * different things — one reduces what is owed, the other pays part of what is
 * owed — and a customer holding both should not have to guess which box takes
 * which. It also means the applied states read differently: "SAVE10 applied"
 * against "$25.00 from card ••••7K2P".
 */
function GiftCardForm({
  applied,
}: {
  applied: { last4: string; applicableCents: number } | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  if (applied) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent-subtle px-4 py-3">
        <span className="flex items-center gap-2 text-body-sm font-medium text-accent-text">
          <Gift aria-hidden="true" className="size-4" />
          {formatPrice(applied.applicableCents)} from card ••••{applied.last4}
        </span>

        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(() => void removeGiftCardAction())}
          aria-label={`Remove gift card ending ${applied.last4}`}
          className="flex size-8 items-center justify-center rounded-full text-accent-text hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await applyGiftCardAction(formData);
          setError(result.ok ? null : result.message);
          if (result.ok) toast({ variant: 'success', title: result.message });
        })
      }
      className="rounded-xl border border-border bg-surface p-4"
    >
      <label htmlFor="gift-card-code" className="text-body-sm font-medium text-foreground">
        Gift card
      </label>

      <div className="mt-2 flex gap-2">
        <Input
          id="gift-card-code"
          name="code"
          placeholder="GT-XXXX-XXXX-XXXX"
          autoComplete="off"
          autoCapitalize="characters"
          className="flex-1 uppercase"
          {...(error ? { 'aria-invalid': true, 'aria-describedby': 'gift-card-error' } : {})}
        />
        {/*
          "Redeem", not "Apply".

          The promo code button next to this one is already called Apply, and
          two buttons sharing an accessible name is two identical announcements
          for a screen-reader user with no way to tell which is which. It is
          also the more accurate verb: a code is applied, a card is redeemed.
        */}
        <Button type="submit" variant="secondary" isLoading={pending}>
          Redeem
        </Button>
      </div>

      {error ? (
        <p id="gift-card-error" role="alert" className="mt-2 text-body-xs text-(--color-error)">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/**
 * Pre-checkout shipping and tax estimate.
 *
 * State plus ZIP, not a full address: it is everything the tax table and the
 * shipping rates need, and asking for a street address before someone has
 * decided to buy is how you lose them.
 */
function EstimateForm() {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center gap-2 py-1 text-left text-body-sm font-medium text-foreground"
      >
        <Truck aria-hidden="true" className="size-4 text-foreground-subtle" />
        Estimate shipping &amp; tax
      </button>

      {open ? (
        <form
          action={(formData) =>
            startTransition(async () => {
              const result = await setEstimateAction(formData);
              toast({
                variant: result.ok ? 'success' : 'error',
                title: result.message,
              });
            })
          }
          className="mt-3 flex flex-wrap gap-2"
        >
          <Select name="state" aria-label="State" defaultValue="" className="min-w-36 flex-1">
            <option value="" disabled>
              State
            </option>
            {US_STATES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </Select>

          <Input
            name="postalCode"
            aria-label="ZIP code"
            placeholder="ZIP"
            inputMode="numeric"
            autoComplete="postal-code"
            className="w-24"
          />

          <Button type="submit" variant="secondary" isLoading={pending}>
            Update
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function GiftNoteForm({ note }: { note: string | null }) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(Boolean(note));
  const { toast } = useToast();

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center gap-2 py-1 text-left text-body-sm font-medium text-foreground"
      >
        <Gift aria-hidden="true" className="size-4 text-foreground-subtle" />
        {note ? 'Edit gift note' : 'Add a gift note'}
      </button>

      {open ? (
        <form
          action={(formData) =>
            startTransition(async () => {
              const result = await setGiftNoteAction(formData);
              toast({ variant: result.ok ? 'success' : 'error', title: result.message });
            })
          }
          className="mt-3 space-y-2"
        >
          <Textarea
            name="note"
            aria-label="Gift note"
            rows={3}
            maxLength={500}
            defaultValue={note ?? ''}
            placeholder="We'll print this on the packing slip — and nothing else."
          />
          <Button type="submit" variant="secondary" size="sm" isLoading={pending}>
            Save note
          </Button>
        </form>
      ) : null}
    </div>
  );
}
