import 'server-only';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '@/generated/prisma/client';
import { env, isDevelopment, isProduction } from '@/lib/env';

/**
 * Prisma client singleton.
 *
 * Next's dev server hot-reloads modules on every edit; without the global cache
 * each reload would open a fresh connection pool and exhaust Postgres within a
 * few minutes of editing.
 *
 * In production on Vercel each serverless instance holds one client, so
 * `DATABASE_URL` must point at a pooler (PgBouncer / Neon / Supabase pooling
 * endpoint). A few thousand concurrent users would otherwise open more direct
 * connections than Postgres allows.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  // Prisma 7 talks to Postgres through a driver adapter rather than a bundled
  // engine binary — smaller cold starts and a connection pool we can tune.
  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
    // Serverless: keep the per-instance pool small, and let the external pooler
    // do the real multiplexing.
    max: isProduction ? 5 : 10,
  });

  return new PrismaClient({
    adapter,
    log: isDevelopment ? ['warn', 'error'] : ['error'],
  });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (!isProduction) globalForPrisma.prisma = prisma;
