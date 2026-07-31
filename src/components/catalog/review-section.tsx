import { BadgeCheck, Camera } from 'lucide-react';

import { MediaPlaceholder } from '@/components/common/media-placeholder';
import { ReviewFilters } from '@/components/catalog/review-filters';
import { Badge } from '@/components/ui/badge';
import { Pagination } from '@/components/ui/pagination';
import { Rating } from '@/components/ui/rating';
import type { RatingSummary, ReviewListItem } from '@/services/review.service';
import { formatDate } from '@/utils/format';

export interface ReviewSectionProps {
  summary: RatingSummary;
  reviews: ReviewListItem[];
  page: number;
  totalPages: number;
  /** Builds a page href preserving the current review filters. */
  buildHref: (page: number) => string;
}

/**
 * Customer reviews.
 *
 * A server component; only the filter and sort controls hydrate. Reviews are
 * server-rendered because they are indexable content — a review block that
 * appears only after a client fetch contributes nothing to the product page's
 * search relevance, which is most of its commercial value.
 *
 * Every review shown is `APPROVED` and marked verified where applicable. Mixing
 * unverified testimonials in here would be an FTC endorsement-guidelines problem
 * for a US retailer, not merely a trust one.
 */
export function ReviewSection({
  summary,
  reviews,
  page,
  totalPages,
  buildHref,
}: ReviewSectionProps) {
  return (
    <section aria-labelledby="reviews-heading" className="scroll-mt-28" id="reviews">
      <h2 id="reviews-heading" className="text-display-md text-foreground">
        Customer reviews
      </h2>

      <div className="mt-8 grid gap-10 lg:grid-cols-[18rem_1fr] lg:gap-14">
        <div>
          <div className="rounded-2xl border border-border p-6">
            <p className="flex items-baseline gap-2">
              <span className="font-display text-display-md tracking-tight text-foreground">
                {summary.average.toFixed(1)}
              </span>
              <span className="text-body-sm text-foreground-muted">out of 5</span>
            </p>

            <Rating value={summary.average} hideCount className="mt-2" />

            <p className="mt-2 text-body-sm text-foreground-muted">
              {summary.total} {summary.total === 1 ? 'review' : 'reviews'}
            </p>

            {/* Distribution bars: a 4.6 built from consistent fours reads very
                differently from one built from fives and ones. */}
            <ul className="mt-6 space-y-2">
              {summary.distribution.map((row) => (
                <li key={row.stars} className="flex items-center gap-2.5 text-xs">
                  <span className="w-10 shrink-0 text-foreground-muted">{row.stars} star</span>
                  <span
                    className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100"
                    role="img"
                    aria-label={`${row.count} of ${summary.total} reviews are ${row.stars} star`}
                  >
                    <span
                      className="block h-full rounded-full bg-warning-500"
                      style={{ width: `${Math.round(row.share * 100)}%` }}
                    />
                  </span>
                  <span className="w-8 shrink-0 text-right text-foreground-subtle">
                    {row.count}
                  </span>
                </li>
              ))}
            </ul>

            <dl className="mt-6 space-y-1.5 border-t border-border pt-5 text-xs text-foreground-muted">
              <div className="flex justify-between gap-2">
                <dt>Verified purchases</dt>
                <dd className="font-medium text-foreground">{summary.verifiedCount}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>With photos</dt>
                <dd className="font-medium text-foreground">{summary.withPhotosCount}</dd>
              </div>
            </dl>
          </div>
        </div>

        <div>
          <ReviewFilters summary={summary} />

          {reviews.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-8 text-center text-body-sm text-foreground-muted">
              No reviews match those filters yet.
            </p>
          ) : (
            <ol className="divide-y divide-border">
              {reviews.map((review) => (
                <li key={review.id} className="py-7 first:pt-4">
                  <article>
                    <div className="flex flex-wrap items-center gap-3">
                      <Rating value={review.rating} hideCount size="sm" />
                      {review.isVerifiedPurchase ? (
                        <Badge variant="success" size="sm">
                          <BadgeCheck aria-hidden="true" />
                          Verified purchase
                        </Badge>
                      ) : null}
                    </div>

                    <h3 className="mt-3 font-display text-lg tracking-tight text-foreground">
                      {review.title ?? 'Review'}
                    </h3>

                    <p className="mt-2 text-body-sm leading-relaxed text-foreground-muted">
                      {review.body}
                    </p>

                    {review.images.length ? (
                      <ul className="mt-4 flex gap-2">
                        {review.images.map((image) => (
                          <li key={image.id} className="w-20">
                            <MediaPlaceholder
                              seed={image.publicId ?? image.id}
                              ratio="square"
                              tone="neutral"
                              className="rounded-lg"
                              aria-label={image.alt ?? 'Customer photo'}
                            />
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    <footer className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground-subtle">
                      <span className="font-medium text-foreground">{review.authorName}</span>
                      <time dateTime={review.createdAt.toISOString()}>
                        {formatDate(review.createdAt)}
                      </time>
                      {review.helpfulCount > 0 ? (
                        <span>{review.helpfulCount} found this helpful</span>
                      ) : null}
                      {review.images.length ? (
                        <span className="inline-flex items-center gap-1">
                          <Camera aria-hidden="true" className="size-3" />
                          {review.images.length}
                        </span>
                      ) : null}
                    </footer>
                  </article>
                </li>
              ))}
            </ol>
          )}

          <Pagination page={page} totalPages={totalPages} buildHref={buildHref} className="mt-8" />
        </div>
      </div>
    </section>
  );
}
