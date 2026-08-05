'use client';

import { ArrowLeft, Lock } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { authorizeCheckoutAction } from '@/server/actions/checkout';
import { formatPrice } from '@/utils/format';

/**
 * The Klarna payment step.
 *
 * ## Where the sensitive data goes
 *
 * Into an iframe Klarna owns. The SDK renders its own fields inside the
 * container below, so a bank login, a card number or a date of birth never
 * reaches our JavaScript, our servers or our logs. That is what keeps this
 * store out of PCI scope entirely rather than merely in SAQ-A.
 *
 * ## The flow, and why the server does the last step
 *
 * 1. The server opened a Klarna session and issued a `clientToken`.
 * 2. `Klarna.Payments.init` mounts the widget with that token.
 * 3. `authorize` returns an `authorization_token` — single-use, one hour.
 * 4. That token goes to **our server**, which places the Klarna order.
 *
 * Step 4 is not done in the browser even though Klarna's API would allow it.
 * Placing the order is the moment the customer becomes liable; doing it
 * server-side is what lets it be rate-limited, audited, retried idempotently
 * and reconciled against the order we actually created.
 *
 * ## Redirects
 *
 * Some Klarna products finish in the customer's bank or in the Klarna app.
 * Klarna hands back a `redirect_url` and the customer returns to the order
 * page. That page reads the order from the database — never from the URL — and
 * the push notification is what confirms it, so a customer editing the address
 * bar cannot fake a confirmation.
 */

declare global {
  interface Window {
    Klarna?: {
      Payments: {
        init(options: { client_token: string }): void;
        load(
          options: { container: string; payment_method_category?: string },
          callback: (result: { show_form: boolean; error?: unknown }) => void,
        ): void;
        authorize(
          options: { payment_method_category?: string; auto_finalize?: boolean },
          data: Record<string, unknown>,
          callback: (result: {
            show_form: boolean;
            approved: boolean;
            authorization_token?: string;
            error?: { invalid_fields?: string[] };
          }) => void,
        ): void;
      };
    };
  }
}

const SDK_URL = 'https://x.klarnacdn.net/kp/lib/v1/api.js';

/**
 * Loads the Klarna SDK exactly once per document.
 *
 * Not `next/script`: the widget cannot mount until the global exists, so this
 * needs a promise to await rather than a callback that fires whenever. The
 * promise is cached on the module so a customer stepping back and forth does
 * not inject a second script tag.
 */
let sdkPromise: Promise<void> | null = null;

function loadKlarnaSdk(): Promise<void> {
  if (window.Klarna) return Promise.resolve();

  sdkPromise ??= new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SDK_URL}"]`);

    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Klarna SDK failed to load')));
      return;
    }

    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // Reset, so a customer on a flaky connection can retry rather than being
      // stuck with a permanently rejected promise for the rest of the session.
      sdkPromise = null;
      reject(new Error('Klarna SDK failed to load'));
    };
    document.head.appendChild(script);
  });

  return sdkPromise;
}

export interface PaymentTotals {
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  creditAppliedCents?: number;
  amountDueCents?: number;
}

export interface PaymentCategory {
  identifier: string;
  name: string;
}

interface PaymentStepProps {
  clientToken: string;
  orderId: string;
  orderNumber: string;
  totals: PaymentTotals;
  email: string;
  categories: PaymentCategory[];
  onBack: () => void;
}

/**
 * The step's shell: the totals, the product picker, and the widget.
 *
 * `selected` lives here rather than in the widget so that changing it can
 * remount the widget through its `key`. That is the React-sanctioned way to
 * reset state when an input changes, and it fixes a real bug: resetting
 * `status` from inside the effect left it at `'ready'` for one render after a
 * change, so the Pay button was briefly enabled over a widget that was being
 * torn down and rebuilt. A customer who clicked in that window authorised
 * against the wrong Klarna product.
 */
export function PaymentStep(props: PaymentStepProps) {
  const [selected, setSelected] = useState(props.categories[0]?.identifier);

  return (
    <KlarnaWidget
      {...props}
      key={`${props.clientToken}:${selected ?? 'default'}`}
      selected={selected}
      onSelect={setSelected}
    />
  );
}

