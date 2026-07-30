import Link from 'next/link';

import { MediaPlaceholder } from '@/components/common/media-placeholder';
import { ProductCardActions } from '@/components/product/product-card-actions';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Price } from '@/components/ui/price';
import { Rating } from '@/components/ui/rating';
import { ROUTES } from '@/constants/routes';
import { cn } from '@/utils/cn';

export interface ProductCardData {
  id: string;
  slug: string;
  name: string;
  brand?: string;
  priceCents: number;
  compareAtPriceCents?: number | null;
  rating: number;
  reviewCount: number;
  badge?: { label: string; variant: BadgeProps['variant'] } | null;
  /** Seed for the deterministic placeholder; becomes the image URL later. */
  imageSeed: string;
  imageLabel?: string;
}

export interface ProductCardProps {
  product: ProductCardData;
  /** Fixed width for use inside a horizontal carousel. */
  fixedWidth?: boolean;
  className?: string;
}

/**
 * Product card.
 *
 * A server component: only the wishlist and quick-view controls hydrate.
 *
 * The whole card is one link with a stretched hit area, so the entire tile is
 * clickable while the accessible name stays a single, sensible product title —
 * rather than the three competing links (image, title, price) that a naive
 * implementation produces and that make screen-reader navigation miserable.
 */
export function ProductCard({ product, fixedWidth = false, className }: ProductCardProps) {
  return (
    <article
      className={cn(
        'group relative flex flex-col',
        fixedWidth && 'w-[16rem] sm:w-[18rem]',
        className,
      )}
    >
      <div className="relative overflow-hidden rounded-xl bg-surface-muted">
        <MediaPlaceholder
          seed={product.imageSeed}
          label={product.imageLabel ?? product.name}
          ratio="product"
          className="transition-transform duration-700 ease-(--ease-brand) group-hover:scale-[1.04]"
        />

        {product.badge ? (
          <Badge
            variant={product.badge.variant}
            uppercase
            className="absolute top-3 left-3 shadow-xs"
          >
            {product.badge.label}
          </Badge>
        ) : null}

        <ProductCardActions product={product} />
      </div>

      <div className="mt-4 flex flex-1 flex-col gap-2">
        {product.brand ? (
          <p className="text-xs font-medium tracking-wide text-foreground-subtle uppercase">
            {product.brand}
          </p>
        ) : null}

        <h3 className="font-sans text-body-sm leading-snug font-medium text-foreground">
          <Link
            href={ROUTES.product(product.slug)}
            className="before:absolute before:inset-0 before:content-[''] hover:text-accent-text focus-visible:outline-none"
          >
            {product.name}
          </Link>
        </h3>

        <Rating value={product.rating} count={product.reviewCount} size="sm" />

        <Price
          cents={product.priceCents}
          compareAtCents={product.compareAtPriceCents}
          className="mt-auto pt-1"
        />
      </div>
    </article>
  );
}
