import { NextResponse } from 'next/server';

import { withRoute } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/response';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { releaseExpiredReservations } from '@/services/order.service';

/**
 * `POST|GET /api/cron/release-reservations`
 *
 * Cancels `PENDING` orders that have held inventory past the window, returning
 * the stock. Scheduled every 15 minutes by `vercel.json`.
 *
 * Without this, reserve-on-order is a slow leak: every abandoned checkout holds
 * stock that is neither sold nor sellable, and a popular variant eventually reads
 * "out of stock" because of people who closed a tab.
 *
 * GET as well as POST because Vercel Cron issues a GET. The origin check is off
 * for the same reason it is off for the Stripe webhook — the caller is not a
 * browser — and the bearer token replaces it.
 */
export const POST = withRoute(handler, { csrf: false, rateLimit: false });
export const GET = POST;

async function handler({ request }: { request: Request }): Promise<NextResponse> {
  // An unset secret denies everything. A scheduled job anyone can trigger is a
  // denial of service with extra steps, so failing closed is the only option.
  if (!env.CRON_SECRET) {
    logger.error('cron.no_secret', undefined, { job: 'release-reservations' });
    return NextResponse.json({ ok: false, error: 'Not configured.' }, { status: 503 });
  }

  if (request.headers.get('authorization') !== `Bearer ${env.CRON_SECRET}`) {
    // Deliberately terse. A cron endpoint has no legitimate human caller to help.
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const result = await releaseExpiredReservations();

  return jsonOk(result);
}

export const dynamic = 'force-dynamic';
