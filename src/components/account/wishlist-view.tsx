'use client';

import { Heart, Link2, ShoppingBag, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState, useTransition } from 'react';

import { MediaPlaceholder } from '@/components/common/media-placeholder';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Price } from '@/components/ui/price';
import { useToast } from '@/components/ui/toast';
import { ROUTES } from '@/constants/routes';
import { setCartCount } from '@/hooks/use-cart-count';
import {
  clearWishlistAction,
  moveWishlistItemToCartAction,
  setWishlistSharedAction,
  syncWishlistAction,
} from '@/server/actions/wishlist';
import type { ProductCardView } from '@/services/product.service';

/**
 * The saved-items page.
 *
 * A list rather than the usual product grid: this is a working list someone acts
 * on — move to bag, remove — not a browsing surface, and each row needs room for
 * its actions.
 */

export interface WishlistEntry {
  id: string;
  addedAt: Date;
  variantId: string | null;
  product: ProductCardView;
}

export function WishlistView({
  items,
  shareToken,
  siteUrl,
}: {
  items: WishlistEntry[];
  shareToken: string | null;
  siteUrl: string;
}) {
  const [pending, startTransition] = useTransition();
  const [token, setToken] = useState(shareToken);
  const { toast } = useToast();

  function remove(productId: string) {
    startTransition(async () => {
      const result = await syncWishlistAction(productId, false);
      toast({ variant: result.ok ? 'success' : 'error', title: result.message });
    });
  }

  function moveToBag(entry: WishlistEntry) {
    // A product with no default variant cannot be added blind — send them to the
    // page to choose, rather than guessing which size or colour they meant.
    if (!entry.variantId) {
      toast({ variant: 'info', title: 'Choose an option on the product page first.' });
      return;
    }

    startTransition(async () => {
      const result = await moveWishlistItemToCartAction(entry.product.id, entry.variantId!);
      if (result.count !== undefined) setCartCount(result.count);
      toast({ variant: result.ok ? 'success' : 'error', title: result.message });
    });
  }

  function toggleShare() {
    startTransition(async () => {
      const result = await setWishlistSharedAction(token === null);
      setToken(result.shareToken);
      toast({ variant: result.ok ? 'success' : 'error', title: result.message });
    });
  }

  function clearAll() {
    startTransition(async () => {
      const result = await clearWishlistAction();
      toast({ variant: result.ok ? 'success' : 'error', title: result.message });
    });
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Heart aria-hidden="true" className="size-8" />}
        title="Nothing saved yet"
        description="Tap the heart on anything you want to come back to. Saved items follow you between devices once you are signed in."
        action={
          <Button asChild>
            <Link href={ROUTES.shop}>Browse the shop</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-sm text-foreground-muted">
          {items.length} saved {items.length === 1 ? 'item' : 'items'}
        </p>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" disabled={pending} onClick={toggleShare}>
            <Link2 aria-hidden="true" className="size-4" />
            {token ? 'Stop sharing' : 'Share wishlist'}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={clearAll}
            className="text-foreground-muted hover:text-danger-700"
          >
            Clear all
          </Button>
        </div>
      </div>

      {token ? (
        <div className="bg-accent-subtle rounded-xl border border-accent/30 p-4">
          <p className="text-body-sm font-medium text-foreground">Your share link</p>
          <p className="text-body-xs mt-1 font-mono break-all text-foreground-muted">
            {siteUrl}/wishlist/{token}
          </p>
          <p className="text-body-xs mt-2 text-foreground-subtle">
            Anyone with this link can see what you saved. It shows no name or contact details, and
            turning sharing off makes the link stop working immediately.
          </p>
        </div>
      ) : null}

      <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
        {items.map((entry) => {
          const href = entry.product.href;

          return (
            <li key={entry.id} className="flex gap-4 p-4 sm:p-5">
              <Link href={href} className="shrink-0">
                <MediaPlaceholder
                  seed={entry.product.imageSeed}
                  ratio="square"
                  className="size-20 rounded-lg sm:size-24"
                />
              </Link>

              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div>
                  <Link
                    href={href}
                    className="line-clamp-2 text-body-sm font-medium text-foreground hover:text-accent-text"
                  >
                    {entry.product.name}
                  </Link>
                  <p className="text-body-xs mt-0.5 text-foreground-subtle">
                    Saved{' '}
                    {entry.addedAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
                  </p>
                </div>

                <Price
                  cents={entry.product.priceCents}
                  compareAtCents={entry.product.compareAtPriceCents}
                  size="sm"
                />

                <div className="mt-1 flex flex-wrap gap-1">
                  <Button size="sm" disabled={pending} onClick={() => moveToBag(entry)}>
                    <ShoppingBag aria-hidden="true" className="size-4" />
                    Move to bag
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => remove(entry.product.id)}
                    className="text-foreground-muted hover:text-danger-700"
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                    Remove
                    <span className="sr-only"> {entry.product.name}</span>
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
