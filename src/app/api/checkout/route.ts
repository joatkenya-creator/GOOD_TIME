import { errors, withRoute } from '@/lib/api/handler';

/**
 * `POST /api/checkout` — creates a payment intent and reserves stock.
 *
 * The most safety-critical endpoint in the system. Non-negotiables for whoever
 * implements it:
 *
 *   1. Recalculate every total server-side. The client sends line items, never
 *      prices — anything else is a discount the customer writes themselves.
 *   2. Reserve inventory inside the same transaction that creates the order, and
 *      release the reservation on failure or after `TOKEN_TTL.cartReservation`.
 *   3. Pass an idempotency key to the provider, and store it on `Payment`, so a
 *      double-submitted form cannot charge twice.
 *   4. Treat the payment webhook as the source of truth for `PaymentStatus`.
 *      A redirect back from the gateway proves nothing.
 */
export const POST = withRoute(
  async () => {
    throw errors.notImplemented('Checkout');
  },
  { rateLimit: { bucket: 'checkout', limit: 20, windowSeconds: 300 } },
);
