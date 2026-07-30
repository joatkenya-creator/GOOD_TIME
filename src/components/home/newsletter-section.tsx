import { Container } from '@/components/layout/container';
import { NewsletterForm } from '@/components/forms/newsletter-form';
import { Reveal } from '@/components/motion/reveal';
import { newsletter } from '@/features/home/content';

/**
 * Newsletter capture.
 *
 * Placed late rather than as an interstitial popup. A modal on arrival lifts
 * raw signup rate and costs more in bounce and brand damage than it returns —
 * particularly in a category where the visitor is already cautious.
 *
 * Centred on a brand tint, which is the only place the pink surface appears at
 * full section width.
 */
export function NewsletterSection() {
  return (
    <section aria-labelledby="newsletter-title" className="py-(--spacing-section)">
      <Container>
        <Reveal>
          <div className="overflow-hidden rounded-3xl bg-accent-soft px-7 py-14 text-center sm:px-12 sm:py-20">
            <div className="mx-auto max-w-xl">
              <p className="text-eyebrow text-accent-text uppercase">{newsletter.eyebrow}</p>

              <h2 id="newsletter-title" className="mt-4 text-display-md text-foreground">
                {newsletter.title}
              </h2>

              <p className="mt-4 text-body leading-relaxed text-foreground-muted">
                {newsletter.description}
              </p>

              <div className="mx-auto mt-8 max-w-md text-left">
                <NewsletterForm />
              </div>
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
