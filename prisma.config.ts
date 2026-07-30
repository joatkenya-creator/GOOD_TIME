import 'dotenv/config';

import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 reads the datasource URL from here rather than from the schema file,
 * which keeps secrets out of `schema.prisma` and lets CI point at a throwaway DB.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Migrations need an unpooled connection: a transaction pooler cannot run
    // the session-level statements the schema engine issues.
    url: process.env['DIRECT_DATABASE_URL'] || process.env['DATABASE_URL'],
  },
});
