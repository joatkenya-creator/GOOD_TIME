import { NextResponse } from 'next/server';

import { withRoute } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/response';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { drain } from '@/lib/jobs/worker';

/**
 * `POST|GET /api/cron/jobs` — one drain of the background queue.
 *
 * This is the serverless half of the worker: Vercel Cron calls it every minute,
 * it claims a bounded batch, runs it, and returns. No process to keep warm.
 *
 * The batch is bounded by *time* as well as count, and the budget is set well
 * below the function's own timeout. A job killed by a platform timeout leaves a
 * stale lock and burns a retry attempt without ever reporting why — the
 * reclaimer heals that, but only after fifteen minutes, so it is far better not
 * to start work there is no time to finish.
 *
 * A container deployment runs `npm run worker` instead and can ignore this
 * route entirely. Same handlers either way.
 */
export const POST = withRoute(handler, { csrf: false, rateLimit: false });
export const GET = POST;

async function handler({ request }: { request: Request }): Promise<NextResponse> {
  // An unset secret denies everything. An endpoint that runs arbitrary queued
  // work is not one to leave open while someone remembers to configure it.
  if (!env.CRON_SECRET) {
    logger.error('cron.no_secret', undefined, { job: 'jobs' });
    return NextResponse.json({ ok: false, error: 'Not configured.' }, { status: 503 });
  }

  if (request.headers.get('authorization') !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const result = await drain({ maxJobs: 25, maxMs: 45_000, concurrency: 4 });

  return jsonOk(result);
}

/** Room for the batch plus its own overhead, on platforms that honour it. */
export const maxDuration = 60;
export const dynamic = 'force-dynamic';
