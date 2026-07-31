import 'server-only';

import type { Prisma } from '@/generated/prisma/client';
import type { ReviewFilter, ReviewSort } from '@/features/catalog/schemas';
import { prisma } from '@/lib/prisma';

/**
 * Review reads and the rating rollup.
 *
 * Only `APPROVED` reviews are ever visible. Moderation defaults to on
 * (`reviews.requireModeration` in `Setting`), because an unmoderated review feed
 * on an adult-products site attracts exactly the content you would expect.
 */

const REVIEWS_PER_PAGE = 8;

const REVIEW_SELECT = {
  id: true,
  authorName: true,
  rating: true,
  title: true,
  body: true,
  isVerifiedPurchase: true,
  helpfulCount: true,
  createdAt: true,
  images: {
    orderBy: { position: 'asc' },
    select: { id: true, url: true, publicId: true, alt: true },
  },
} satisfies Prisma.ReviewSelect;

function buildOrderBy(sort: ReviewSort): Prisma.ReviewOrderByWithRelationInput[] {
  switch (sort) {
    case 'newest':
      return [{ createdAt: 'desc' }, { id: 'asc' }];
    case 'highest':
      return [{ rating: 'desc' }, { helpfulCount: 'desc' }, { id: 'asc' }];
    case 'lowest':
      return [{ rating: 'asc' }, { helpfulCount: 'desc' }, { id: 'asc' }];
    case 'helpful':
    default:
      // Default to most helpful, not newest: the review that answered other
      // people's question is the one most likely to answer this visitor's.
      return [{ helpfulCount: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }];
  }
}

export async function listProductReviews(productId: string, filter: ReviewFilter) {
  const where: Prisma.ReviewWhereInput = {
    productId,
    status: 'APPROVED',
    ...(filter.rating ? { rating: filter.rating } : {}),
    ...(filter.withPhotos ? { images: { some: {} } } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.review.findMany({
      where,
      orderBy: buildOrderBy(filter.sort),
      skip: (filter.page - 1) * REVIEWS_PER_PAGE,
      take: REVIEWS_PER_PAGE,
      select: REVIEW_SELECT,
    }),
    prisma.review.count({ where }),
  ]);

  return {
    items,
    total,
    page: filter.page,
    pageSize: REVIEWS_PER_PAGE,
    totalPages: Math.max(1, Math.ceil(total / REVIEWS_PER_PAGE)),
  };
}

export type ReviewListItem = Awaited<ReturnType<typeof listProductReviews>>['items'][number];

export interface RatingSummary {
  average: number;
  total: number;
  /** Count per star, 5 down to 1, plus the share as a fraction for the bars. */
  distribution: { stars: number; count: number; share: number }[];
  verifiedCount: number;
  withPhotosCount: number;
}

/**
 * Rating breakdown.
 *
 * One `groupBy` rather than five counts. The distribution bars are what let a
 * shopper judge whether a 4.6 average is "consistently good" or "mostly
 * five-star with a few disasters" — which changes the buying decision.
 */
export async function getRatingSummary(productId: string): Promise<RatingSummary> {
  const [grouped, verifiedCount, withPhotosCount] = await Promise.all([
    prisma.review.groupBy({
      by: ['rating'],
      where: { productId, status: 'APPROVED' },
      _count: { rating: true },
    }),
    prisma.review.count({ where: { productId, status: 'APPROVED', isVerifiedPurchase: true } }),
    prisma.review.count({ where: { productId, status: 'APPROVED', images: { some: {} } } }),
  ]);

  const counts = new Map(grouped.map((row) => [row.rating, row._count.rating]));
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const weighted = [...counts.entries()].reduce((sum, [stars, count]) => sum + stars * count, 0);

  return {
    average: total ? Number((weighted / total).toFixed(2)) : 0,
    total,
    distribution: [5, 4, 3, 2, 1].map((stars) => {
      const count = counts.get(stars) ?? 0;
      return { stars, count, share: total ? count / total : 0 };
    }),
    verifiedCount,
    withPhotosCount,
  };
}

/**
 * Recomputes and stores the denormalised rollup on `Product`.
 *
 * Called after any review is approved, rejected or deleted. The listing page
 * reads `Product.ratingAverage`, so if this is not called the stars on the grid
 * drift away from the stars on the product page.
 */
export async function recalculateProductRating(productId: string): Promise<void> {
  const result = await prisma.review.aggregate({
    where: { productId, status: 'APPROVED' },
    _avg: { rating: true },
    _count: { rating: true },
  });

  await prisma.product.update({
    where: { id: productId },
    data: {
      ratingAverage: Number((result._avg.rating ?? 0).toFixed(2)),
      ratingCount: result._count.rating,
    },
  });
}

/**
 * Records a helpfulness vote.
 *
 * Upsert on the composite key, so a customer can change their mind but cannot
 * vote twice — the reason `ReviewVote` exists rather than a bare counter.
 * `helpfulCount` is then recomputed from the truth rather than incremented.
 */
export async function voteReviewHelpful(
  reviewId: string,
  userId: string,
  isHelpful: boolean,
): Promise<number> {
  await prisma.reviewVote.upsert({
    where: { reviewId_userId: { reviewId, userId } },
    update: { isHelpful },
    create: { reviewId, userId, isHelpful },
  });

  const helpfulCount = await prisma.reviewVote.count({ where: { reviewId, isHelpful: true } });

  await prisma.review.update({ where: { id: reviewId }, data: { helpfulCount } });

  return helpfulCount;
}
