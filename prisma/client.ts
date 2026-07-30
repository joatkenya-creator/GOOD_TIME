import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client';

/**
 * Prisma client for scripts (seed, one-off maintenance tasks).
 *
 * Separate from `src/lib/prisma.ts` because that module imports `server-only`
 * and the validated env, neither of which applies outside the Next runtime.
 */
export function createScriptClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env first.');
  }

  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
