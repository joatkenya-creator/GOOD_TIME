'use client';

import { Eye, Heart } from 'lucide-react';
import { useState } from 'react';

import { Modal } from '@/components/ui/modal';
import { Price } from '@/components/ui/price';
import { Rating } from '@/components/ui/rating';
import { Tooltip } from '@/components/ui/tooltip';
import { MediaPlaceholder } from '@/components/common/media-placeholder';
import { cn } from '@/utils/cn';
import type { ProductCardData } from '@/components/product/product-card';

/**
 * The only interactive part of a product card.
 *
 * Kept in its own client island so the card, the grid and the whole homepage
 * stay server-rendered — a page of 16 fully-client product cards is a needless
 * hydration bill.
 *
 * Both actions are presentational in phase 2: wishlist state is local, and Quick
 * View shows the placeholder record. Persistence arrives with the cart phase.
 */
export function ProductCardActions({ product }: { product: ProductCardData }) {
  const [saved, setSaved] = useState(false);
  const [quickView, setQuickView] = useState(false);

  return (
    <>
      <div
        className={cn(
          'absolute top-3 right-3 flex flex-col gap-2',
          // Revealed on hover for pointers, always present for keyboard and touch.
          'opacity-0 transition-opacity duration-(--duration-base) ease-(--ease-brand)',
          'group-focus-within:opacity-100 group-hover:opacity-100',
          'max-md:opacity-100',
        )}
      >
        <Tooltip label={saved ? 'Saved to wishlist' : 'Save to wishlist'}>
          <button
            type="button"
            onClick={() => setSaved((value) => !value)}
            aria-pressed={saved}
            aria-label={
              saved ? `Remove ${product.name} from wishlist` : `Save ${product.name} to wishlist`
            }
            className="flex size-9 items-center justify-center rounded-full bg-surface/90 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
          >
            <Heart
              aria-hidden="true"
              className={cn('size-4 transition-colors', saved && 'fill-accent text-accent')}
            />
          </button>
        </Tooltip>

        <Tooltip label="Quick view">
          <button
            type="button"
            onClick={() => setQuickView(true)}
            aria-label={`Quick view of ${product.name}`}
            className="flex size-9 items-center justify-center rounded-full bg-surface/90 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
          >
            <Eye aria-hidden="true" className="size-4" />
          </button>
        </Tooltip>
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
              compareAtCents={product.compareAtPriceCents}
              size="lg"
              showDiscount
            />
            <p className="text-body-sm leading-relaxed text-foreground-muted">
              Full product detail, variant selection and add-to-cart arrive in a later phase. This
              preview exercises the quick-view surface with placeholder content.
            </p>
          </div>
        </div>
      </Modal>
    </>
  );
}
