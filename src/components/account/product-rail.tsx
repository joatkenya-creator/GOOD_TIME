import Link from 'next/link';

import { ProductCard, type ProductCardData } from '@/components/product/product-card';

/**
 * A horizontal shelf of products.
 *
 * Reuses `ProductCard` rather than a smaller account-specific card, so a price
 * change, a badge or a wishlist button lands everywhere at once — and so a
 * recommendation on the dashboard behaves exactly like the same product in a
 * listing.
 *
 * A scroller rather than a carousel: no JavaScript, no autoplay, works with a
 * trackpad, a thumb and a keyboard alike. `snap-x` gives it the same settling
 * feel a carousel would, from two CSS properties.
 */
export function ProductRail({
  title,
  icon,
  products,
  viewAllHref,
}: {
  title: string;
  icon?: React.ReactNode;
  products: ProductCardData[];
  viewAllHref?: string;
}) {
  if (products.length === 0) return null;

  const headingId = `rail-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  return (
    <section aria-labelledby={headingId}>
      <div className="flex items-baseline justify-between gap-4">
        <h2
          id={headingId}
          className="text-h5 flex items-center gap-2 font-semibold text-foreground"
        >
          {icon ? <span className="text-foreground-subtle">{icon}</span> : null}
          {title}
        </h2>

        {viewAllHref ? (
          <Link
            href={viewAllHref}
            className="shrink-0 text-body-sm font-medium text-accent-text underline underline-offset-4"
          >
            View all
          </Link>
        ) : null}
      </div>

      {/* `contain: paint` stops a card's hover shadow widening the document — the
          bug that put a horizontal scrollbar on the homepage in phase 2. */}
      <div className="mt-4 overflow-hidden [contain:paint]">
        <ul className="flex min-w-0 snap-x snap-mandatory gap-5 overflow-x-auto pb-2 [&>*]:shrink-0 [&>*]:snap-start">
          {products.map((product) => (
            <li key={product.id} className="w-[45vw] max-w-56 sm:w-56">
              <ProductCard product={product} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
