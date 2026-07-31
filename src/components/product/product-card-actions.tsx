'use client';

import { Eye, Heart, Scale } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { MediaPlaceholder } from '@/components/common/media-placeholder';
import type { ProductCardData } from '@/components/product/product-card';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Price } from '@/components/ui/price';
import { Rating } from '@/components/ui/rating';
import { Tooltip } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/toast';
import { ROUTES } from '@/constants/routes';
import { useCompare, useWishlist } from '@/hooks/use-product-lists';
import { cn } from '@/utils/cn';

/**
 * The only interactive part of a product card.
 *
 * Kept in its own client island so the card, the grid and the whole listing stay
 * server-rendered — a page of 24 fully-client product cards is a needless
 * hydration bill.
 *
 * Wishlist and compare persist to `localStorage` via a shared store, so the
 * header badge and every other card on the page update together.
 */
export function ProductCardActions({ product }: { product: ProductCardData }) {
  const [quickView, setQuickView] = useState(false);
  const wishlist = useWishlist();
  const compare = useCompare();
  const { toast } = useToast();

  const saved = wishlist.has(product.id);
  const comparing = compare.has(product.id);

  function onWishlist() {
    const added = wishlist.toggle(product.id);
    toast({
      variant: 'success',
      title: added ? 'Saved to wishlist' : 'Removed from wishlist',
      description: added ? product.name : undefined,
    });
  }

  function onCompare() {
    if (comparing) {
      compare.remove(product.id);
      return;
    }

    const result = compare.tryAdd(product.id);
    if (!result.ok && result.reason === 'full') {
      toast({
        variant: 'warning',
        title: `Compare holds ${compare.limit} products`,
        description: 'Remove one to add another.',
      });
    }
  }

  return (
    <>
      <div
        className={cn(
          'absolute right-3 flex flex-col gap-2',
          /*
           * Bottom-aligned on small screens, top-aligned from `md` up.
           *
           * At 360px a two-column grid gives each card ~155px, and a top-right
           * action stack sits directly on top of the top-left merchandising
           * badge — "Best seller" rendered as "BEST SELL" with the rest hidden
           * behind a button. Verified in Chromium at 360px.
           */
          'bottom-3 md:top-3 md:bottom-auto',
          // Revealed on hover for pointers, always present for keyboard and touch.
          'opacity-0 transition-opacity duration-(--duration-base) ease-(--ease-brand)',
          'group-focus-within:opacity-100 group-hover:opacity-100',
          'max-md:opacity-100',
        )}
      >
        <IconAction
          label={saved ? 'Saved to wishlist' : 'Save to wishlist'}
          ariaLabel={
            saved ? `Remove ${product.name} from wishlist` : `Save ${product.name} to wishlist`
          }
          pressed={saved}
          onClick={onWishlist}
        >
          <Heart className={cn('size-4 transition-colors', saved && 'fill-accent text-accent')} />
        </IconAction>

        <IconAction
          label={comparing ? 'Remove from compare' : 'Add to compare'}
          ariaLabel={
            comparing ? `Remove ${product.name} from compare` : `Add ${product.name} to compare`
          }
          pressed={comparing}
          onClick={onCompare}
        >
          <Scale className={cn('size-4 transition-colors', comparing && 'text-accent')} />
        </IconAction>

        <IconAction
          label="Quick view"
          ariaLabel={`Quick view of ${product.name}`}
          onClick={() => setQuickView(true)}
        >
          <Eye className="size-4" />
        </IconAction>
      </div>

      <Modal
        open={quickView}
        onClose={() => setQuickView(false)}
        title={product.name}
        description={product.brand ?? undefined}
        size="lg"
      >
        <div className="grid gap-6 sm:grid-cols-2">
          <MediaPlaceholder
            seed={product.imageSeed}
            label={product.imageLabel ?? product.name}
            ratio="product"
            className="rounded-xl"
          />

          <div className="space-y-4">
            <Rating value={product.rating} count={product.reviewCount} />

            <Price
              cents={product.priceCents}
              maxCents={product.maxPriceCents}
              compareAtCents={product.compareAtPriceCents}
              size="lg"
              showDiscount
            />

            {product.shortDescription ? (
              <p className="text-body-sm leading-relaxed text-foreground-muted">
                {product.shortDescription}
              </p>
            ) : null}

            <div className="flex flex-col gap-2 pt-2">
              <Button asChild fullWidth>
                <Link href={product.href ?? ROUTES.product(product.slug)}>View full details</Link>
              </Button>

              <Button variant="outline" fullWidth onClick={onWishlist}>
                {saved ? 'Saved' : 'Save to wishlist'}
              </Button>
            </div>

            <p className="text-xs leading-relaxed text-foreground-subtle">
              Variant selection and add-to-cart arrive with the cart phase.
            </p>
          </div>
        </div>
      </Modal>
    </>
  );
}

function IconAction({
  label,
  ariaLabel,
  pressed,
  onClick,
  children,
}: {
  label: string;
  ariaLabel: string;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={pressed}
        aria-label={ariaLabel}
        className="flex size-9 items-center justify-center rounded-full bg-surface/90 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
      >
        {children}
      </button>
    </Tooltip>
  );
}
