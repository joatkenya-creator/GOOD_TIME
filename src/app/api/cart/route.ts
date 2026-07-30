import { z } from 'zod';

import { errors, readJson, withRoute } from '@/lib/api/handler';

/**
 * `/api/cart` — read and mutate the current cart.
 *
 * Identity is either the session user or the `gt.cart` cookie for guests; the two
 * are merged on sign-in. Responses must never be cached (`cacheControl.private`).
 *
 * Implementation notes: every mutation re-reads the variant price rather than
 * trusting the client, and checks `Inventory.quantity - reserved` before
 * accepting the line.
 */
const cartItemSchema = z.object({
  variantId: z.cuid(),
  quantity: z.number().int().min(1).max(99),
});

export const GET = withRoute(async () => {
  throw errors.notImplemented('Cart');
});

export const POST = withRoute(async ({ request }) => {
  const item = await readJson(request, cartItemSchema);
  void item;

  throw errors.notImplemented('Cart');
});

export const PATCH = withRoute(async ({ request }) => {
  const item = await readJson(
    request,
    cartItemSchema.extend({ quantity: z.number().int().min(0) }),
  );
  void item;

  throw errors.notImplemented('Cart');
});

export const DELETE = withRoute(async () => {
  throw errors.notImplemented('Cart');
});
