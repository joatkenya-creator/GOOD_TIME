import Link from 'next/link';

import { MediaPlaceholder } from '@/components/common/media-placeholder';
import { ProductCardActions } from '@/components/product/product-card-actions';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Price } from '@/components/ui/price';
import { Rating } from '@/components/ui/rating';
import { cn } from '@/utils/cn';

export interface ProductCardData {
  id: string;
  slug: string;
  name: string;
  brand?: string;
  priceCents: number;
  compareAtPriceCents?: number | null;
  /** Upper bound when variants span a range. Null when every variant is one price. */
  maxPriceCents?: number | null;
  rating: number;
  reviewCount: number;
  badge?: { label: string; variant: BadgeProps['variant'] } | null;
  /** Seed for the deterministic placeholder; becomes the image URL later. */
  imageSeed: string;
  /** Second image, revealed on hover. Omit for a single-image card. */
  hoverImageSeed?: string | null;
  imageLabel?: string;
  /**
   * Canonical URL, and required.
   *
   * It used to be optional, falling back to `/products/<slug>` — a route this
   * app has never had. Anything that built a card without asking the catalog
   * where the product lives produced a link straight to a 404, and the type
   * checker had nothing to say about it. Products live under their category
   * (`/shop/vibrators/bullets/pebble-bullet-vibrator`), which a bare slug
   * cannot reconstruct, so the only safe contract is to demand the real URL.
   * `productHref()` builds it.
   */
  href: string;
  stock?: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'BACKORDER';
  shortDescription?: string | null;
}

export interface ProductCardProps {
  product: ProductCardData;
  /** Fixed width for use inside a horizontal carousel. */
  fixedWidth?: boolean;
  /** `list` shows the description alongside a wider image. */
  layout?: 'grid' | 'list';
  className?: string;
}

/**
 * Product card.
 *
 * A server component: only the wishlist, compare and quick-view controls hydrate.
 *
 * The whole card is one link with a stretched hit area, so the entire tile is
 * clickable while the accessible name stays a single, sensible product title —
 * rather than the three competing links (image, title, price) that a naive
 * implementation produces and that make screen-reader navigation miserable.
 */
export function ProductCard({
  product,
  fixedWidth = false,
  layout = 'grid',
  className,
}: ProductCardProps) {
  const isList = layout === 'list';
  const soldOut = product.stock === 'OUT_OF_STOCK';

  return (
    <article
      className={cn(
        'group relative',
        isList
          ? 'flex flex-col gap-5 border-b border-border pb-6 sm:flex-row sm:gap-7'
          : 'flex flex-col',
        fixedWidth && 'w-[16rem] sm:w-[18rem]',
        className,
      )}
    >
      <div
        className={cn(
          'relative overflow-hidden rounded-xl bg-surface-muted',
          isList && 'sm:w-56 sm:shrink-0',
        )}
      >
        <MediaPlaceholder
          seed={product.imageSeed}
          label={product.imageLabel ?? product.name}
          ratio="product"
          className={cn(
            'transition-transform duration-700 ease-(--ease-brand)',
            // Only zoom when there is no second image to swap to.
            product.hoverImageSeed ? 'group-hover:opacity-0' : 'group-hover:scale-[1.04]',
            soldOut && 'opacity-60',
          )}
        />

        {/*
         * Hover image sits underneath and is revealed by fading the first out,
         * which avoids a second layout pass and works without JavaScript.
         */}
        {product.hoverImageSeed ? (
          <MediaPlaceholder
            seed={product.hoverImageSeed}
            label={product.imageLabel ?? product.name}
            ratio="product"
            aria-hidden="true"
            className="absolute inset-0 -z-10 scale-[1.02]"
          />
        ) : null}

        {product.badge ? (
          <Badge
            variant={product.badge.variant}
            uppercase
            className="absolute top-3 left-3 shadow-xs"
          >
            {product.badge.label}
          </Badge>
        ) : null}

        {soldOut ? (
          <span className="absolute inset-x-0 bottom-0 bg-ink-900/80 py-2 text-center text-xs font-semibold tracking-wide text-white uppercase">
            Sold out
          </span>
        ) : null}

        <ProductCardActions product={product} />
      </div>

      <div className={cn('flex flex-1 flex-col gap-2', isList ? 'sm:py-1' : 'mt-4')}>
        {product.brand ? (
          <p className="text-xs font-medium tracking-wide text-foreground-subtle uppercase">
            {product.brand}
          </p>
        ) : null}

        <h3
          className={cn(
            'font-medium text-foreground',
            isList ? 'font-display text-xl tracking-tight' : 'font-sans text-body-sm leading-snug',
          )}
        >
          <Link
            href={product.href}
            className="before:absolute before:inset-0 before:content-[''] hover:text-accent-text focus-visible:outline-none"
          >
            {product.name}
          </Link>
        </h3>

        {isList && product.shortDescription ? (
          <p className="mt-1 line-clamp-2 max-w-prose text-body-sm leading-relaxed text-foreground-muted">
            {product.shortDescription}
          </p>
        ) : null}

        <Rating value={product.rating} count={product.reviewCount} size="sm" />

        {product.stock === 'LOW_STOCK' ? (
          <p className="text-xs font-medium text-warning-700">Low stock</p>
        ) : null}

        <Price
          cents={product.priceCents}
          maxCents={product.maxPriceCents}
          compareAtCents={product.compareAtPriceCents}
          className={cn('mt-auto pt-1', isList && 'text-base')}
          size={isList ? 'md' : 'sm'}
        />
      </div>
    </article>
  );
}
