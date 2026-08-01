import 'server-only';

import { randomBytes } from 'node:crypto';

import { errors } from '@/lib/api/errors';
import { prisma } from '@/lib/prisma';
import { getProductsByIds } from '@/services/product.service';

/**
 * The wishlist, server side.
 *
 * ## Two stores, one list
 *
 * A guest's wishlist lives in `localStorage` (`gt.wishlist`) so it works without
 * an account. A signed-in customer's lives here, so it survives a new laptop.
 * `mergeLocalWishlist` folds the first into the second at sign-in — the same
 * bargain the cart makes, and for the same reason: the work someone did before
 * registering should not be the price of registering.
 *
 * The client keeps writing to `localStorage` either way. That is deliberate:
 * toggling a heart stays instant, and the server copy catches up.
 */

/** One wishlist per customer for now; the model already allows several. */
async function defaultWishlist(userId: string) {
  const existing = await prisma.wishlist.findFirst({
    where: { userId, isDefault: true },
    select: { id: true },
  });

  if (existing) return existing;

  return prisma.wishlist.create({
    data: { userId, isDefault: true, name: 'My Wishlist' },
    select: { id: true },
  });
}

export async function getWishlist(userId: string) {
  const wishlist = await prisma.wishlist.findFirst({
    where: { userId, isDefault: true },
    include: { items: { orderBy: { createdAt: 'desc' } } },
  });

  if (!wishlist) return { id: null, shareToken: null, items: [] };

  // Cards come from the catalogue service rather than a select of our own, so a
  // saved product renders through exactly the same component as a listing card
  // and a price or badge change lands in both at once.
  const cards = await getProductsByIds(wishlist.items.map((item) => item.productId));
  const byId = new Map(cards.map((card) => [card.id, card]));

  return {
    id: wishlist.id,
    shareToken: wishlist.shareToken,
    items: wishlist.items
      .map((item) => {
        const product = byId.get(item.productId);
        // Dropped rather than rendered as a gap: the product was archived or
        // deleted after it was saved.
        if (!product) return null;

        return { id: item.id, addedAt: item.createdAt, variantId: item.variantId, product };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null),
  };
}

export async function countWishlist(userId: string): Promise<number> {
  return prisma.wishlistItem.count({ where: { wishlist: { userId } } });
}

export async function addToWishlist(
  userId: string,
  productId: string,
  variantId?: string | null,
): Promise<void> {
  const wishlist = await defaultWishlist(userId);

  // Unique on (wishlist, product, variant), so a double-tap is a no-op rather
  // than a duplicate row or an error the customer has to read.
  await prisma.wishlistItem
    .create({ data: { wishlistId: wishlist.id, productId, variantId: variantId ?? null } })
    .catch(() => undefined);
}

export async function removeFromWishlist(userId: string, productId: string): Promise<void> {
  await prisma.wishlistItem.deleteMany({ where: { wishlist: { userId }, productId } });
}

export async function clearWishlist(userId: string): Promise<void> {
  await prisma.wishlistItem.deleteMany({ where: { wishlist: { userId } } });
}

/**
 * Folds a guest's local wishlist into their account.
 *
 * Union, never replace. Someone who saved three things signed out and two signed
 * in expects five, and losing either set is the kind of thing that stops people
 * bothering to sign in at all.
 *
 * Returns the merged product ids so the client can write the union straight back
 * to `localStorage` without a second round trip.
 */
export async function mergeLocalWishlist(
  userId: string,
  localProductIds: string[],
): Promise<string[]> {
  if (localProductIds.length > 0) {
    const wishlist = await defaultWishlist(userId);

    // Filter to products that still exist — a stale id from an old browser
    // otherwise fails the whole insert on a foreign key.
    const live = await prisma.product.findMany({
      where: { id: { in: localProductIds.slice(0, 200) }, deletedAt: null },
      select: { id: true },
    });

    if (live.length > 0) {
      await prisma.wishlistItem.createMany({
        data: live.map((product) => ({ wishlistId: wishlist.id, productId: product.id })),
        skipDuplicates: true,
      });
    }
  }

  const merged = await prisma.wishlistItem.findMany({
    where: { wishlist: { userId } },
    select: { productId: true },
  });

  return merged.map((item) => item.productId);
}

/**
 * Makes a wishlist shareable, minting a token on first use.
 *
 * An unguessable token rather than the wishlist id: the id appears in our own
 * URLs and logs, and a share link gets pasted into group chats. Revoking is
 * setting it back to null, which is why sharing is a toggle rather than a
 * one-way door.
 *
 * This store sells adult products, so a share link is a genuine privacy surface —
 * hence `noindex` on the public page and no name attached to it.
 */
export async function setShared(userId: string, shared: boolean): Promise<string | null> {
  const wishlist = await defaultWishlist(userId);

  if (!shared) {
    await prisma.wishlist.update({ where: { id: wishlist.id }, data: { shareToken: null } });
    return null;
  }

  const current = await prisma.wishlist.findUnique({
    where: { id: wishlist.id },
    select: { shareToken: true },
  });

  if (current?.shareToken) return current.shareToken;

  const shareToken = randomBytes(18).toString('base64url');
  await prisma.wishlist.update({ where: { id: wishlist.id }, data: { shareToken } });

  return shareToken;
}

/**
 * A shared wishlist, by token.
 *
 * Returns no owner details — a share link reveals what someone likes, and it does
 * not need to also reveal who they are to whoever the link gets forwarded to.
 */
export async function getSharedWishlist(shareToken: string) {
  const wishlist = await prisma.wishlist.findUnique({
    where: { shareToken },
    include: { items: { orderBy: { createdAt: 'desc' } } },
  });

  if (!wishlist) throw errors.notFound('Wishlist');

  return {
    name: wishlist.name,
    items: await getProductsByIds(wishlist.items.map((item) => item.productId)),
  };
}
