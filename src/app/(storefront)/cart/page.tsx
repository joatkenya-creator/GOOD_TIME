import { ShoppingBag } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { CartLine } from '@/components/cart/cart-line';
import { CartSummary } from '@/components/cart/cart-summary';
import { Container } from '@/components/layout/container';
import { RecentlyViewedRail } from '@/components/catalog/recently-viewed-rail';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ROUTES } from '@/constants/routes';
import { getSessionUser } from '@/server/auth/session';
import { getCartView } from '@/services/cart.service';

/**
 * The cart page.
 *
 * Server-rendered from the database on every request, with only the line
 * controls and the summary forms hydrating. A cart is per-visitor and changes
 * constantly, so there is nothing here worth caching.
 */
export const metadata: Metadata = {
  title: 'Your bag',
  // Never index a cart: the URL is public but the contents are personal, and a
  // crawled cart page is an empty page in the index either way.
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function CartPage() {
  const user = await getSessionUser();
  const cart = await getCartView(user?.id);

  if (!cart || (cart.isEmpty && cart.savedLines.length === 0)) {
    return (
      <Container className="py-16">
        {/*
          The empty branch needs its own h1.

          `EmptyState` renders its title as a `<p>`, which is right for a
          generic component that also appears inside sections — but this page's
          entire content is the empty state, so without this the document has no
          h1 at all and its outline starts at the mobile nav's "Menu". A screen
          reader announces the page with no name.
        */}
        <h1 className="sr-only">Your bag</h1>

        <EmptyState
          icon={<ShoppingBag aria-hidden="true" className="size-8" />}
          title="Your bag is empty"
          description="Nothing in here yet. Have a look around — everything ships in plain, unbranded packaging."
          action={
            <Button asChild size="lg">
              <Link href={ROUTES.shop}>Start shopping</Link>
            </Button>
          }
        />

        <div className="mt-16">
          <RecentlyViewedRail />
        </div>
      </Container>
    );
  }

  return (
    <Container className="py-8 sm:py-12">
      <h1 className="text-h2 font-bold text-foreground">Your bag</h1>
      <p className="mt-1 text-body-sm text-foreground-muted">
        {cart.totals.itemCount} {cart.totals.itemCount === 1 ? 'item' : 'items'}
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_22rem] lg:items-start">
        <div className="min-w-0">
          {cart.isEmpty ? (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-body-sm text-foreground-muted">
              Your bag is empty, but you have items saved for later below.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {cart.lines.map((line) => (
                <CartLine key={line.id} line={line} />
              ))}
            </ul>
          )}

          {cart.savedLines.length > 0 ? (
            <section className="mt-10">
              <h2 className="text-body-lg font-semibold text-foreground">
                Saved for later ({cart.savedLines.length})
              </h2>
              <ul className="mt-2 divide-y divide-border">
                {cart.savedLines.map((line) => (
                  <CartLine key={line.id} line={line} />
                ))}
              </ul>
            </section>
          ) : null}

          <div className="mt-8">
            <Button asChild variant="ghost">
              <Link href={ROUTES.shop}>← Continue shopping</Link>
            </Button>
          </div>
        </div>

        {/* Sticky on desktop so the total and the checkout button stay in view
            through a long cart; static on mobile, where a sticky panel would eat
            the viewport. */}
        <aside className="lg:sticky lg:top-24">
          <CartSummary cart={cart} />
        </aside>
      </div>

      <div className="mt-16">
        <RecentlyViewedRail />
      </div>
    </Container>
  );
}
