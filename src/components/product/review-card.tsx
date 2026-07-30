import { BadgeCheck } from 'lucide-react';

import { Rating } from '@/components/ui/rating';
import { cn } from '@/utils/cn';

export interface ReviewCardData {
  id: string;
  author: string;
  location?: string;
  rating: number;
  title: string;
  body: string;
  productName?: string;
  verified?: boolean;
}

export interface ReviewCardProps {
  review: ReviewCardData;
  fixedWidth?: boolean;
  className?: string;
}

/**
 * Testimonial card.
 *
 * Marked up as a `<figure>`/`<blockquote>`/`<figcaption>`, which is the correct
 * semantic for an attributed quotation — and gives search engines a much better
 * chance of understanding it as review content.
 *
 * The verified badge is the single strongest trust signal on the page, so it is
 * text plus icon rather than an icon alone.
 */
export function ReviewCard({ review, fixedWidth = false, className }: ReviewCardProps) {
  return (
    <figure
      className={cn(
        'flex h-full flex-col rounded-2xl border border-border bg-surface p-6 sm:p-7',
        fixedWidth && 'w-[20rem] sm:w-[24rem]',
        className,
      )}
    >
      <Rating value={review.rating} hideCount size="sm" />

      <blockquote className="mt-4 flex-1">
        <p className="font-display text-lg leading-snug tracking-tight text-foreground">
          {review.title}
        </p>
        <p className="mt-3 text-body-sm leading-relaxed text-foreground-muted">{review.body}</p>
      </blockquote>

      <figcaption className="mt-6 flex items-center gap-3 border-t border-border pt-5">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft font-display text-base text-accent-text"
        >
          {review.author.charAt(0)}
        </span>

        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-body-sm font-medium text-foreground">
            {review.author}
            {review.verified ? (
              <>
                <BadgeCheck aria-hidden="true" className="size-4 text-success-600" />
                <span className="sr-only">Verified buyer</span>
              </>
            ) : null}
          </span>
          <span className="block truncate text-xs text-foreground-subtle">
            {review.location ? `${review.location} · ` : ''}
            {review.productName ?? 'Verified purchase'}
          </span>
        </span>
      </figcaption>
    </figure>
  );
}
