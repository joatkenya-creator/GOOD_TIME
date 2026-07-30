import { jsonOk } from '@/lib/api/response';
import { withRoute } from '@/lib/api/handler';
import { prisma } from '@/lib/prisma';

/**
 * Liveness probe for uptime monitoring and deploy verification.
 *
 * Actually touches the database — a health check that only proves Node is running
 * is a health check that stays green through an outage.
 */
export const dynamic = 'force-dynamic';

export const GET = withRoute(
  async () => {
    const startedAt = Date.now();
    await prisma.$queryRaw`SELECT 1`;

    return jsonOk(
      {
        status: 'ok',
        database: { reachable: true, latencyMs: Date.now() - startedAt },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  },
  { rateLimit: { limit: 120, windowSeconds: 60 } },
);