function KlarnaWidget({
  clientToken,
  orderId,
  orderNumber,
  totals,
  email,
  categories,
  selected,
  onSelect,
  onBack,
}: PaymentStepProps & {
  selected: string | undefined;
  onSelect: (identifier: string) => void;
}) {
  // Klarna's container selector must be a valid CSS id; React's `useId`
  // includes colons, which are not.
  const containerId = `klarna-${useId().replace(/:/g, '')}`;
  // Starts at 'loading' on every mount, and the `key` above guarantees a fresh
  // mount whenever the token or the chosen product changes.
  const [status, setStatus] = useState<'loading' | 'ready' | 'submitting' | 'failed'>('loading');
  const [error, setError] = useState<string | null>(null);

  /*
   * Guards against a double authorise.
   *
   * `authorize` is a callback API, and a customer who double-clicks before
   * React re-renders gets two in flight. Two authorisations means two holds
   * against their Klarna credit line for one order.
   */
  const inFlight = useRef(false);

  const amountDue = totals.amountDueCents ?? totals.totalCents;

  useEffect(() => {
    let cancelled = false;

    async function mount() {
      try {
        await loadKlarnaSdk();
        if (cancelled || !window.Klarna) return;

        window.Klarna.Payments.init({ client_token: clientToken });

        window.Klarna.Payments.load(
          {
            container: `#${containerId}`,
            ...(selected ? { payment_method_category: selected } : {}),
          },
          (result) => {
            if (cancelled) return;

            if (!result.show_form) {
              // Klarna has decided this customer cannot use this product. That
              // is a decision, not a failure — say so plainly rather than
              // leaving a broken widget on screen.
              setStatus('failed');
              setError(
                'Klarna is not available for this order. Contact us and we will take payment another way.',
              );
              return;
            }

            setStatus('ready');
          },
        );
      } catch {
        if (cancelled) return;
        setStatus('failed');
        setError('We could not load Klarna. Check your connection and try again.');
      }
    }

    void mount();

    return () => {
      cancelled = true;
    };
  }, [clientToken, containerId, selected]);

  const pay = useCallback(() => {
    if (inFlight.current || !window.Klarna) return;

    inFlight.current = true;
    setStatus('submitting');
    setError(null);

    window.Klarna.Payments.authorize(
      {
        ...(selected ? { payment_method_category: selected } : {}),
        // Klarna finalises the authorisation itself. Deferred finalisation is
        // for flows that change the amount after authorising, which this does
        // not — the total was fixed when the order was created.
        auto_finalize: true,
      },
      {},
      (result) => {
        void (async () => {
          try {
            if (!result.approved || !result.authorization_token) {
              setStatus('ready');
              setError(
                result.error?.invalid_fields?.length
                  ? 'Klarna needs a correction to the highlighted details above.'
                  : 'Klarna did not approve this purchase. Try another payment option.',
              );
              return;
            }

            // The token goes to our server, which places the Klarna order.
            const outcome = await authorizeCheckoutAction(orderId, result.authorization_token);

            switch (outcome.status) {
              case 'authorized':
              case 'pending':
                window.location.assign(
                  `/order/${outcome.orderNumber}?email=${encodeURIComponent(email)}`,
                );
                return;

              case 'redirect':
                window.location.assign(outcome.redirectUrl);
                return;

              default:
                setStatus('ready');
                setError(outcome.message);
            }
          } finally {
            inFlight.current = false;
          }
        })();
      },
    );
  }, [email, orderId, selected]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-h4 font-semibold text-foreground">Payment</h2>
        <p className="mt-1 text-body-sm text-foreground-muted">
          Order <strong className="text-foreground">{orderNumber}</strong> is reserved. Klarna does
          not bill you until you confirm below.
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
          figure, and it must, before anyone commits to paying it. */}
      <dl className="rounded-xl border border-border bg-surface-muted p-4 text-body-sm">
        <Row label="Subtotal">{formatPrice(totals.subtotalCents)}</Row>
        <Row label="Shipping">
          {totals.shippingCents === 0 ? 'Free' : formatPrice(totals.shippingCents)}
        </Row>
        <Row label="Sales tax">{formatPrice(totals.taxCents)}</Row>

        {totals.creditAppliedCents ? (
          <Row label="Store credit and rewards">−{formatPrice(totals.creditAppliedCents)}</Row>
        ) : null}

        <div className="mt-2 flex items-baseline justify-between border-t border-border pt-2">
          <dt className="font-semibold text-foreground">Klarna will bill you</dt>
          <dd className="text-h5 font-bold text-foreground tabular-nums">
            {formatPrice(amountDue)}
          </dd>
        </div>
      </dl>

      {categories.length > 1 ? (
        <fieldset className="space-y-2">
          <legend className="text-body-sm font-medium text-foreground">Choose how to pay</legend>

          {categories.map((category) => (
            <label
              key={category.identifier}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 text-body-sm"
            >
              <input
                type="radio"
                name="klarna-category"
                value={category.identifier}
                checked={selected === category.identifier}
                onChange={() => onSelect(category.identifier)}
                className="size-4"
              />
              {category.name}
            </label>
          ))}
        </fieldset>
      ) : null}

      {/* Klarna renders its own iframe here. Never put anything inside it. */}
      <div id={containerId} className="min-h-24" />

      {status === 'loading' ? (
        <p aria-live="polite" className="text-body-sm text-foreground-muted">
          Loading Klarna…
        </p>
      ) : null}

      <p className="text-body-xs flex items-center gap-2 text-foreground-subtle">
        <Lock aria-hidden="true" className="size-3.5" />
        Your payment details go straight to Klarna. We never see or store them.
      </p>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-6">
        <Button type="button" variant="ghost" onClick={onBack} disabled={status === 'submitting'}>
          <ArrowLeft aria-hidden="true" className="size-4" />
          Back
        </Button>

        <Button
          type="button"
          size="lg"
          className="ml-auto"
          onClick={pay}
          isLoading={status === 'submitting'}
          disabled={status !== 'ready'}
        >
          <Lock aria-hidden="true" className="size-4" />
          Pay with Klarna
        </Button>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <dt className="text-foreground-muted">{label}</dt>
      <dd className="text-foreground tabular-nums">{children}</dd>
    </div>
  );
}
