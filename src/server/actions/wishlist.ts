'use server';

import { revalidatePath } from 'next/cache';

import { returnRequestSchema } from '@/features/account/schemas';
import { isAppError } from '@/lib/api/errors';
import { logger } from '@/lib/logger';
import { getSessionUser, requireUser } from '@/server/auth/session';
import { addToCart } from '@/services/cart.service';
import * as history from '@/services/recommendation.service';
import * as returns from '@/services/return.service';
import * as wishlist from '@/services/wishlist.service';

/**
 * Wishlist, browsing history and returns.
 *
 * The wishlist actions are no-ops for a guest rather than errors: a guest's list
 * lives in `localStorage` and is already correct without the server. Failing here
 * would make the heart button throw for exactly the people most likely to be
 * browsing anonymously.
 */

export interface ActionResult {
  ok: boolean;
  message: string;
  count?: number;
}

function fail(error: unknown): ActionResult {
  if (isAppError(error)) return { ok: false, message: error.message };
  logger.error('wishlist.action_failed', error);
  return { ok: false, message: 'Something went wrong. Please try again.' };
}

// --------------------------------------------------------------------- wishlist

export async function syncWishlistAction(productId: string, saved: boolean): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: true, message: 'Saved on this device.' };

  try {
    if (saved) await wishlist.addToWishlist(user.id, productId);
    else await wishlist.removeFromWishlist(user.id, productId);

    revalidatePath('/account/wishlist');

    return {
      ok: true,
      message: saved ? 'Saved to your wishlist.' : 'Removed from your wishlist.',
      count: await wishlist.countWishlist(user.id),
    };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Folds a guest's local list into the account copy at sign-in.
 *
 * Returns the union so the client can write it straight back to `localStorage`
 * without a second round trip.
 */
export async function mergeWishlistAction(localProductIds: string[]): Promise<{
  ok: boolean;
  productIds: string[];
}> {
  const user = await getSessionUser();
  if (!user) return { ok: false, productIds: localProductIds };

  try {
    const merged = await wishlist.mergeLocalWishlist(user.id, localProductIds.slice(0, 200));
    revalidatePath('/account/wishlist');
    return { ok: true, productIds: merged };
  } catch (error) {
    logger.warn('wishlist.merge_failed', { error });
    return { ok: false, productIds: localProductIds };
  }
}

export async function moveWishlistItemToCartAction(
  productId: string,
  variantId: string,
): Promise<ActionResult> {
  const user = await getSessionUser();

  try {
    await addToCart(variantId, 1, user?.id ?? null);
    if (user) await wishlist.removeFromWishlist(user.id, productId);

    revalidatePath('/account/wishlist');
    revalidatePath('/cart');

    const { getCartCount } = await import('@/services/cart.service');

    return {
      ok: true,
      message: 'Moved to your bag.',
      // Returned so the header badge updates from this reply rather than a
      // second round trip — see `use-cart-count`.
      count: await getCartCount(user?.id ?? null),
    };
  } catch (error) {
    return fail(error);
  }
}

export async function setWishlistSharedAction(shared: boolean): Promise<{
  ok: boolean;
  message: string;
  shareToken: string | null;
}> {
  const user = await requireUser();

  try {
    const shareToken = await wishlist.setShared(user.id, shared);
    revalidatePath('/account/wishlist');

    return {
      ok: true,
      message: shared
        ? 'Your wishlist is now shareable.'
        : 'Sharing turned off. The old link no longer works.',
      shareToken,
    };
  } catch (error) {
    return { ...fail(error), shareToken: null };
  }
}

export async function clearWishlistAction(): Promise<ActionResult> {
  const user = await requireUser();

  try {
    await wishlist.clearWishlist(user.id);
    revalidatePath('/account/wishlist');
    return { ok: true, message: 'Wishlist cleared.', count: 0 };
  } catch (error) {
    return fail(error);
  }
}

// ---------------------------------------------------------------------- history

export async function removeFromHistoryAction(productId: string): Promise<ActionResult> {
  const user = await requireUser();

  try {
    await history.removeFromHistory(user.id, productId);
    revalidatePath('/account/recently-viewed');
    return { ok: true, message: 'Removed from your history.' };
  } catch (error) {
    return fail(error);
  }
}

export async function clearHistoryAction(): Promise<ActionResult> {
  const user = await requireUser();

  try {
    await history.clearHistory(user.id);
    revalidatePath('/account/recently-viewed');
    return { ok: true, message: 'Browsing history cleared.' };
  } catch (error) {
    return fail(error);
  }
}

// ---------------------------------------------------------------------- returns

export async function requestReturnAction(input: {
  orderId: string;
  reason: string;
  comment?: string;
  items: { orderItemId: string; quantity: number }[];
}): Promise<ActionResult & { returnNumber?: string }> {
  const user = await requireUser();

  const parsed = returnRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Check the form and try again.',
    };
  }

  try {
    const request = await returns.createReturn({
      orderId: parsed.data.orderId,
      userId: user.id,
      reason: parsed.data.reason as Parameters<typeof returns.createReturn>[0]['reason'],
      comment: parsed.data.comment || null,
      items: parsed.data.items,
    });

    revalidatePath('/account/returns');
    revalidatePath('/account/orders');

    return {
      ok: true,
      message: `Return ${request.returnNumber} requested. We will review it within two working days.`,
      returnNumber: request.returnNumber,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function cancelReturnAction(returnNumber: string): Promise<ActionResult> {
  const user = await requireUser();

  try {
    await returns.cancelReturn(user.id, returnNumber);
    revalidatePath('/account/returns');
    return { ok: true, message: 'Return cancelled.' };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Puts a past order's items back in the bag.
 *
 * Skips anything no longer purchasable rather than failing the whole reorder, and
 * says how many were skipped — a reorder that silently drops two of five items is
 * worse than one that explains itself.
 */
export async function reorderAction(orderId: string): Promise<ActionResult> {
  const user = await requireUser();

  try {
    const { prisma } = await import('@/lib/prisma');

    const order = await prisma.order.findFirst({
      where: { id: orderId, userId: user.id },
      include: { items: { select: { variantId: true, quantity: true, productName: true } } },
    });

    if (!order) return { ok: false, message: 'We could not find that order.' };

    let added = 0;
    let skipped = 0;

    for (const item of order.items) {
      if (!item.variantId) {
        skipped += 1;
        continue;
      }

      try {
        await addToCart(item.variantId, item.quantity, user.id);
        added += 1;
      } catch {
        skipped += 1;
      }
    }

    revalidatePath('/cart');

    if (added === 0) {
      return { ok: false, message: 'None of those items are available any more.' };
    }

    return {
      ok: true,
      message:
        skipped > 0
          ? `${added} ${added === 1 ? 'item' : 'items'} added. ${skipped} ${skipped === 1 ? 'is' : 'are'} no longer available.`
          : 'Everything from that order is back in your bag.',
    };
  } catch (error) {
    return fail(error);
  }
}
