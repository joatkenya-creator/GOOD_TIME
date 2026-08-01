import 'server-only';

import { cookies } from 'next/headers';
import { randomBytes } from 'node:crypto';

import { COOKIES } from '@/constants';
import { availableQuantity, effectivePriceCents, stockStatus } from '@/features/catalog/pricing';
import { computeTotals, type Totals } from '@/features/checkout/totals';
import { errors } from '@/lib/api/errors';
import { publicEnv } from '@/lib/env.public';
import { prisma } from '@/lib/prisma';
import { productHref } from '@/services/product.service';
import { toDiscount, validateCoupon } from '@/services/coupon.service';
import { getCheapestOption, getShippingRate, priceFor } from '@/services/shipping.service';
import { quoteRedemption } from '@/services/account/rewards.service';
import { resolveJurisdictions } from '@/services/tax.service';

/**
 * The cart.
 *
 * One cart per visitor, identified by a signed-in user id or by an opaque cookie
 * for guests. Every price is recomputed from the database on read — the client
 * never sends an amount, and a stale cart cannot lock in an old price.
 *
 * ## Guest and account carts
 *
 * A guest cart is keyed by `gt.cart`, a random cookie value. On sign-in
 * `mergeGuestCart` folds it into the account cart and deletes it. Quantities are
 * summed rather than replaced, because a customer who added an item on their
 * phone and the same item on their laptop meant to have two.
 */

const CART_TTL_DAYS = 30;

/** Cookie is `httpOnly`: nothing client-side has any reason to read a cart id. */
async function readCartCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(COOKIES.cart)?.value ?? null;
}

async function writeCartCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIES.cart, token, {
    httpOnly: true,
    sameSite: 'lax',
    // Gated on the site URL's scheme, not on NODE_ENV — same rule as
    // `securityHeaders()`. A production build served over http (`next start`
    // locally, a preview box) would otherwise set a Secure cookie that WebKit
    // silently refuses to store, and every guest cart on that host vanishes.
    secure: publicEnv.NEXT_PUBLIC_SITE_URL.startsWith('https://'),
    path: '/',
    maxAge: CART_TTL_DAYS * 24 * 60 * 60,
  });
}

const CART_INCLUDE = {
  items: {
    orderBy: { createdAt: 'asc' },
    include: {
      variant: {
        include: {
          inventory: true,
          product: {
            select: {
              id: true,
              name: true,
              slug: true,
              currency: true,
              primaryCategory: { select: { path: true } },
              media: {
                take: 1,
                orderBy: { position: 'asc' },
                select: { media: { select: { publicId: true, alt: true } } },
              },
            },
          },
        },
      },
    },
  },
  coupon: true,
  shippingRate: true,
} as const;

/**
 * Finds the visitor's cart, creating one only when asked.
 *
 * `create: false` for reads, so merely viewing a page does not litter the
 * database with empty carts for every crawler that passes through.
 */
export async function getCart(userId?: string | null, create = false) {
  if (userId) {
    const existing = await prisma.cart.findFirst({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: CART_INCLUDE,
    });
    if (existing) return existing;
    if (!create) return null;

    return prisma.cart.create({ data: { userId }, include: CART_INCLUDE });
  }

  const token = await readCartCookie();

  if (token) {
    const existing = await prisma.cart.findUnique({
      where: { sessionToken: token },
      include: CART_INCLUDE,
    });
    if (existing) return existing;
  }

  if (!create) return null;

  const newToken = randomBytes(24).toString('base64url');
  await writeCartCookie(newToken);

  return prisma.cart.create({ data: { sessionToken: newToken }, include: CART_INCLUDE });
}

export type CartRecord = NonNullable<Awaited<ReturnType<typeof getCart>>>;

export interface CartLineView {
  id: string;
  variantId: string;
  productName: string;
  variantName: string;
  sku: string;
  href: string;
  imageSeed: string;
  imageAlt: string;
  quantity: number;
  unitPriceCents: number;
  compareAtPriceCents: number | null;
  lineTotalCents: number;
  stock: ReturnType<typeof stockStatus>;
  availableQuantity: number;
  savedForLater: boolean;
  weightGrams: number;
  /** Set when the basket asks for more than exists. */
  quantityIssue: string | null;
}

