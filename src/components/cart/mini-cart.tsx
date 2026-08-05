'use client';

import { ShoppingBag } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { CartLine } from '@/components/cart/cart-line';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Spinner } from '@/components/ui/spinner';
import { ROUTES } from '@/constants/routes';
import { setCartCount, useCartCount } from '@/hooks/use-cart-count';
import type { CartView } from '@/services/cart.service';
import { formatPrice } from '@/utils/format';
import { cn } from '@/utils/cn';

/**
 * Header bag button and mini cart drawer.
 *
 * The badge count is rendered on the server and passed in, so the header shows
 * the right number in the very first HTML — a count that appears a moment after
 * hydration reads as a bug.
 *
 * The drawer's contents are fetched on open rather than on mount: most visits
 * never open it, and a cart payload on every page load is a request nobody asked
 * for.
 */
export function MiniCart({ initialCount }: { initialCount: number }) {
  const [open, setOpen] = useState(false);
  const [cart, setCart] = useState<CartView | null>(null);
  const [loading, setLoading] = useState(false);

  // Server-rendered on first paint, then kept current by whatever mutates the
  // bag — a product page, the cart, this drawer.
  const count = useCartCount(initialCount);

  // Fetched from the click, not from an effect reacting to `open`: the drawer
  // opens for exactly one reason, and an effect would re-run on every unrelated
  // re-render that happened to leave it open.
  async function openCart() {
    setOpen(true);
    setLoading(true);

    try {
      const response = await fetch('/api/cart', { cache: 'no-store' });
      const body = await response.json();
      setCart(body.ok ? body.data : null);
      if (body.ok && body.data) setCartCount(body.data.totals.itemCount);
    } catch {
      // Leave whatever was already loaded; the full cart page is one tap away.
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void openCart()}
        aria-label={`Your bag, ${count} ${count === 1 ? 'item' : 'items'}`}
        aria-haspopup="dialog"
        className={cn(
          'relative flex size-11 items-center justify-center rounded-full text-foreground',
          'transition-colors duration-(--duration-fast) ease-(--ease-brand) hover:bg-surface-muted hover:text-accent-text',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)',
        )}
      >
        <ShoppingBag aria-hidden="true" className="size-5" />
        {count > 0 ? (
          <span
            aria-hidden="true"
            className="absolute top-1.5 right-1 flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[0.625rem] font-semibold text-white"
          >
            {count > 99 ? '99+' : count}
          </span>
        ) : null}
      </button>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Your bag"
        side="right"
        footer={
          cart && !cart.isEmpty ? (
            <div className="space-y-3">
              <div className="flex items-baseline justify-between">
                <span className="text-body-sm text-foreground-muted">Subtotal</span>
                <span className="text-h5 font-bold text-foreground tabular-nums">
                  {formatPrice(cart.totals.subtotalCents)}
                </span>
              </div>

              <p className="text-body-xs text-foreground-subtle">
                Shipping and tax calculated at checkout.
              </p>

              <Button asChild size="lg" className="w-full">
                <Link href={ROUTES.checkout} onClick={() => setOpen(false)}>
                  Checkout
                </Link>
              </Button>

              <Button asChild variant="secondary" className="w-full">
                <Link href={ROUTES.cart} onClick={() => setOpen(false)}>
                  View full bag
                </Link>
              </Button>
            </div>
          ) : null
        }
      >
        {loading && !cart ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : !cart || cart.isEmpty ? (
          <div className="py-12 text-center">
            <ShoppingBag aria-hidden="true" className="mx-auto size-8 text-foreground-subtle" />
            <p className="mt-3 text-body-sm text-foreground-muted">Your bag is empty.</p>
            <Button asChild variant="secondary" className="mt-4">
              <Link href={ROUTES.shop} onClick={() => setOpen(false)}>
                Start shopping
              </Link>
            </Button>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {cart.lines.map((line) => (
              <CartLine key={line.id} line={line} compact />
            ))}
          </ul>
        )}
      </Drawer>
    </>
  );
}
