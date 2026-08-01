import Link from 'next/link';

import { Container } from '@/components/layout/container';
import { Reveal } from '@/components/motion/reveal';
import { ProductCard } from '@/components/product/product-card';
import { Button } from '@/components/ui/button';
import { Carousel } from '@/components/ui/carousel';
import { ROUTES } from '@/constants/routes';
import type { ProductCardView } from '@/services/product.service';

/**
 * Best sellers.
 *
 * A horizontal rail rather than a grid, so the section reads differently from
 * "Trending" further down the page while showing the same object type.
 *
 * Sits on the muted surface to separate it from the white sections either side
 * without introducing another accent colour.
 *
 * Reads the catalog. It used to render a hand-written array from phase 2, back
 * when there was no catalog to read — which meant the homepage advertised ten
 * products that were never seeded, each linking to a 404. Static content that
 * names live records goes stale the moment the records change, and nothing
 * fails loudly when it does.
 */
export function BestSellersSection({ products: bestSellers }: { products: ProductCardView[] }) {
  if (bestSellers.length === 0) return null;

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