export interface CartView {
  id: string;
  currency: string;
  lines: CartLineView[];
  savedLines: CartLineView[];
  totals: Totals;
  couponCode: string | null;
  couponMessage: string | null;
  giftNote: string | null;
  shipping: {
    rateId: string | null;
    label: string;
    estimated: boolean;
  };
  isEmpty: boolean;
  hasIssues: boolean;
  /** Billable weight of the active lines, for weight-based shipping rates. */
  totalWeightGrams: number;
  /**
   * What loyalty would pay towards this basket, and what is available.
   *
   * Null for a guest, who has no balance. Quoted, never committed — nothing is
   * deducted until an order exists.
   */
  redemption: {
    applyStoreCredit: boolean;
    redeemPoints: boolean;
    creditCents: number;
    points: number;
    pointsCents: number;
    totalCents: number;
    amountDueCents: number;
    available: {
      storeCreditCents: number;
      pointsBalance: number;
      pointsValueCents: number;
      minimumPoints: number;
    } | null;
  };
}

function toLineView(item: CartRecord['items'][number]): CartLineView {
  const variant = item.variant;
  const product = variant.product;

  // Recomputed from the variant, never trusted from `unitPriceCents`, so a price
  // change is reflected before the customer is charged.
  const unitPriceCents = effectivePriceCents(variant);
  const available = availableQuantity(variant.inventory);
  const stock = stockStatus(variant.inventory);

  const quantityIssue =
    stock === 'OUT_OF_STOCK'
      ? 'Out of stock'
      : item.quantity > available && stock !== 'BACKORDER'
        ? `Only ${available} left`
        : null;

  return {
    id: item.id,
    variantId: variant.id,
    productName: product.name,
    variantName: variant.name,
    sku: variant.sku,
    href: productHref(product.primaryCategory?.path, product.slug),
    imageSeed: product.media[0]?.media.publicId ?? product.slug,
    imageAlt: product.media[0]?.media.alt ?? product.name,
    quantity: item.quantity,
    unitPriceCents,
    compareAtPriceCents:
      variant.compareAtPriceCents && variant.compareAtPriceCents > unitPriceCents
        ? variant.compareAtPriceCents
        : null,
    lineTotalCents: unitPriceCents * item.quantity,
    stock,
    availableQuantity: available,
    savedForLater: item.savedForLater,
    weightGrams: variant.weightGrams ?? 0,
    quantityIssue,
  };
}

/**
 * Everything the cart and checkout render, priced.
 *
 * The coupon is re-validated here rather than trusted from `cart.couponId`: a
 * basket that no longer meets a minimum silently loses the discount, which is
 * the correct behaviour and the only way to stop a customer gaming the total by
 * applying a code and then removing items.
 */
