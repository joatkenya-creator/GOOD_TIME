'use server';

import { revalidatePath } from 'next/cache';

import { ROUTES } from '@/constants/routes';
import { couponSchema, estimateSchema, giftNoteSchema } from '@/features/checkout/schemas';
import { isAppError } from '@/lib/api/errors';
import { getSessionUser } from '@/server/auth/session';
import * as cart from '@/services/cart.service';

/**
 * Cart server actions.
 *
 * Actions rather than fetch calls: the cart badge and the mini drawer both read
 * server state, and `revalidatePath` updates them from one round trip instead of
 * the client having to re-query after every mutation.
 *
 * Every action returns `{ ok, message }` rather than throwing. A thrown error in
 * a form action shows the customer a Next.js error overlay in development and a
 * blank failure in production; a returned message shows them what went wrong.
 */

export interface ActionResult {
  ok: boolean;
  message: string;
  /** Present on add-to-cart, so the UI can offer "Undo". */
  undoToken?: { variantId: string; quantity: number };
  /**
   * Items in the bag after this action.
   *
   * Returned so the header badge updates from the action's own response instead
   * of a second round trip — see `use-cart-count`.
   */
  count?: number;
}

async function currentUserId(): Promise<string | null> {
  const user = await getSessionUser();
  return user?.id ?? null;
}

/** Turns any thrown error into copy a customer can act on. */
function toResult(error: unknown): ActionResult {
  if (isAppError(error)) return { ok: false, message: error.message };
  return { ok: false, message: 'Something went wrong. Please try again.' };
}

/**
 * Invalidates the pages that render cart contents. Deliberately not
 * `revalidatePath('/', 'layout')`: that drops the router cache for the whole
 * site on every quantity tap, and the header badge it was there to update is now
 * client state instead.
 */
function refresh(): void {
  revalidatePath(ROUTES.cart);
  revalidatePath(ROUTES.checkout);
}

export async function addToCartAction(variantId: string, quantity = 1): Promise<ActionResult> {
  try {
    const userId = await currentUserId();
    const result = await cart.addToCart(variantId, quantity, userId);
    refresh();

    return {
      ok: true,
      message: result.clamped
        ? `Only ${result.added} could be added — that is all we have left.`
        : 'Added to your bag.',
      count: await cart.getCartCount(userId),
    };
  } catch (error) {
    return toResult(error);
  }
}

export async function updateQuantityAction(
  itemId: string,
  quantity: number,
): Promise<ActionResult> {
  try {
    const userId = await currentUserId();
    await cart.updateQuantity(itemId, quantity, userId);
    refresh();
    return { ok: true, message: 'Bag updated.', count: await cart.getCartCount(userId) };
  } catch (error) {
    return toResult(error);
  }
}

/**
 * Removes a line and hands back what it takes to restore it.
 *
 * Undo, rather than a confirmation dialog: removing an item is cheap to reverse,
 * and a modal on every remove is the more expensive interaction.
 */
export async function removeFromCartAction(itemId: string): Promise<ActionResult> {
  try {
    const userId = await currentUserId();
    const removed = await cart.removeFromCart(itemId, userId);
    refresh();

    return {
      ok: true,
      message: 'Removed from your bag.',
      undoToken: removed,
      count: await cart.getCartCount(userId),
    };
  } catch (error) {
    return toResult(error);
  }
}

export async function undoRemoveAction(variantId: string, quantity: number): Promise<ActionResult> {
  try {
    const userId = await currentUserId();
    await cart.addToCart(variantId, quantity, userId);
    refresh();
    return { ok: true, message: 'Item restored.', count: await cart.getCartCount(userId) };
  } catch (error) {
    return toResult(error);
  }
}

export async function saveForLaterAction(itemId: string, saved: boolean): Promise<ActionResult> {
  try {
    const userId = await currentUserId();
    await cart.setSavedForLater(itemId, saved, userId);
    refresh();

    return {
      ok: true,
      message: saved ? 'Saved for later.' : 'Moved back to your bag.',
      count: await cart.getCartCount(userId),
    };
  } catch (error) {
    return toResult(error);
  }
}

/** Moves a wishlist item into the bag. The wishlist itself lives client-side. */
export async function moveToCartAction(variantId: string): Promise<ActionResult> {
  return addToCartAction(variantId, 1);
}

export async function applyCouponAction(formData: FormData): Promise<ActionResult> {
  const parsed = couponSchema.safeParse({ code: formData.get('code') });
  if (!parsed.success) return { ok: false, message: 'Enter a promo code.' };

  try {
    const result = await cart.applyCoupon(parsed.data.code, await currentUserId());
    if (result.ok) refresh();
    return result;
  } catch (error) {
    return toResult(error);
  }
}

export async function removeCouponAction(): Promise<ActionResult> {
  try {
    await cart.removeCoupon(await currentUserId());
    refresh();
    return { ok: true, message: 'Promo code removed.' };
  } catch (error) {
    return toResult(error);
  }
}

/**
 * Attaches a gift card to the basket.
 *
 * Only the card's id is stored. The amount is quoted against the live balance
 * at checkout, exactly like store credit — a basket that claims $500 of gift
 * card gets whatever the card actually holds.
 */
export async function applyGiftCardAction(formData: FormData): Promise<ActionResult> {
  const code = String(formData.get('code') ?? '').trim();
  if (!code) return { ok: false, message: 'Enter a gift card code.' };

  try {
    const result = await cart.applyGiftCard(code, await currentUserId());
    if (result.ok) refresh();
    return result;
  } catch (error) {
    return toResult(error);
  }
}

export async function removeGiftCardAction(): Promise<ActionResult> {
  try {
    await cart.removeGiftCard(await currentUserId());
    refresh();
    return { ok: true, message: 'Gift card removed.' };
  } catch (error) {
    return toResult(error);
  }
}

export async function setGiftNoteAction(formData: FormData): Promise<ActionResult> {
  const parsed = giftNoteSchema.safeParse({ note: formData.get('note') ?? '' });
  if (!parsed.success) return { ok: false, message: 'That note is too long.' };

  try {
    await cart.setGiftNote(parsed.data.note, await currentUserId());
    refresh();
    return { ok: true, message: parsed.data.note ? 'Gift note saved.' : 'Gift note removed.' };
  } catch (error) {
    return toResult(error);
  }
}

/** Destination for the pre-checkout shipping and tax estimate. */
export async function setEstimateAction(formData: FormData): Promise<ActionResult> {
  const parsed = estimateSchema.safeParse({
    state: formData.get('state'),
    postalCode: formData.get('postalCode') || undefined,
  });

  if (!parsed.success) return { ok: false, message: 'Choose a state and enter a valid ZIP.' };

  try {
    await cart.setEstimateDestination(
      parsed.data.state,
      parsed.data.postalCode ?? null,
      await currentUserId(),
    );
    refresh();
    return { ok: true, message: 'Estimate updated.' };
  } catch (error) {
    return toResult(error);
  }
}

/** Records whether to spend points or store credit on this basket. */
export async function setRedemptionAction(input: {
  applyStoreCredit?: boolean;
  redeemPoints?: boolean;
}): Promise<ActionResult> {
  try {
    await cart.setRedemption(input, await currentUserId());
    refresh();
    return { ok: true, message: 'Rewards updated.' };
  } catch (error) {
    return toResult(error);
  }
}

export async function setShippingRateAction(rateId: string): Promise<ActionResult> {
  try {
    await cart.setShippingRate(rateId, await currentUserId());
    refresh();
    return { ok: true, message: 'Delivery method updated.' };
  } catch (error) {
    return toResult(error);
  }
}
