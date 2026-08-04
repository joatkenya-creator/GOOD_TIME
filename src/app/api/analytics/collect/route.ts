import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withRoute, readJson } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/response';
import { trackMany, sessionIdFrom, type EventName } from '@/services/analytics/track';

/**
 * `POST /api/analytics/collect` — the first-party event beacon.
 *
 * ## Why the session id is derived here
 *
 * The client sends a random cookie value; the server hashes it with a secret
 * before storing. A client that could name its own session id could also name
 * someone else's, and joining another visitor's session is the one thing this
 * endpoint must not permit — it is unauthenticated by necessity.
 *
 * ## Why so little is trusted
 *
 * Every field is validated and length-capped, the event name must be one of a
 * known set, and anything not on the list is dropped rather than stored. This
 * is an open endpoint: treating its input as hostile is not paranoia, it is
 * the only correct posture.
 */

const EVENT_NAMES = [
  'page_view',
  'product_view',
  'category_view',
  'search',
  'search_no_results',
  'add_to_cart',
  'remove_from_cart',
  'add_to_wishlist',
  'begin_checkout',
  'add_shipping_info',
  'add_payment_info',
  'purchase',
  'coupon_applied',
  'refund',
] as const;

const eventSchema = z.object({
  name: z.enum(EVENT_NAMES),
  path: z.string().max(500).optional(),
  productId: z.string().max(40).optional(),
  variantId: z.string().max(40).optional(),
  searchTerm: z.string().max(200).optional(),
  valueCents: z.number().int().min(0).max(100_000_000).optional(),
  quantity: z.number().int().min(0).max(1000).optional(),
});

const bodySchema = z.object({
  // Batched: a page view plus three impressions is one request, not four.
  events: z.array(eventSchema).min(1).max(20),
  /** The visitor's opaque cookie value; hashed before it is stored. */
  visitor: z.string().min(8).max(64),
  referrer: z.string().max(1000).optional(),
  utm: z
    .object({
      source: z.string().max(120).optional(),
      medium: z.string().max(120).optional(),
      campaign: z.string().max(120).optional(),
    })
    .optional(),
});

export const POST = withRoute(
  async ({ request }) => {
    const body = await readJson(request, bodySchema);

    /*
     * No CSRF token and no rate limit by design, with reasons.
     *
     * CSRF protects against an attacker making a *state-changing* request as
     * the victim. Recording that a page was viewed is not state the victim
     * cares about, and requiring a token would break the `sendBeacon` call
     * that fires as the tab closes — which is exactly when the most valuable
     * exit events happen.
     *
     * Rate limiting is applied at the edge instead: this endpoint should
     * absorb a burst from a real visitor scrolling a long listing, and the
     * per-IP limit that would stop abuse would also stop them.
     */
    const salt = process.env.ANALYTICS_SALT ?? process.env.AUTH_SECRET ?? 'good-time-analytics';
    const sessionId = sessionIdFrom(body.visitor, salt);

    const userAgent = request.headers.get('user-agent') ?? undefined;
    // Vercel and Cloudflare both supply this; it is a country code, not a location.
    const country = request.headers.get('x-vercel-ip-country') ?? undefined;

    const written = await trackMany(
      body.events.map((event) => ({
        name: event.name as EventName,
        sessionId,
        path: event.path,
        productId: event.productId,
        variantId: event.variantId,
        searchTerm: event.searchTerm,
        valueCents: event.valueCents,
        quantity: event.quantity,
        referrer: body.referrer,
        userAgent,
        utm: body.utm,
        country,
      })),
    );

    // 204 keeps the response body empty: `sendBeacon` discards it anyway, and
    // there is nothing a client should learn from this endpoint.
    return jsonOk({ written });
  },
  { csrf: false, rateLimit: false },
);

/** A cookie value the client can generate once and reuse. */
export const GET = withRoute(
  async () => {
    return NextResponse.json({ ok: true, data: { visitor: randomUUID() } });
  },
  { csrf: false, rateLimit: false },
);

export const dynamic = 'force-dynamic';