export async function getCartView(userId?: string | null): Promise<CartView | null> {
  const cart = await getCart(userId, false);
  if (!cart) return null;

  const active = cart.items.filter((item) => !item.savedForLater).map(toLineView);
  const saved = cart.items.filter((item) => item.savedForLater).map(toLineView);

  const lines = active.map((line) => ({
    unitPriceCents: line.unitPriceCents,
    quantity: line.quantity,
    weightGrams: line.weightGrams,
  }));

  const subtotalCents = lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);

  // --- Coupon ------------------------------------------------------------
  let discount = null;
  let couponMessage: string | null = null;

  if (cart.coupon) {
    const result = await validateCoupon(cart.coupon.code, { subtotalCents, userId });
    if (result.ok) discount = toDiscount(result.coupon);
    else couponMessage = result.message;
  }

  // --- Shipping ----------------------------------------------------------
  const weightGrams = lines.reduce((sum, line) => sum + line.weightGrams * line.quantity, 0);

  const context = {
    subtotalCents,
    totalWeightGrams: weightGrams,
    state: cart.estimateState,
  };

  let shippingCents = 0;
  let shippingLabel = 'Calculated at checkout';
  let estimated = true;

  if (cart.shippingRateId) {
    const rate = await getShippingRate(cart.shippingRateId);
    if (rate) {
      shippingCents = priceFor(rate, context);
      shippingLabel = rate.name;
      estimated = false;
    }
  } else if (subtotalCents > 0) {
    const cheapest = await getCheapestOption(context);
    if (cheapest) {
      shippingCents = cheapest.priceCents;
      shippingLabel = `${cheapest.name} (estimated)`;
    }
  }

  // --- Tax ---------------------------------------------------------------
  const taxJurisdictions = cart.estimateState
    ? await resolveJurisdictions({
        state: cart.estimateState,
        postalCode: cart.estimatePostalCode,
      })
    : [];

  const totals = computeTotals({
    lines,
    shippingCents,
    discount,
    taxJurisdictions,
  });

  const redemption = await quoteRedemption({
    userId,
    amountDueCents: totals.totalCents,
    usePoints: cart.redeemPoints,
    useCredit: cart.applyStoreCredit,
  });

  return {
    id: cart.id,
    currency: cart.currency,
    lines: active,
    savedLines: saved,
    totals,
    couponCode: cart.coupon?.code ?? null,
    couponMessage,
    giftNote: cart.giftNote,
    shipping: { rateId: cart.shippingRateId, label: shippingLabel, estimated },
    isEmpty: active.length === 0,
    hasIssues: active.some((line) => line.quantityIssue !== null),
    totalWeightGrams: weightGrams,
    redemption: {
      applyStoreCredit: cart.applyStoreCredit,
      redeemPoints: cart.redeemPoints,
      ...redemption,
      amountDueCents: totals.totalCents - redemption.totalCents,
    },
  };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Adds a variant, or increases it if already present.
 *
 * Quantity is clamped to what is actually available, and the clamp is reported
 * rather than silently applied — a cart that quietly refuses to go past 3 with
 * no explanation reads as broken.
 */
export async function addToCart(
  variantId: string,
  quantity: number,
  userId?: string | null,
): Promise<{ added: number; clamped: boolean }> {
  const variant = await prisma.variant.findFirst({
    where: { id: variantId, isActive: true, deletedAt: null },
    include: { inventory: true },
  });

  if (!variant) throw errors.notFound('Product');

  const available = availableQuantity(variant.inventory);
  const allowsBackorder = variant.inventory?.policy === 'CONTINUE';

  if (!allowsBackorder && available <= 0) {
    throw errors.conflict('That item is out of stock.');
  }

  // Deliberately *not* `getCart`: that loads every line with its variant,
  // product and media joined, to render a cart. Adding one item needs the cart
  // id and one existing quantity, and this is the hottest write in the store.
  const cart = await resolveCartForWrite(userId, variantId);
  if (!cart) throw errors.internal('Could not create a cart.');

  const existingQuantity = cart.items[0]?.quantity ?? 0;
  const requested = existingQuantity + quantity;
  const finalQuantity = allowsBackorder ? requested : Math.min(requested, available);

  // Batched: Prisma sends both statements in one round trip. Two awaits here is
  // two round trips to the database, and on a remote Postgres that is the whole
  // latency budget for a button press.
  await prisma.$transaction([
    prisma.cartItem.upsert({
      where: { cartId_variantId: { cartId: cart.id, variantId } },
      update: { quantity: finalQuantity, savedForLater: false },
      create: {
        cartId: cart.id,
        variantId,
        quantity: finalQuantity,
        unitPriceCents: effectivePriceCents(variant),
      },
    }),
    prisma.cart.update({
      where: { id: cart.id },
      data: { expiresAt: expiryFromNow() },
    }),
  ]);

  return {
    added: finalQuantity - existingQuantity,
    clamped: finalQuantity < requested,
  };
}

/**
 * Cart id plus one line's current quantity — everything a write needs and
 * nothing else.
 *
 * Creates the cart when there isn't one, which is the only reason this cannot
 * simply be a `select` on `getCart`.
 */
