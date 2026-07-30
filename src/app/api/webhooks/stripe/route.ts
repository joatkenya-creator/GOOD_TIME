import { NextResponse } from 'next/server';

import { withRoute } from '@/lib/api/handler';
import { verifyStripeWebhook } from '@/lib/integrations/stripe';
import { logger } from '@/lib/logger';

/**
 * `POST /api/webhooks/stripe`.
 *
 * The origin check is disabled because Stripe is, by definition, cross-origin;
 * the signature check replaces it and is the only thing standing between this
 * endpoint and anyone who can send an HTTP request.
 *
 * Three rules for the handlers below:
 *   - always return 2xx once the signature verifies, even for events we ignore,
 *     or Stripe retries them for three days;
 *   - treat every event as possibly duplicated — dedupe on `event.id`;
 *   - do the minimum inline and queue anything slow. Stripe times out at 20s.
 */
export const POST = withRoute(
  async ({ request }) => {
    const payload = await request.text();
    const event = verifyStripeWebhook(payload, request.headers.get('stripe-signature'));

    switch (event.type) {
      case 'payment_intent.succeeded':
      case 'payment_intent.payment_failed':
      case 'charge.refunded':
      case 'checkout.session.completed':
        // Order reconciliation lands with checkout in phase 5.
        logger.info('Stripe event received', { type: event.type, id: event.id });
        break;

      default:
        logger.debug('Unhandled Stripe event', { type: event.type, id: event.id });
    }

    return NextResponse.json({ received: true });
  },
  { csrf: false, rateLimit: false },
);

/** Never let a caching layer sit in front of a webhook. */
export const dynamic = 'force-dynamic';
