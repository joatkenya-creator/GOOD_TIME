import { z } from 'zod';

import { cartItemSchema } from '@/features/checkout/schemas';
import { errors, readJson, withRoute } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/response';
import { getSessionUser } from '@/server/auth/session';
import { addToCart, getCartView, removeFromCart, updateQuantity } from '@/services/cart.service';

/**
 * `/api/cart` — read and mutate the current cart.
 *
 * The storefront uses server actions (`src/server/actions/cart.ts`); this exists
 * for the future mobile client, which cannot call one. Both go through the same
 * service, so the rules have one implementation rather than two that drift.
 *
 * Identity is either the session user or the `gt.cart` cookie for guests; the two
 * are merged on sign-in. Every mutation re-reads the variant price rather than
 * trusting the client, and checks `Inventory.quantity - reserved` before
 * accepting the line.
 */

async function userId(): Promise<string | null> {
  return (await getSessionUser())?.id ?? null;
}

export const GET = withRoute(async () => {
  return jsonOk(await getCartView(await userId()));
});

export const POST = withRoute(async ({ request }) => {
  const item = await readJson(request, cartItemSchema);
  const id = await userId();
  const result = await addToCart(item.variantId, item.quantity, id);

  return jsonOk({ ...result, cart: await getCartView(id) }, { status: 201 });
});

export const PATCH = withRoute(async ({ request }) => {
  const body = await readJson(
    request,
    z.object({ itemId: z.cuid(), quantity: z.number().int().min(0).max(99) }),
  );

  const id = await userId();
  await updateQuantity(body.itemId, body.quantity, id);

  return jsonOk(await getCartView(id));
});

export const DELETE = withRoute(async ({ request }) => {
  const itemId = new URL(request.url).searchParams.get('itemId');
  if (!itemId) throw errors.badRequest('An itemId is required.');

  const id = await userId();
  const removed = await removeFromCart(itemId, id);

  return jsonOk({ removed, cart: await getCartView(id) });
});

/** A cart is per-visitor and changes constantly; caching one would leak it. */
export const dynamic = 'force-dynamic';