async function resolveCartForWrite(
  userId: string | null | undefined,
  variantId: string,
): Promise<{ id: string; items: { quantity: number }[] } | null> {
  const select = { id: true, items: { where: { variantId }, select: { quantity: true } } } as const;

  if (userId) {
    const existing = await prisma.cart.findFirst({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select,
    });
    return existing ?? prisma.cart.create({ data: { userId }, select });
  }

  const token = await readCartCookie();
  if (token) {
    const existing = await prisma.cart.findUnique({ where: { sessionToken: token }, select });
    if (existing) return existing;
  }

  const newToken = randomBytes(24).toString('base64url');
  await writeCartCookie(newToken);

  return prisma.cart.create({ data: { sessionToken: newToken }, select });
}

export async function updateQuantity(
  itemId: string,
  quantity: number,
  userId?: string | null,
): Promise<void> {
  const cart = await requireOwnedCart(itemId, userId);

  if (quantity <= 0) {
    await prisma.cartItem.delete({ where: { id: itemId } });
  } else {
    const item = cart.items.find((entry) => entry.id === itemId)!;
    const available = availableQuantity(item.variant.inventory);
    const allowsBackorder = item.variant.inventory?.policy === 'CONTINUE';

    await prisma.cartItem.update({
      where: { id: itemId },
      data: { quantity: allowsBackorder ? quantity : Math.min(quantity, Math.max(1, available)) },
    });
  }

  await touch(cart.id);
}

/**
 * Removes a line and returns enough to restore it.
 *
 * The snapshot is what makes "undo" possible without a soft-delete column and
 * the cleanup job that would come with it.
 */
export async function removeFromCart(
  itemId: string,
  userId?: string | null,
): Promise<{ variantId: string; quantity: number }> {
  const cart = await requireOwnedCart(itemId, userId);
  const item = cart.items.find((entry) => entry.id === itemId)!;

  await prisma.cartItem.delete({ where: { id: itemId } });
  await touch(cart.id);

  return { variantId: item.variantId, quantity: item.quantity };
}

export async function setSavedForLater(
  itemId: string,
  saved: boolean,
  userId?: string | null,
): Promise<void> {
  const cart = await requireOwnedCart(itemId, userId);
  await prisma.cartItem.update({ where: { id: itemId }, data: { savedForLater: saved } });
  await touch(cart.id);
}

export async function applyCoupon(
  code: string,
  userId?: string | null,
): Promise<{ ok: boolean; message: string }> {
  const view = await getCartView(userId);
  if (!view) return { ok: false, message: 'Your cart is empty.' };

  const result = await validateCoupon(code, {
    subtotalCents: view.totals.subtotalCents,
    userId,
  });

  if (!result.ok) return { ok: false, message: result.message };

  await prisma.cart.update({
    where: { id: view.id },
    data: { couponId: result.coupon.id },
  });

  return { ok: true, message: `${result.coupon.code} applied.` };
}

export async function removeCoupon(userId?: string | null): Promise<void> {
  const cart = await getCart(userId, false);
  if (!cart) return;
  await prisma.cart.update({ where: { id: cart.id }, data: { couponId: null } });
}

export async function setGiftNote(note: string | null, userId?: string | null): Promise<void> {
  const cart = await getCart(userId, false);
  if (!cart) return;

  await prisma.cart.update({
    where: { id: cart.id },
    data: { giftNote: note?.trim() ? note.trim().slice(0, 500) : null },
  });
}

/**
 * Records whether to spend loyalty on this basket.
 *
 * Intent only. The amounts are quoted against the live balance every time the
 * cart renders and re-quoted at checkout, so a flag left on a month-old cart
 * cannot spend a balance that has since been used elsewhere.
 */
export async function setRedemption(
  input: { applyStoreCredit?: boolean; redeemPoints?: boolean },
  userId?: string | null,
): Promise<void> {
  const cart = await getCart(userId, false);
  if (!cart) return;

  await prisma.cart.update({
    where: { id: cart.id },
    data: {
      ...(input.applyStoreCredit !== undefined ? { applyStoreCredit: input.applyStoreCredit } : {}),
      ...(input.redeemPoints !== undefined ? { redeemPoints: input.redeemPoints } : {}),
    },
  });
}

