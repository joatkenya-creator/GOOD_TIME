'use client';

import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { ArrowLeft, Lock } from 'lucide-react';
import { useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { publicEnv } from '@/lib/env.public';
import { formatPrice } from '@/utils/format';

/**
 * The card form.
 *
 * Stripe's `PaymentElement`, not our own inputs: the fields live in a Stripe-hosted
 * iframe, so card numbers never reach our JavaScript, our servers or our logs.
 * That is what keeps this store in PCI SAQ-A rather than a scope that needs an
 * annual audit.
 *
 * The element is mounted only once an order exists and a client secret has been
 * issued. Mounting it earlier means a customer can enter a card for an order
 * that was never created.
 */

// Module scope: `loadStripe` injects a script tag, and calling it per render
// would inject one per render.
const stripePromise = publicEnv.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(publicEnv.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;

export interface PaymentTotals {
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
}

export function PaymentStep({
  clientSecret,
  orderNumber,
  totals,
  email,
  onBack,
}: {
  clientSecret: string;
  orderNumber: string;
  totals: PaymentTotals;
  email: string;
  onBack: () => void;
}) {
  if (!stripePromise) {
    return (
      <Alert variant="danger" title="Payments are not configured">
        Your order <strong>{orderNumber}</strong> has been created but cannot be paid for yet.
        Contact us and we will take payment another way.
      </Alert>
    );
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: {
          theme: 'flat',
          variables: {
            colorPrimary: '#E91E63',
            colorText: '#333333',
            colorDanger: '#F44336',
            borderRadius: '8px',
            fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
            spacingUnit: '4px',
          },
        },
      }}
    >
      <PaymentInner orderNumber={orderNumber} totals={totals} email={email} onBack={onBack} />
    </Elements>
  );
}

function PaymentInner({
  orderNumber,
  totals,
  email,
  onBack,
}: {
  orderNumber: string;
  totals: PaymentTotals;
  email: string;
  onBack: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function pay(event: React.FormEvent) {
    event.preventDefault();
    if (!stripe || !elements) return;

    setSubmitting(true);
    setError(null);

    const result = await stripe.confirmPayment({
      elements,
      confirmParams: {
        // Where the customer lands after a 3DS redirect. The page reads the
        // order from the database, not from this URL — the webhook is what marks
        // it paid, and a customer editing this address must not be able to fake
        // a confirmation.
        return_url: `${window.location.origin}/order/${orderNumber}?email=${encodeURIComponent(email)}`,
        receipt_email: email,
      },
    });

    // Reached only when the payment failed *without* a redirect. On success the
    // browser has already navigated away.
    if (result.error) {
      setError(
        result.error.type === 'card_error' || result.error.type === 'validation_error'
          ? (result.error.message ?? 'Your card was declined.')
          : 'Something went wrong taking your payment. No charge was made.',
      );
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={pay} className="space-y-6">
      <div>
        <h2 className="text-h4 font-semibold text-foreground">Payment</h2>
        <p className="mt-1 text-body-sm text-foreground-muted">
          Order <strong className="text-foreground">{orderNumber}</strong> is reserved. It is not
          charged until you confirm below.
        </p>
      </div>

      {error ? (
        <Alert variant="danger" title="Payment not completed">
          {error}
        </Alert>
      ) : null}

      {/* The authoritative amount, not the cart's estimate. Tax is only knowable
          once the address has been quoted, which happened when this order was
          created — so this is the first screen that can honestly state the
          figure, and it must, before anyone types a card number. */}
      <dl className="rounded-xl border border-border bg-surface-muted p-4 text-body-sm">
        <Row label="Subtotal">{formatPrice(totals.subtotalCents)}</Row>
        <Row label="Shipping">
          {totals.shippingCents === 0 ? 'Free' : formatPrice(totals.shippingCents)}
        </Row>
        <Row label="Sales tax">{formatPrice(totals.taxCents)}</Row>

        <div className="mt-2 flex items-baseline justify-between border-t border-border pt-2">
          <dt className="font-semibold text-foreground">You will be charged</dt>
          <dd className="text-h5 font-bold tabular-nums text-foreground">
            {formatPrice(totals.totalCents)}
          </dd>
        </div>
      </dl>

      <PaymentElement options={{ layout: 'tabs' }} />

      <p className="flex items-center gap-2 text-body-xs text-foreground-subtle">
        <Lock aria-hidden="true" className="size-3.5" />
        Card details go straight to Stripe. We never see or store them.
      </p>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-6">
        <Button type="button" variant="ghost" onClick={onBack} disabled={submitting}>
          <ArrowLeft aria-hidden="true" className="size-4" />
          Back
        </Button>

        <Button
          type="submit"
          size="lg"
          className="ml-auto"
          isLoading={submitting}
          disabled={!stripe}
        >
          <Lock aria-hidden="true" className="size-4" />
          Pay now
        </Button>
      </div>
    </form>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <dt className="text-foreground-muted">{label}</dt>
      <dd className="tabular-nums text-foreground">{children}</dd>
    </div>
  );
}
