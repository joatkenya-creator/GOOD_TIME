import 'server-only';

import { createHash } from 'node:crypto';

import type { Prisma } from '@/generated/prisma/client';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

/**
 * First-party analytics.
 *
 * ## Why this exists alongside GA4
 *
 * GA4 is blocked by roughly a third of visitors, sampled above a threshold, and
 * owned by someone else. For a shop in this category that is worse than usual:
 * privacy-conscious customers are exactly the ones most likely to block it, so
 * the missing third is not random — it is the segment most worth understanding.
 *
 * This table answers "what sells and where do people drop out" from the
 * server, where nothing can block it, and keeps working when every tag is
 * switched off.
 *
 * ## What is deliberately not collected
 *
 * No fingerprint, no cross-site identifier, no IP address, no raw user agent.
 * The session id is a rotating opaque value and the user id is only present
 * when someone is signed in. Device and country are coarse buckets derived at
 * write time and the source material is discarded.
 *
 * That is not only an ethical position, it is a practical one: this shop sells
 * intimate products, and a detailed browsing profile tied to an identity is a
 * liability the business should not want to hold. What cannot be leaked is
 * what was never stored.
 */

export type EventName =
  | 'page_view'
  | 'product_view'
  | 'category_view'
  | 'search'
  | 'search_no_results'
  | 'add_to_cart'
  | 'remove_from_cart'
  | 'add_to_wishlist'
  | 'begin_checkout'
  | 'add_shipping_info'
  | 'add_payment_info'
  | 'purchase'
  | 'coupon_applied'
  | 'refund';

export interface TrackInput {
  name: EventName;
  sessionId: string;
  userId?: string | null;
  path?: string;
  productId?: string;
  variantId?: string;
  orderId?: string;
  searchTerm?: string;
  valueCents?: number;
  quantity?: number;
  referrer?: string;
  userAgent?: string;
  utm?: { source?: string; medium?: string; campaign?: string };
  country?: string;
  meta?: Record<string, unknown>;
}

/**
 * Buckets a user agent into three values.
 *
 * Three, not thirty: "should this layout be tested on a phone" is a question
 * three buckets answer. Storing the full string would be a fingerprint, which
 * is the thing this module exists not to keep.
 */
function deviceOf(userAgent: string | undefined): string {
  if (!userAgent) return 'unknown';
  const ua = userAgent.toLowerCase();

  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile/.test(ua)) return 'mobile';
  return 'desktop';
}

/**
 * Reduces a referrer to its host.
 *
 * The full URL of the page someone arrived from can carry their search query,
 * their email provider's message id, or a private forum path. The host answers
 * "where does traffic come from" and none of those questions.
 */
function referrerHost(referrer: string | undefined): string | null {
  if (!referrer) return null;
  try {
    const url = new URL(referrer);
    return url.hostname.replace(/^www\./, '').slice(0, 120);
  } catch {
    return null;
  }
}

/**
 * Classifies traffic when there are no UTM parameters.
 *
 * A rough heuristic, and labelled as such — the alternative is a `source` that
 * is null for most sessions, which makes the whole dimension useless.
 */
function classify(host: string | null): { source: string; medium: string } {
  if (!host) return { source: 'direct', medium: 'none' };

  if (/google|bing|duckduckgo|yahoo|ecosia|brave|startpage/.test(host)) {
    return { source: host, medium: 'organic' };
  }
  if (/facebook|instagram|twitter|x\.com|tiktok|pinterest|reddit|linkedin/.test(host)) {
    return { source: host, medium: 'social' };
  }
  return { source: host, medium: 'referral' };
}

/**
 * Records one event.
 *
 * Never throws. Analytics failing must not fail a checkout — the whole point
 * of writing this server-side is that it is in the request path, and anything
 * in the request path that can break the request is a liability.
 */
export async function track(input: TrackInput): Promise<void> {
  try {
    const host = referrerHost(input.referrer);
    const classified = classify(host);

    await prisma.analyticsEvent.create({
      data: {
        name: input.name,
        sessionId: input.sessionId.slice(0, 64),
        userId: input.userId ?? null,
        path: input.path?.slice(0, 500) ?? null,
        productId: input.productId ?? null,
        variantId: input.variantId ?? null,
        orderId: input.orderId ?? null,
        searchTerm: input.searchTerm?.slice(0, 200) ?? null,
        valueCents: input.valueCents ?? null,
        quantity: input.quantity ?? null,
        source: input.utm?.source?.slice(0, 120) ?? classified.source,
        medium: input.utm?.medium?.slice(0, 120) ?? classified.medium,
        campaign: input.utm?.campaign?.slice(0, 120) ?? null,
        referrer: host,
        device: deviceOf(input.userAgent),
        country: input.country?.slice(0, 2) ?? null,
        meta: (input.meta ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (error) {
    logger.warn('analytics.track_failed', {
      event: input.name,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Records several events in one round trip.
 *
 * The client batches: a page view, three product impressions and a search are
 * one request rather than five. At a million visitors the difference is not
 * latency, it is connection count.
 */
export async function trackMany(inputs: TrackInput[]): Promise<number> {
  if (inputs.length === 0) return 0;

  try {
    const result = await prisma.analyticsEvent.createMany({
      data: inputs.slice(0, 50).map((input) => {
        const host = referrerHost(input.referrer);
        const classified = classify(host);

        return {
          name: input.name,
          sessionId: input.sessionId.slice(0, 64),
          userId: input.userId ?? null,
          path: input.path?.slice(0, 500) ?? null,
          productId: input.productId ?? null,
          variantId: input.variantId ?? null,
          orderId: input.orderId ?? null,
          searchTerm: input.searchTerm?.slice(0, 200) ?? null,
          valueCents: input.valueCents ?? null,
          quantity: input.quantity ?? null,
          source: input.utm?.source?.slice(0, 120) ?? classified.source,
          medium: input.utm?.medium?.slice(0, 120) ?? classified.medium,
          campaign: input.utm?.campaign?.slice(0, 120) ?? null,
          referrer: host,
          device: deviceOf(input.userAgent),
          country: input.country?.slice(0, 2) ?? null,
          meta: (input.meta ?? undefined) as Prisma.InputJsonValue | undefined,
        };
      }),
    });

    return result.count;
  } catch (error) {
    logger.warn('analytics.batch_failed', {
      count: inputs.length,
      reason: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/**
 * A stable per-visitor id that is not a fingerprint.
 *
 * Derived from a random cookie value the browser already holds, hashed with a
 * server secret so the stored value cannot be correlated back to the cookie by
 * anyone reading the table. Rotates when the cookie does.
 */
export function sessionIdFrom(cookieValue: string, salt: string): string {
  return createHash('sha256').update(`${cookieValue}:${salt}`).digest('hex').slice(0, 32);
}