export async function setShippingRate(rateId: string | null, userId?: string | null): Promise<void> {
  const cart = await getCart(userId, false);
  if (!cart) return;
  await prisma.cart.update({ where: { id: cart.id }, data: { shippingRateId: rateId } });
}

/** Destination for the pre-checkout tax and shipping estimate. */
export async function setEstimateDestination(
  state: string | null,
  postalCode: string | null,
  userId?: string | null,
): Promise<void> {
  const cart = await getCart(userId, false);
  if (!cart) return;

  await prisma.cart.update({
    where: { id: cart.id },
    data: {
      estimateState: state?.toUpperCase().slice(0, 2) ?? null,
      estimatePostalCode: postalCode?.slice(0, 10) ?? null,
    },
  });
}

/**
 * Folds a guest cart into the account cart at sign-in.
 *
 * Quantities are summed, not replaced: the same item added on two devices means
 * two. The guest cart is deleted afterwards so the cookie cannot resurrect it.
 */
export async function mergeGuestCart(userId: string): Promise<void> {
  const token = await readCartCookie();
  if (!token) return;

  const guestCart = await prisma.cart.findUnique({
    where: { sessionToken: token },
    include: { items: true },
  });

  if (!guestCart || guestCart.userId) return;

  const userCart =
    (await prisma.cart.findFirst({ where: { userId }, orderBy: { updatedAt: 'desc' } })) ??
    (await prisma.cart.create({ data: { userId } }));

  for (const item of guestCart.items) {
    await prisma.cartItem.upsert({
      where: { cartId_variantId: { cartId: userCart.id, variantId: item.variantId } },
      update: { quantity: { increment: item.quantity } },
      create: {
        cartId: userCart.id,
        variantId: item.variantId,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        savedForLater: item.savedForLater,
      },
    });
  }

  // Carry the guest's coupon and gift note only where the account cart has none.
  await prisma.cart.update({
    where: { id: userCart.id },
    data: {
      couponId: userCart.couponId ?? guestCart.couponId,
      giftNote: userCart.giftNote ?? guestCart.giftNote,
    },
  });

  await prisma.cart.delete({ where: { id: guestCart.id } });

  const store = await cookies();
  store.delete(COOKIES.cart);
}

export async function clearCart(cartId: string): Promise<void> {
  await prisma.cartItem.deleteMany({ where: { cartId } });
  await prisma.cart.update({
    where: { id: cartId },
    data: { couponId: null, giftNote: null, shippingRateId: null },
  });
}

/**
 * Item count for the header badge.
 *
 * Runs on every storefront page, so it deliberately avoids `getCart` — that
 * loads variants, products and media to render a cart, and none of it is needed
 * to add up a number. This aggregates in the database instead, over the partial
 * index on active items.
 *
 * A visitor with no cart cookie and no session costs zero queries.
 */
export async function getCartCount(userId?: string | null): Promise<number> {
  const token = userId ? null : await readCartCookie();
  if (!userId && !token) return 0;

  const result = await prisma.cartItem.aggregate({
    where: {
      savedForLater: false,
      cart: userId ? { userId } : { sessionToken: token! },
    },
    _sum: { quantity: true },
  });

  return result._sum.quantity ?? 0;
}

function expiryFromNow(): Date {
  return new Date(Date.now() + CART_TTL_DAYS * 24 * 60 * 60 * 1000);
}

async function touch(cartId: string): Promise<void> {
  await prisma.cart.update({ where: { id: cartId }, data: { expiresAt: expiryFromNow() } });
}

/**
 * Confirms the caller owns the line before mutating it.
 *
 * Without this, an item id from another visitor's cart would be editable — the
 * classic IDOR. Ids are cuids, not sequential, but that is obscurity, not access
 * control.
 */
async function requireOwnedCart(itemId: string, userId?: string | null): Promise<CartRecord> {
  const cart = await getCart(userId, false);
  if (!cart) throw errors.notFound('Cart');
  if (!cart.items.some((item) => item.id === itemId)) throw errors.notFound('Cart item');
  return cart;
}
