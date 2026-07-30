import { z } from 'zod';

import { errors, readJson, withRoute } from '@/lib/api/handler';

/**
 * `POST /api/analytics` — server-side event ingestion.
 *
 * Exists because roughly a third of visitors block `gtag`, which silently skews
 * every funnel report. Forwarding events server-side (GA4 Measurement Protocol)
 * recovers them.
 *
 * Rate-limited tightly: this endpoint is unauthenticated and writes nothing the
 * caller can read back, which makes it an attractive thing to flood.
 */
const eventSchema = z.object({
  name: z.string().min(1).max(64),
  params: z.record(z.string(), z.unknown()).default({}),
  clientId: z.string().max(128).optional(),
});

export const POST = withRoute(
  async ({ request }) => {
    const event = await readJson(request, eventSchema);
    void event;

    throw errors.notImplemented('Analytics ingestion');
  },
  { rateLimit: { bucket: 'analytics', limit: 30, windowSeconds: 60 } },
);
