import 'server-only';

import { prisma } from '@/lib/prisma';
import {
  getProductsByIds,
  listProducts,
  type ProductCardView,
} from '@/services/product.service';

/**
 * Product recommendations.
 *
 * ## The seam
 *
 * Every function here returns `ProductCardView[]` and takes a customer plus a
 * context. That signature is the contract an eventual recommendation service —
 * hosted, learned, or bought — has to satisfy. Nothing above this file knows how
 * a list was produced, which is what makes replacing the *how* a one-file change.
 *
 * ## What is implemented, and why it is not machine learning
 *
 * Heuristics over the data we already have: what you bought, what you looked at,
 * what sells. They are cheap, they are explainable to a customer who asks why
 * they are seeing something, and they need no training data — which a store that
 * has not launched does not have. A model trained on an empty order table
 * recommends noise with more confidence than a rule does.
 *
 * The honest ceiling: none of this personalises beyond one customer's own
 * history. Collaborative filtering ("customers like you also bought") needs
 * traffic this store has not seen yet, and `frequentlyBoughtTogether` below is
 * the co-purchase query that becomes its input.
 */

const MAX = 12;

/** Excludes what someone already owns or has in front of them. */
function without(cards: ProductCardView[], excludeIds: Set<string>, limit: number) {
  return cards.filter((card) => !excludeIds.has(card.id)).slice(0, limit);
}

/**
 * The dashboard's main rail.
 *
 * Walks a ladder from most personal to least, stopping once it has enough:
 * things you looked at but did not buy, then more from the categories you buy
 * from, then what is simply popular. A new customer with no history still gets a
 * full, sensible rail rather than an empty one.
 */
export async function recommendedForCustomer(
  userId: string,
  limit = 8,
): Promise<{ items: ProductCardView[]; basis: string }> {
  const purchased = await purchasedProductIds(userId);
  const exclude = new Set(purchased);

  // 1. Viewed, not bought. The strongest signal a customer gives us for free.
  const viewed = await prisma.recentlyViewed.findMany({
    where: { userId, productId: { notIn: purchased.length ? purchased : ['-'] } },
    orderBy: { viewedAt: 'desc' },
    take: limit * 2,
    select: { productId: true },
  });

  const viewedCards = await getProductsByIds(viewed.map((row) => row.productId));
  if (viewedCards.length >= limit) {
    return { items: without(viewedCards, new Set(), limit), basis: 'Based on what you viewed' };
  }

  // 2. More from the categories they actually buy from.
  const categories = await purchasedCategoryIds(userId);
  // Category filtering goes through `listProducts`' `extra` predicate rather than
  // its filter shape: the filter speaks in category *paths* because that is what a
  // URL carries, and we already have ids.
  const fromCategories = categories.length
    ? (
        await listProducts(
          { sort: 'best_selling', limit: limit * 2 },
          { primaryCategoryId: { in: categories } },
        )
      ).items
    : [];

  const merged = [...viewedCards, ...without(fromCategories, exclude, limit)];
  if (merged.length >= limit) {
    return { items: dedupe(merged).slice(0, limit), basis: 'Picked for you' };
  }

  // 3. Popular. Not personal, but never empty.
  const popular = (await listProducts({ sort: 'best_selling', limit: limit * 2 })).items;

  return {
    items: dedupe([...merged, ...without(popular, exclude, limit)]).slice(0, limit),
    basis: merged.length > 0 ? 'Picked for you' : 'Popular right now',
  };
}

/**
 * What people who bought this also bought.
 *
 * A real co-purchase query over order history, not a curated list. Two joins back
 * through `OrderItem` — orders containing this product, then the other products
 * in those orders — ranked by how often they co-occur.
 *
 * Returns nothing until there is order history to learn from, and that is the
 * correct behaviour: an empty rail is honest, a fabricated one is not.
 */
