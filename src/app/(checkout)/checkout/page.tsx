import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { CheckoutForm } from '@/components/checkout/checkout-form';
import { CartSummaryPanel } from '@/components/checkout/order-summary-panel';
import { Container } from '@/components/layout/container';
import { ROUTES } from '@/constants/routes';
import { siteConfig } from '@/config/site';
import { getSessionUser } from '@/server/auth/session';
import { getCartView } from '@/services/cart.service';
import { getShippingOptions } from '@/services/shipping.service';

/**
 * Checkout.
 *
 * Rendered outside the normal storefront chrome — no mega menu, no promotional
 * rails, nothing that leads away. Every link a customer can follow from here is a
 * link they might not come back from, so the only ones present are "back to bag"
 * and the legal pages.
 */
export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function CheckoutPage() {
  const user = await getSessionUser();
  const cart = await getCartView(user?.id);

  // Nothing to pay for. Redirect rather than render an empty checkout, which
  // gives a customer a form that cannot possibly succeed.
  if (!cart || cart.isEmpty) redirect(ROUTES.cart);

  // Priced without a destination: the customer has not entered one yet, so
  // state-restricted rates (no overnight to Alaska) are filtered out only after
  // the address is known. `placeOrder` re-prices against the real address, and
  // that price is the one charged.
  const shippingOptions = await getShippingOptions({
    subtotalCents: cart.totals.subtotalCents,
    totalWeightGrams: cart.totalWeightGrams,
  });

  return (
    <div className="min-h-dvh bg-surface-muted">
      <header className="border-b border-border bg-surface">
        <Container className="flex h-16 items-center justify-between gap-4">
          <Link
            href={ROUTES.home}
            className="font-display text-xl tracking-tight text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--color-ring)"
          >
            {siteConfig.name}
          </Link>

          <span className="text-body-xs text-foreground-subtle">Secure checkout</span>
        </Container>
      </header>

      <Container className="py-8 sm:py-12">
        <div className="grid gap-10 lg:grid-cols-[1fr_22rem] lg:items-start">
          <div className="min-w-0 rounded-2xl border border-border bg-surface p-5 sm:p-8">
            <CheckoutForm
              shippingOptions={shippingOptions}
              defaultEmail={user?.email ?? null}
              isSignedIn={Boolean(user)}
            />
          </div>

          {/* Open by default on desktop, collapsed on mobile — the total stays
              visible either way, which is the number people are actually
              checking. */}
          <aside className="lg:sticky lg:top-8">
            <CartSummaryPanel cart={cart} />
          </aside>
        </div>
      </Container>
    </div>
  );
}
