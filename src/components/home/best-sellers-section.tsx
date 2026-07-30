import Link from 'next/link';

import { Container } from '@/components/layout/container';
import { Reveal } from '@/components/motion/reveal';
import { ProductCard } from '@/components/product/product-card';
import { Button } from '@/components/ui/button';
import { Carousel } from '@/components/ui/carousel';
import { ROUTES } from '@/constants/routes';
import { bestSellers } from '@/features/home/content';

/**
 * Best sellers.
 *
 * A horizontal rail rather than a grid, so the section reads differently from
 * "Trending" further down the page while showing the same object type.
 *
 * Sits on the muted surface to separate it from the white sections either side
 * without introducing another accent colour.
 */
export function BestSellersSection() {
  return (
    <section
      aria-labelledby="best-sellers-title"
      className="bg-surface-muted py-(--spacing-section)"
    >
      <Container>
        <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-xl">
            <p className="text-eyebrow text-accent-text uppercase">Most loved</p>
            <h2 id="best-sellers-title" className="mt-3 text-display-lg text-foreground">
              What sells the most
            </h2>
            <p className="mt-4 text-body leading-relaxed text-foreground-muted">
              Ranked by repeat purchases over the last ninety days — not by what we have most of.
            </p>
          </div>

          <Button variant="outline" asChild>
            <Link href={ROUTES.shop}>Shop all products</Link>
          </Button>
        </div>

        <Reveal>
          <Carousel label="Best selling products">
            {bestSellers.map((product) => (
              <ProductCard key={product.id} product={product} fixedWidth />
            ))}
          </Carousel>
        </Reveal>
      </Container>
    </section>
  );
}
