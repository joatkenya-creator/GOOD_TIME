import { checkoutSchema } from '@/features/checkout/schemas';
import { errors, readJson, withRoute } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/response';
import { submitCheckoutAction } from '@/server/actions/checkout';

/**
 * `POST /api/checkout` — creates an order and its payment intent.
 *
 * The most safety-critical endpoint in the system. The four non-negotiables are
 * all enforced in the service layer this delegates to, so a future mobile client
 * hitting this route gets exactly the same guarantees as the web checkout:
 *
 *   1. Every total is recalculated server-side from the cart and the catalogue.
 *      The client sends no prices — anything else is a discount the customer
 *      writes themselves. (`placeOrder` → `computeTotals`)
 *   2. Inventory is reserved inside the same transaction that creates the order.
 *      (`placeOrder`)
 *   3. An idempotency key goes to Stripe and onto `Payment`, so a double-submitted
 *      form cannot charge twice. (`createPaymentIntent`)
 *   4. The webhook is the source of truth for `PaymentStatus`. The response
 *      below is a client secret, not a confirmation. (`handleStripeEvent`)
 */
export const POST = withRoute(
  async ({ request }) => {
    const input = await readJson(request, checkoutSchema);
    const result = await submitCheckoutAction(input);

    if (!result.ok) {
      throw result.fieldErrors
        ? errors.validation(result.fieldErrors)
        : errors.badRequest(result.message);
    }

    return jsonOk(
      {
        orderId: result.orderId,
        orderNumber: result.orderNumber,
        clientSecret: result.clientSecret,
      },
      { status: 201 },
    );
  },
  { rateLimit: { bucket: 'checkout', limit: 20, windowSeconds: 300 } },
);

export const dynamic = 'force-dynamic';
