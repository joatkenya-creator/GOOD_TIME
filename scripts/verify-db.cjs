require('dotenv/config');
const { Client } = require('pg');

/**
 * Ad-hoc schema verification.
 *
 * Confirms the hand-written half of the migration actually landed — Prisma has no
 * awareness of the functional indexes, extensions or check constraints, so
 * `migrate status` reporting "up to date" proves nothing about them.
 *
 *   node scripts/verify-db.cjs
 */
(async () => {
  const client = new Client({
    connectionString: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL,
  });
  await client.connect();

  const tables = await client.query(
    "select table_name from information_schema.tables where table_schema='public' order by 1",
  );
  console.log(`Tables (${tables.rows.length}):`);
  console.log('  ' + tables.rows.map((r) => r.table_name).join(', '));

  const indexes = await client.query(
    "select indexname from pg_indexes where schemaname='public' and (indexname like '%trgm%' or indexname like '%fts%' or indexname like '%live%') order by 1",
  );
  console.log('\nFunctional / partial indexes:');
  console.log('  ' + (indexes.rows.map((r) => r.indexname).join(', ') || '(none)'));

  const checks = await client.query(
    "select conname from pg_constraint where contype='c' and connamespace='public'::regnamespace order by 1",
  );
  console.log('\nCheck constraints:');
  console.log('  ' + (checks.rows.map((r) => r.conname).join(', ') || '(none)'));

  const extension = await client.query("select extname from pg_extension where extname='pg_trgm'");
  console.log('\npg_trgm installed:', extension.rows.length > 0);

  const counts = await client.query(`
    select 'products' as t, count(*)::int as n from products
    union all select 'variants', count(*)::int from variants
    union all select 'categories', count(*)::int from categories
    union all select 'brands', count(*)::int from brands
    union all select 'collections', count(*)::int from collections
    union all select 'reviews', count(*)::int from reviews
    union all select 'search docs', count(*)::int from product_search_documents
    order by 1
  `);
  console.log('\nRow counts:');
  for (const row of counts.rows) console.log(`  ${row.t.padEnd(14)} ${row.n}`);

  await client.end();
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