export async function frequentlyBoughtTogether(
  productId: string,
  limit = 4,
): Promise<ProductCardView[]> {
  const rows = await prisma.$queryRaw<{ productId: string; orders: bigint }[]>`
    SELECT other."variantId" AS "variantId",
           v."productId"     AS "productId",
           COUNT(DISTINCT other."orderId") AS orders
    FROM order_items mine
    JOIN order_items other ON other."orderId" = mine."orderId" AND other.id <> mine.id
    JOIN variants v ON v.id = other."variantId"
    JOIN variants mv ON mv.id = mine."variantId"
    WHERE mv."productId" = ${productId}
      AND v."productId" <> ${productId}
    GROUP BY other."variantId", v."productId"
    ORDER BY orders DESC
    LIMIT ${limit * 2}
  `;

  if (rows.length === 0) return [];

  const unique = [...new Set(rows.map((row) => row.productId))].slice(0, limit);
  return getProductsByIds(unique);
}

/**
 * Products bought before, for a one-tap reorder.
 *
 * Consumables — lubricant, batteries, cleaner — are the repeat purchase in this
 * category, and finding them again through the catalogue is friction that costs a
 * sale someone had already decided to make.
 */
export async function recentlyPurchased(userId: string, limit = 8): Promise<ProductCardView[]> {
  const ids = await purchasedProductIds(userId, limit * 2);
  return (await getProductsByIds(ids)).slice(0, limit);
}

/**
 * Where they left off.
 *
 * Just the browsing history, framed as an invitation rather than a log. The
 * difference is only in the heading, and the heading is what makes it useful.
 */
export async function continueShopping(userId: string, limit = 8): Promise<ProductCardView[]> {
  const viewed = await prisma.recentlyViewed.findMany({
    where: { userId },
    orderBy: { viewedAt: 'desc' },
    take: limit,
    select: { productId: true },
  });

  return getProductsByIds(viewed.map((row) => row.productId));
}

/** What is selling now. The fallback that is never empty and never personal. */
export async function trending(limit = 8): Promise<ProductCardView[]> {
  return (await listProducts({ sort: 'best_selling', limit })).items;
}

async function purchasedProductIds(userId: string, take = MAX * 4): Promise<string[]> {
  const items = await prisma.orderItem.findMany({
    where: {
      order: { userId, status: { notIn: ['CANCELLED', 'PENDING'] } },
      variantId: { not: null },
    },
    orderBy: { order: { createdAt: 'desc' } },
    take,
    select: { variant: { select: { productId: true } } },
  });

  return [
    ...new Set(
      items
        .map((item) => item.variant?.productId)
        .filter((id): id is string => typeof id === 'string'),
    ),
  ];
}

async function purchasedCategoryIds(userId: string): Promise<string[]> {
  const items = await prisma.orderItem.findMany({
    where: { order: { userId, status: { notIn: ['CANCELLED', 'PENDING'] } } },
    take: MAX * 4,
    select: { variant: { select: { product: { select: { primaryCategoryId: true } } } } },
  });

  return [
    ...new Set(
      items
        .map((item) => item.variant?.product.primaryCategoryId)
        .filter((id): id is string => typeof id === 'string'),
    ),
  ];
}

function dedupe(cards: ProductCardView[]): ProductCardView[] {
  const seen = new Set<string>();
  return cards.filter((card) => (seen.has(card.id) ? false : (seen.add(card.id), true)));
}

/**
 * Records a product view against a signed-in customer.
 *
 * Guests keep their history in `localStorage` — see `recentlyViewedStore`. This
 * is the durable copy, and the input to every heuristic above.
 */
export async function recordView(userId: string, productId: string): Promise<void> {
  await prisma.recentlyViewed
    .upsert({
      where: { userId_productId: { userId, productId } },
      update: { viewedAt: new Date() },
      create: { userId, productId },
    })
    .catch(() => undefined);
}

export async function getRecentlyViewed(userId: string, limit = 24) {
  const rows = await prisma.recentlyViewed.findMany({
    where: { userId },
    orderBy: { viewedAt: 'desc' },
    take: limit,
    select: { productId: true, viewedAt: true },
  });

  const cards = await getProductsByIds(rows.map((row) => row.productId));
  const byId = new Map(cards.map((card) => [card.id, card]));

  return rows
    .map((row) => {
      const product = byId.get(row.productId);
      return product ? { product, viewedAt: row.viewedAt } : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

export async function removeFromHistory(userId: string, productId: string): Promise<void> {
  await prisma.recentlyViewed.deleteMany({ where: { userId, productId } });
}

export async function clearHistory(userId: string): Promise<void> {
  await prisma.recentlyViewed.deleteMany({ where: { userId } });
}
