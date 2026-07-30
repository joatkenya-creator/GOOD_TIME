import { Container } from '@/components/layout/container';
import { FeatureCard } from '@/components/common/feature-card';
import { Reveal } from '@/components/motion/reveal';
import { whyShopWithUs } from '@/features/home/content';

/**
 * Why shop with us.
 *
 * Positioned immediately after the first product section, which is where a
 * first-time visitor in this category starts asking "can I trust this shop with
 * my address and my card". Answering it there, rather than in the footer, is the
 * single highest-leverage placement on the page.
 */
export function WhyShopSection() {
  return (
    <section
      aria-labelledby="why-shop-title"
      className="border-y border-border bg-surface-muted py-(--spacing-section)"
    >
      <Container>
        <div className="mb-12 max-w-2xl">
          <p className="text-eyebrow text-accent-text uppercase">Why shop with us</p>
          <h2 id="why-shop-title" className="mt-3 text-display-lg text-foreground">
            The boring parts, done properly
          </h2>
        </div>

        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {whyShopWithUs.map((feature, index) => (
            <li key={feature.title}>
              <Reveal delay={Math.min(index * 0.07, 0.28)}>
                <FeatureCard feature={feature} className="h-full" />
              </Reveal>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
