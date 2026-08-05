import { NextResponse } from 'next/server';

import { withRoute } from '@/lib/api/handler';
import { verifyPushToken, type KlarnaPushEvent } from '@/lib/integrations/klarna';
import { logger } from '@/lib/logger';
import { syncFromKlarna } from '@/services/payment.service';

/**
 * `POST /api/webhooks/klarna/{token}` — Klarna push notifications.
 *
 * ## How this is authenticated, given Klarna does not sign anything
 *
 * There is no `Stripe-Signature` equivalent. Klarna's documented mechanism is a
 * secret embedded in the notification URL, which is what `{token}` is, compared
 * in constant time against `KLARNA_WEBHOOK_SECRET`.
 *
 * That alone would be thin, so it is not the only thing standing here. The body
 * is treated as a *hint*: whatever it claims, the handler re-reads the order
 * from Klarna's API over an authenticated connection and applies that. Someone
 * who learns the URL can make us perform a lookup. They cannot make us mark an
 * order paid, because nothing in the request body is ever written.
 *
 * Recommended belt-and-braces, configured in Cloudflare rather than in code:
 * a WAF rule restricting this path to Klarna's published egress ranges. See
 * docs/cloudflare.md.
 *
 * ## Why the CSRF check is off
 *
 * Klarna is by definition cross-origin. The token check replaces the origin
 * check; nothing else about the request is trusted.
 *
 * ## Status codes
 *
 * Klarna retries on non-2xx. A transient database failure therefore *should*
 * 500 — `syncFromKlarna` is idempotent, so a replay is safe and a retry is what
 * we want. An unknown order id returns 200, because retrying that for two days
 * discovers nothing.
 */
export const POST = withRoute<{ token: string }>(
  async ({ request, params }) => {
    if (!verifyPushToken(params.token)) {
      // Deliberately terse and deliberately a 404 rather than a 403: an
      // attacker probing the path learns nothing about whether it exists.
      logger.warn('klarna.push_bad_token');
      return NextResponse.json({ ok: false }, { status: 404 });
    }

    let event: KlarnaPushEvent;

    try {
      event = (await request.json()) as KlarnaPushEvent;
    } catch {
      return NextResponse.json({ received: true }, { status: 200 });
    }

    if (!event?.order_id || typeof event.order_id !== 'string') {
      logger.warn('klarna.push_missing_order_id', { eventType: event?.event_type });
      return NextResponse.json({ received: true });
    }

    logger.info('klarna.push', { type: event.event_type, orderId: event.order_id });

    // Authoritative: re-reads the order from Klarna and reconciles. The push
    // body is never written to the database.
    const result = await syncFromKlarna(event.order_id);

    logger.info('klarna.push.handled', {
      type: event.event_type,
      klarnaOrderId: event.order_id,
      changed: result.changed,
    });

    return NextResponse.json({ received: true });
  },
  // The token is the authentication. The rate limit is generous because Klarna
  // legitimately bursts during a fraud-review sweep, and tight enough that a
  // leaked URL cannot be used to hammer Klarna's API through us.
  { csrf: false, rateLimit: { bucket: 'klarna-push', limit: 300, windowSeconds: 60 } },
);

/** Never let a caching layer sit in front of a webhook. */
export const dynamic = 'force-dynamic';
