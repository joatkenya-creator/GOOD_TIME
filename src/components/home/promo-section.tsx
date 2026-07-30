import { Container } from '@/components/layout/container';
import { PromoBanner } from '@/components/common/promo-banner';
import { Reveal } from '@/components/motion/reveal';
import { promo } from '@/features/home/content';

/**
 * Seasonal promotion.
 *
 * The only high-contrast interruption on the page. One promotional banner reads
 * as an offer; three read as a discount site, which is the opposite of the
 * positioning everything else is working towards.
 */
export function PromoSection() {
  return (
    <section className="py-(--spacing-section)">
      <Container>
        <Reveal>
          <PromoBanner
            eyebrow={promo.eyebrow}
            title={promo.title}
            description={promo.description}
            href={promo.href}
            cta={promo.cta}
            secondary={promo.secondary}
            imageSeed={promo.imageSeed}
            terms={promo.terms}
          />
        </Reveal>
      </Container>
    </section>
  );
}
