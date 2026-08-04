import 'dotenv/config';

import { createScriptClient } from '../prisma/client';

/**
 * Counts what one product page costs in database round trips.
 *
 *   npm run measure:product
 *
 * Written because "it feels slow" is not a bug report and "I made it faster" is
 * not a fix. Timings here include the real network to Neon, so the *ratio*
 * between strategies is the signal, not the absolute number.
 */
const prisma = createScriptClient();

const PRODUCT_INCLUDE = {
  brand: true,
  seo: true,
  primaryCategory: true,
  categories: { select: { category: true } },
  collections: { select: { collection: true } },
  tags: true,
  media: { select: { position: true, media: true } },
  options: { include: { values: true } },
  variants: { include: { inventory: true, selections: true } },
  productAttributes: { include: { definition: true } },
} as const;

async function time(label: string, run: () => Promise<unknown>): Promise<number> {
  const started = Date.now();
  await run();
  const elapsed = Date.now() - started;
  console.log(`  ${String(elapsed).padStart(6)}ms  ${label}`);
  return elapsed;
}

async function main(): Promise<void> {
  const sample = await prisma.product.findFirst({
    where: { status: 'ACTIVE' },
    select: { slug: true },
  });

  if (!sample) {
    console.log('No active product to measure.');
    await prisma.$disconnect();
    return;
  }

  // Warm the connection so the first measurement is not a Neon cold start.
  await prisma.$queryRaw`SELECT 1`;

  console.log('\nOne product query\n');

  const asQuery = await time("relationLoadStrategy 'query' (Prisma default)", () =>
    prisma.product.findFirst({
      relationLoadStrategy: 'query',
      where: { slug: sample.slug },
      include: PRODUCT_INCLUDE,
    }),
  );

  const asJoin = await time("relationLoadStrategy 'join' (one statement)", () =>
    prisma.product.findFirst({
      relationLoadStrategy: 'join',
      where: { slug: sample.slug },
      include: PRODUCT_INCLUDE,
    }),
  );

  console.log('\nA whole product page\n');

  /*
   * The page calls `resolve()` twice — once in `generateMetadata`, once in the
   * body — and each miss on the category lookup falls through to the full
   * product query. Nothing memoises it, despite a comment claiming React's
   * request cache does.
   */
  const duplicated = await time('as the page does it today (resolve runs twice)', async () => {
    for (const _pass of [1, 2]) {
      void _pass;
      await prisma.category.findFirst({ where: { path: `/${sample.slug}`, isActive: true } });
      await prisma.product.findFirst({
        relationLoadStrategy: 'query',
        where: { slug: sample.slug },
        include: PRODUCT_INCLUDE,
      });
    }
  });

  const deduped = await time('memoised, joined (one resolve, one statement)', async () => {
    await prisma.category.findFirst({ where: { path: `/${sample.slug}`, isActive: true } });
    await prisma.product.findFirst({
      relationLoadStrategy: 'join',
      where: { slug: sample.slug },
      include: PRODUCT_INCLUDE,
    });
  });

  const saved = Math.round(((duplicated - deduped) / duplicated) * 100);

  console.log(`\n  join vs query on one product: ${asQuery}ms → ${asJoin}ms`);
  console.log(`  whole page: ${duplicated}ms → ${deduped}ms  (${saved}% less waiting)\n`);

  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
