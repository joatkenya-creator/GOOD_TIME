import { Container } from '@/components/layout/container';
import { Reveal } from '@/components/motion/reveal';
import { ReviewCard } from '@/components/product/review-card';
import { Carousel } from '@/components/ui/carousel';
import { Rating } from '@/components/ui/rating';
import { reviews } from '@/features/home/content';

/**
 * Customer reviews.
 *
 * Leads with the aggregate rating, because a single number does more for trust
 * than any individual quote — then lets the quotes do the specific work.
 *
 * Every card is a verified purchase. Mixing unverified testimonials in here
 * would be both a conversion liability and, for a US retailer, an FTC
 * endorsement-guidelines problem.
 */
export function ReviewsSection() {
  const average = reviews.reduce((total, review) => total + review.rating, 0) / reviews.length;

  return (
    <section
      aria-labelledby="reviews-title"
      className="border-y border-border bg-surface-muted py-(--spacing-section)"
    >
      <Container>
        <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-xl">
            <p className="text-eyebrow text-accent-text uppercase">Customer reviews</p>
            <h2 id="reviews-title" className="mt-3 text-display-lg text-foreground">
              Reviewed by people who bought it
            </h2>
          </div>

          <div className="flex items-center gap-4 rounded-2xl border border-border bg-surface px-5 py-4">
            <span className="font-display text-display-sm tracking-tight text-foreground">
              {average.toFixed(1)}
            </span>
            <span>
              <Rating value={average} hideCount size="sm" />
              <span className="mt-1 block text-xs text-foreground-muted">
                Based on 8,412 verified reviews
              </span>
            </span>
          </div>
        </div>

        <Reveal>
          <Carousel label="Customer reviews">
            {reviews.map((review) => (
              <ReviewCard key={review.id} review={review} fixedWidth />
            ))}
          </Carousel>
        </Reveal>
      </Container>
    </section>
  );
}
