import Link from 'next/link';

import { Container } from '@/components/layout/container';
import { Reveal } from '@/components/motion/reveal';
import { ProductCard } from '@/components/product/product-card';
import { Button } from '@/components/ui/button';
import { ROUTES } from '@/constants/routes';
import type { ProductCardView } from '@/services/product.service';

/**
 * Trending products.
 *
 * A four-column grid — deliberately the opposite treatment to the best-seller
 * rail, so two product sections on one page do not feel like a repeated block.
 * The grid also lets a visitor scan everything at once, which suits browsing
 * intent rather than the curated intent of the rail.
 *
 * "Newest" stands in for trending. Real trending needs view and add-to-cart
 * counts over a rolling window, which is an analytics job; ranking by recency
 * is at least true, and the section says "moving quickly this week" rather than
 * claiming a popularity signal nothing measures yet.
 */
export function TrendingSection({ products: trendingProducts }: { products: ProductCardView[] }) {
  if (trendingProducts.length === 0) return null;

  return (
    <section aria-labelledby="trending-title" className="py-(--spacing-section)">
      <Container>
        <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-xl">
            <p className="text-eyebrow text-accent-text uppercase">Trending now</p>
            <h2 id="trending-title" className="mt-3 text-display-lg text-foreground">
              Moving quickly this week
            </h2>
          </div>

          <Button variant="ghost" asChild>
            <Link href={ROUTES.shop}>View everything</Link>
          </Button>
        </div>

        <ul className="grid grid-cols-2 gap-x-5 gap-y-10 lg:grid-cols-4">
          {trendingProducts.map((product, index) => (
            <li key={product.id}>
              <Reveal delay={Math.min(index * 0.05, 0.3)}>
                <ProductCard product={product} />
              </Reveal>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
