import { Container } from '@/components/layout/container';
import { Reveal } from '@/components/motion/reveal';
import { CollectionCard } from '@/components/product/collection-card';
import { collections } from '@/features/home/content';

/**
 * Featured collections.
 *
 * Alternating full-width editorial rows — the slowest, most deliberate section
 * on the page. Collections sell a mood rather than a SKU, so they get whitespace
 * and long-form copy instead of a price and a badge.
 */
export function CollectionsSection() {
  return (
    <section aria-labelledby="collections-title" className="py-(--spacing-section)">
      <Container>
        <div className="mb-14 max-w-2xl">
          <p className="text-eyebrow text-accent-text uppercase">Collections</p>
          <h2 id="collections-title" className="mt-3 text-display-lg text-foreground">
            Edits with a point of view
          </h2>
          <p className="mt-4 text-body leading-relaxed text-foreground-muted">
            Each one is assembled by hand around a single idea, not generated from whatever is in
            stock.
          </p>
        </div>

        <div className="space-y-20 lg:space-y-28">
          {collections.map((collection, index) => (
            <Reveal key={collection.slug} direction={index % 2 === 0 ? 'up' : 'up'}>
              <CollectionCard
                collection={collection}
                href={collection.href}
                reversed={index % 2 === 1}
              />
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
