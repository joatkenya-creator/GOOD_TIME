import { NextResponse } from 'next/server';

import { withRoute } from '@/lib/api/handler';
import { verifyStripeWebhook } from '@/lib/integrations/stripe';
import { logger } from '@/lib/logger';
import { handleStripeEvent } from '@/services/payment.service';

/**
 * `POST /api/webhooks/stripe`.
 *
 * The origin check is disabled because Stripe is, by definition, cross-origin;
 * the signature check replaces it and is the only thing standing between this
 * endpoint and anyone who can send an HTTP request.
 *
 * Unrecognised event types return 2xx — erroring makes Stripe retry an event we
 * were never going to act on. A handler that *throws* returns 500 and Stripe
 * does retry, which is correct for a transient database failure:
 * `handleStripeEvent` is idempotent, so replaying a half-applied event is safe.
 */
export const POST = withRoute(
  async ({ request }) => {
    const payload = await request.text();
    const event = verifyStripeWebhook(payload, request.headers.get('stripe-signature'));

    await handleStripeEvent(event);
    logger.info('stripe.webhook.handled', { type: event.type, id: event.id });

    return NextResponse.json({ received: true });
  },
  { csrf: false, rateLimit: false },
);

/** Never let a caching layer sit in front of a webhook. */
export const dynamic = 'force-dynamic';
