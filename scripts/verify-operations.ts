import 'dotenv/config';

import { XMLParser } from 'fast-xml-parser';

import { createScriptClient } from '../prisma/client';

/**
 * Product operations, search, SEO and marketing — end to end.
 *
 *   npm run build && npx next start -p 3000
 *   npm run verify:operations
 *
 * This runs a real import against a real feed, drains the real queue, and reads
 * the resulting pages over HTTP. Unit-testing the parser proves the parser
 * works; it says nothing about whether an import job actually completes, writes
 * its logs, and leaves products someone can find.
 *
 * Everything it creates is prefixed and deleted at the end.
 */
const prisma = createScriptClient();

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const RUN = Date.now().toString(36).slice(-5).toUpperCase();

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1;
  } else {
    failed += 1;
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(name: string): void {
  console.log(`\n${name}`);
}

/** Cleanup registry, so a mid-run failure still tidies up. */
const created = {
  templateIds: [] as string[],
  importJobIds: [] as string[],
  productIds: [] as string[],
  redirectIds: [] as string[],
  scheduleIds: [] as string[],
};

async function main(): Promise<void> {
  console.log('\nProduct operations, search, SEO and marketing\n');

  try {
    await verifyImports();
    await verifyScheduler();
    await verifySearch();
    await verifyMetadata();
    await verifySitemaps();
    await verifyStructuredData();
    await verifyRedirects();
    await verifyMarketing();
  } finally {
    await cleanup();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  for (const failure of failures) console.log(`  FAILED: ${failure}`);

  await prisma.$disconnect();
  if (failed > 0) process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. Imports
// ---------------------------------------------------------------------------

async function verifyImports(): Promise<void> {
  section('Import jobs');

  const { enqueue } = await import('../src/lib/jobs/queue');
  const { drain } = await import('../src/lib/jobs/worker');
  const { rollbackImport } = await import('../src/services/import/runner');

  /*
   * A feed with a deliberate duplicate and a deliberate bad row.
   *
   * Testing only the happy path proves an importer can read a clean file,
   * which no real supplier ships. Row 3 repeats row 1's SKU; row 4 has no
   * price. Both must be caught and both must be *recorded* — an import that
   * silently drops rows is worse than one that fails.
   */
  const feed = [
    'item_no,sku,product_name,wholesale_price,stock_qty,long_description',
    `OPS-1,OPS-${RUN}-1,Verify Wand One,24.99,12,A wand for verification purposes with sufficient description length.`,
    `OPS-2,OPS-${RUN}-2,Verify Bullet Two,"12,50",30,A bullet for verification with a European decimal separator.`,
    `OPS-1,OPS-${RUN}-1,Verify Wand One Again,29.99,5,Duplicate of the first row and should be skipped.`,
    `OPS-4,OPS-${RUN}-4,Verify No Price,,8,This row has no price and must fail validation.`,
  ].join('\n');

  const template = await prisma.importTemplate.create({
    data: {
      name: `Operations verification ${RUN}`,
      sourceType: 'CSV',
      mapping: {
        externalId: { from: 'item_no' },
        sku: { from: 'sku' },
        name: { from: 'product_name' },
        description: { from: 'long_description' },
        priceCents: { from: 'wholesale_price', transform: 'money_to_cents' },
        quantity: { from: 'stock_qty', transform: 'integer' },
      } as never,
      defaults: { currency: 'USD' } as never,
    },
    select: { id: true },
  });
  created.templateIds.push(template.id);

  // --- dry run -------------------------------------------------------------
  const dryJob = await prisma.importJob.create({
    data: {
      sourceType: 'CSV',
      sourceName: `Dry run ${RUN}`,
      templateId: template.id,
      isDryRun: true,
      config: { content: feed } as never,
    },
    select: { id: true },
  });
  created.importJobIds.push(dryJob.id);

  await enqueue({ kind: 'import.run', payload: { importJobId: dryJob.id } });
  await drain({ maxJobs: 5, maxMs: 60_000 });

  const dryResult = await prisma.importJob.findUniqueOrThrow({ where: { id: dryJob.id } });
  check('a dry run completes', dryResult.status === 'COMPLETED', dryResult.status);

  const dryProducts = await prisma.product.count({ where: { sku: { startsWith: `OPS-${RUN}` } } });
  check('a dry run writes no products', dryProducts === 0, `${dryProducts} created`);

  const dryRows = await prisma.importRow.count({ where: { jobId: dryJob.id } });
  check('a dry run still records every row', dryRows === 4, `${dryRows} rows`);

  // --- real run ------------------------------------------------------------
  const job = await prisma.importJob.create({
    data: {
      sourceType: 'CSV',
      sourceName: `Operations import ${RUN}`,
      templateId: template.id,
      config: { content: feed } as never,
    },
    select: { id: true },
  });
  created.importJobIds.push(job.id);

  await enqueue({ kind: 'import.run', payload: { importJobId: job.id } });
  await drain({ maxJobs: 5, maxMs: 60_000 });

  const result = await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } });
  check('the import completes', result.status === 'COMPLETED', result.status);
  check('it counts every row', result.totalRows === 4, String(result.totalRows));

  const rows = await prisma.importRow.findMany({
    where: { jobId: job.id },
    orderBy: { rowNumber: 'asc' },
  });

  check('every row is logged', rows.length === 4, `${rows.length} logged`);

  const outcomes = rows.map((row) => row.outcome);
  check('two products were created', outcomes.filter((o) => o === 'CREATED').length === 2, outcomes.join(','));
  check(
    'the duplicate row is skipped, not applied',
    outcomes.filter((o) => o === 'SKIPPED').length === 1,
    outcomes.join(','),
  );
  check(
    'the invalid row is recorded as failed',
    outcomes.filter((o) => o === 'FAILED').length === 1,
    outcomes.join(','),
  );

  const failedRow = rows.find((row) => row.outcome === 'FAILED');
  check('the failure explains itself', Boolean(failedRow?.message), failedRow?.message ?? 'no message');

  const skipped = rows.find((row) => row.outcome === 'SKIPPED');
  check(
    'the skip says it was a duplicate',
    /duplicate/i.test(skipped?.message ?? ''),
    skipped?.message ?? 'no message',
  );

  // The duplicate must not have overwritten the first row's price.
  const first = await prisma.product.findFirst({
    where: { sku: `OPS-${RUN}-1` },
    select: { id: true, name: true, minPriceCents: true, status: true },
  });

  check('the created product exists', Boolean(first), 'not found');
  check(
    'the duplicate did not overwrite the original',
    first?.name === 'Verify Wand One',
    first?.name,
  );
  check('its price parsed correctly', first?.minPriceCents === 2499, String(first?.minPriceCents));

  /*
   * Imported products arrive as drafts.
   *
   * A feed is a proposal, not a merchandising decision — publishing on import
   * puts a supplier's typo on the storefront before anyone has read it.
   */
  check('imported products are drafts', first?.status === 'DRAFT', first?.status);

  const european = await prisma.product.findFirst({
    where: { sku: `OPS-${RUN}-2` },
    select: { id: true, minPriceCents: true },
  });
  check(
    'a European decimal separator parses correctly',
    european?.minPriceCents === 1250,
    String(european?.minPriceCents),
  );

  for (const product of [first, european]) {
    if (product) created.productIds.push(product.id);
  }

  // --- rollback ------------------------------------------------------------
  const rolled = await rollbackImport(job.id);
  check('rollback reports what it archived', rolled.archived === 2, String(rolled.archived));

  const afterRollback = await prisma.product.findFirst({
    where: { sku: `OPS-${RUN}-1` },
    select: { status: true },
  });
  check(
    'a rolled-back creation is archived, not deleted',
    afterRollback?.status === 'ARCHIVED',
    afterRollback?.status,
  );

  let rejected = false;
  try {
    await rollbackImport(job.id);
  } catch {
    rejected = true;
  }
  check('a second rollback is refused', rejected);
}

// ---------------------------------------------------------------------------
// 2. Scheduler
// ---------------------------------------------------------------------------

async function verifyScheduler(): Promise<void> {
  section('Scheduled jobs');

  const { tickScheduler } = await import('../src/lib/jobs/handlers');

  const schedule = await prisma.scheduledJob.create({
    data: {
      key: `verify-ops-${RUN}`,
      name: `Operations verification ${RUN}`,
      kind: 'jobs.prune',
      cron: '* * * * *',
      payload: { days: 3650 } as never,
      // Already due, so the tick has something to fire.
      nextRunAt: new Date(Date.now() - 60_000),
    },
    select: { id: true },
  });
  created.scheduleIds.push(schedule.id);

  const tick = await tickScheduler();
  check('the tick fires a due schedule', tick.fired >= 1, `${tick.fired} fired`);

  const queued = await prisma.backgroundJob.findFirst({
    where: { scheduleId: schedule.id },
    select: { id: true, kind: true, status: true },
  });

  check('it enqueues the right job kind', queued?.kind === 'jobs.prune', queued?.kind);

  const advanced = await prisma.scheduledJob.findUniqueOrThrow({ where: { id: schedule.id } });
  check(
    'the pointer advances past now',
    (advanced.nextRunAt?.getTime() ?? 0) > Date.now(),
    advanced.nextRunAt?.toISOString(),
  );
  check('the last run is stamped', advanced.lastRunAt !== null);

  /*
   * A second tick in the same minute must not double-fire.
   *
   * Two cron invocations overlapping is normal — a retry, a slow run — and a
   * price sync that runs twice is wasted load at best.
   */
  await prisma.scheduledJob.update({
    where: { id: schedule.id },
    data: { nextRunAt: new Date(Date.now() - 1000) },
  });

  await tickScheduler();
  const jobCount = await prisma.backgroundJob.count({ where: { scheduleId: schedule.id } });
  check('a repeat tick in the same minute does not duplicate', jobCount === 1, `${jobCount} jobs`);

  // A brand-new schedule sets its pointer without firing, so deploying a
  // nightly job at 14:00 does not run it immediately.
  const fresh = await prisma.scheduledJob.create({
    data: {
      key: `verify-fresh-${RUN}`,
      name: `Fresh ${RUN}`,
      kind: 'jobs.prune',
      cron: '0 3 * * *',
      nextRunAt: null,
    },
    select: { id: true },
  });
  created.scheduleIds.push(fresh.id);

  await tickScheduler();
  const freshJobs = await prisma.backgroundJob.count({ where: { scheduleId: fresh.id } });
  check('a never-run schedule does not fire on first sight', freshJobs === 0, `${freshJobs} jobs`);

  const freshRow = await prisma.scheduledJob.findUniqueOrThrow({ where: { id: fresh.id } });
  check('but its pointer is set', freshRow.nextRunAt !== null);
}

// ---------------------------------------------------------------------------
// 3. Search
// ---------------------------------------------------------------------------

async function verifySearch(): Promise<void> {
  section('Search');

  const { searchEngine } = await import('../src/services/search/engine');
  const engine = searchEngine();

  const indexed = await prisma.productSearchDocument.count();
  check('the index has documents', indexed > 0, `${indexed} documents`);

  if (indexed === 0) {
    console.log('  (search checks skipped: run search.reindex_all first)');
    return;
  }

  // A term taken from the catalogue itself, so the assertion is about the
  // engine rather than about whether a hard-coded word happens to exist.
  const sample = await prisma.productSearchDocument.findFirst({ select: { title: true } });
  const word = (sample?.title ?? '').split(/\s+/).find((part) => part.length > 4) ?? 'wand';

  /*
   * Steady state, measured against a baseline round trip.
   *
   * Two things had to be separated here, and I got them wrong twice before
   * measuring:
   *
   *   1. **Cold connection.** The engine uses the application's Prisma
   *      singleton, not this script's client. Warming one says nothing about
   *      the other, and on Neon a cold connection is ~2200ms against ~230ms
   *      warm. The first search through a fresh client pays that once.
   *
   *   2. **Cold caches.** The synonym table and the facet counts are cached;
   *      the first search of a process fills both.
   *
   * Neither is "search is slow" — in production the pool is warm and the
   * caches are filled within seconds of the first visitor. What is worth
   * asserting is the steady state: a warm search should cost a small number of
   * round trips. Measured directly, it is one.
   *
   * A ratio rather than a wall-clock ceiling, because an absolute number here
   * measures the distance to the database, not the query.
   */
  await engine.search({ term: word, pageSize: 24 }); // Warm client and caches.

  const baselineStart = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  const baseline = Math.max(1, Date.now() - baselineStart);

  const started = Date.now();
  const results = await engine.search({ term: word, pageSize: 24 });
  const elapsed = Date.now() - started;

  check(`a search for "${word}" returns results`, results.items.length > 0, `${results.total} hits`);

  const ratio = elapsed / baseline;
  check(
    `a warm search costs few round trips (${elapsed}ms vs ${baseline}ms baseline)`,
    ratio < 6,
    `${ratio.toFixed(1)}x the baseline round trip`,
  );

  check('results carry a relevance score', (results.items[0]?.score ?? 0) > 0);
  check('facets are returned', Array.isArray(results.facets.brands));
  check('a price range is computed', results.facets.priceRange !== null);

  // Typo tolerance: mangle the term and expect the engine to recover.
  const typo = word.slice(0, -1) + (word.endsWith('e') ? 'a' : 'e');
  const fuzzy = await engine.search({ term: typo, pageSize: 10 });
  check(
    `a misspelling ("${typo}") still finds something`,
    fuzzy.items.length > 0,
    `${fuzzy.items.length} hits`,
  );

  // Synonyms, seeded in phase 7.
  const synonym = await prisma.searchSynonym.findFirst({ where: { isActive: true } });
  if (synonym) {
    const viaSynonym = await engine.search({ term: synonym.term, pageSize: 10 });
    check(
      `the synonym "${synonym.term}" resolves without error`,
      Array.isArray(viaSynonym.items),
    );
  }

  const suggestions = await engine.suggest(word.slice(0, 3), 5);
  check('autocomplete returns suggestions', Array.isArray(suggestions));

  const empty = await engine.search({ term: 'zzzzqqqxxnonexistent', pageSize: 10 });
  check('a nonsense query returns nothing rather than everything', empty.items.length === 0, `${empty.items.length}`);
}

// ---------------------------------------------------------------------------
// 4. Metadata
// ---------------------------------------------------------------------------

/** Pulls a meta tag's content out of rendered HTML. */
function metaContent(html: string, key: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${key}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${key}["']`, 'i'),
    new RegExp(`<meta[^>]+name=["']${key}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${key}["']`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

async function verifyMetadata(): Promise<void> {
  section('Dynamic metadata');

  const product = await prisma.product.findFirst({
    where: { status: 'ACTIVE', deletedAt: null },
    select: { slug: true, name: true, primaryCategory: { select: { path: true } } },
  });

  if (!product) {
    console.log('  (skipped: no live products)');
    return;
  }

  const path = product.primaryCategory?.path
    ? `/shop/${product.primaryCategory.path}/${product.slug}`
    : `/shop/${product.slug}`;

  const response = await fetch(`${BASE}${path}`, { headers: { Cookie: 'gt.age_ok=1' } });
  const html = await response.text();

  check('the product page renders', response.status === 200, String(response.status));

  const title = html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? '';
  check('it has a title', title.length > 0, title);
  check(
    'the title is the product, not a template default',
    title.toLowerCase().includes(product.name.toLowerCase().split(' ')[0]!.toLowerCase()),
    title,
  );

  const description = metaContent(html, 'description');
  check('it has a meta description', Boolean(description), description ?? 'missing');

  const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i)?.[1];
  check('it declares a canonical URL', Boolean(canonical), canonical ?? 'missing');
  check(
    'the canonical is absolute',
    (canonical ?? '').startsWith('http'),
    canonical ?? 'missing',
  );

  check('Open Graph title is present', Boolean(metaContent(html, 'og:title')));
  check('Open Graph type is present', Boolean(metaContent(html, 'og:type')));
  check('Open Graph image is present', Boolean(metaContent(html, 'og:image')));
  check('a Twitter card is declared', Boolean(metaContent(html, 'twitter:card')));

  // Two different products must not share a title — that is the duplicate
  // problem the SEO audit exists to find, verified here at the source.
  const second = await prisma.product.findFirst({
    where: { status: 'ACTIVE', deletedAt: null, slug: { not: product.slug } },
    select: { slug: true, primaryCategory: { select: { path: true } } },
  });

  if (second) {
    const secondPath = second.primaryCategory?.path
      ? `/shop/${second.primaryCategory.path}/${second.slug}`
      : `/shop/${second.slug}`;

    const secondHtml = await (
      await fetch(`${BASE}${secondPath}`, { headers: { Cookie: 'gt.age_ok=1' } })
    ).text();

    const secondTitle = secondHtml.match(/<title>([^<]*)<\/title>/i)?.[1] ?? '';
    check('two products have different titles', secondTitle !== title, secondTitle);
  }
}

// ---------------------------------------------------------------------------
// 5. Sitemaps
// ---------------------------------------------------------------------------

async function verifySitemaps(): Promise<void> {
  section('Sitemaps');

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@' });

  // --- the main sitemap ----------------------------------------------------
  const main = await fetch(`${BASE}/sitemap.xml`);
  const mainXml = await main.text();

  check('the sitemap responds', main.status === 200, String(main.status));
  check(
    'it is served as XML',
    (main.headers.get('content-type') ?? '').includes('xml'),
    main.headers.get('content-type') ?? '',
  );

  let mainDoc: Record<string, unknown> | null = null;
  try {
    mainDoc = parser.parse(mainXml) as Record<string, unknown>;
    check('it is well-formed XML', true);
  } catch (error) {
    check('it is well-formed XML', false, String(error));
  }

  const urlset = (mainDoc?.urlset ?? {}) as { url?: unknown };
  const urls = Array.isArray(urlset.url) ? urlset.url : urlset.url ? [urlset.url] : [];
  check('it lists URLs', urls.length > 0, `${urls.length} entries`);

  const locs = urls.map((entry) => String((entry as { loc?: string }).loc ?? ''));
  check('every entry has a location', locs.every(Boolean));
  check('locations are absolute', locs.every((loc) => loc.startsWith('http')), locs[0]);

  // A relative URL in a sitemap is silently ignored by crawlers, which is the
  // worst kind of bug: the file validates and the pages never get indexed.
  check('no duplicate URLs', new Set(locs).size === locs.length, `${locs.length} vs ${new Set(locs).size}`);

  // --- the index -----------------------------------------------------------
  const index = await fetch(`${BASE}/sitemap-index.xml`);
  const indexXml = await index.text();
  check('the sitemap index responds', index.status === 200, String(index.status));

  const indexDoc = parser.parse(indexXml) as { sitemapindex?: { sitemap?: unknown } };
  const sitemaps = Array.isArray(indexDoc.sitemapindex?.sitemap)
    ? indexDoc.sitemapindex.sitemap
    : indexDoc.sitemapindex?.sitemap
      ? [indexDoc.sitemapindex.sitemap]
      : [];

  check('the index lists sitemaps', sitemaps.length >= 3, `${sitemaps.length} listed`);

  /*
   * Every sitemap the index advertises must actually resolve.
   *
   * An index pointing at a 404 is worse than no index — Search Console reports
   * it as an error against the whole submission.
   */
  const broken: string[] = [];
  for (const entry of sitemaps) {
    const loc = String((entry as { loc?: string }).loc ?? '');
    if (!loc) continue;
    const probe = await fetch(loc, { method: 'HEAD' });
    if (probe.status >= 400) broken.push(`${loc} -> ${probe.status}`);
  }
  check('every sitemap in the index resolves', broken.length === 0, broken.join('; '));

  // --- image sitemap -------------------------------------------------------
  const images = await fetch(`${BASE}/sitemap-images.xml?page=0`);
  const imageXml = await images.text();
  check('the image sitemap responds', images.status === 200, String(images.status));
  check(
    'it declares the image namespace',
    imageXml.includes('sitemap-image/1.1'),
    'namespace missing',
  );

  const imageDoc = parser.parse(imageXml) as { urlset?: { url?: unknown } };
  const imageUrls = Array.isArray(imageDoc.urlset?.url)
    ? imageDoc.urlset.url
    : imageDoc.urlset?.url
      ? [imageDoc.urlset.url]
      : [];

  if (imageUrls.length > 0) {
    const withImages = imageUrls.filter((entry) => 'image:image' in (entry as object));
    check('image entries carry images', withImages.length > 0, `${withImages.length}/${imageUrls.length}`);
  }

  // --- video and news ------------------------------------------------------
  for (const [name, namespace] of [
    ['sitemap-videos.xml', 'sitemap-video/1.1'],
    ['sitemap-news.xml', 'sitemap-news/0.9'],
  ]) {
    const response = await fetch(`${BASE}/${name}`);
    const xml = await response.text();

    check(`${name} responds`, response.status === 200, String(response.status));
    check(`${name} declares its namespace`, xml.includes(namespace!));

    try {
      parser.parse(xml);
      check(`${name} is well-formed`, true);
    } catch (error) {
      check(`${name} is well-formed`, false, String(error));
    }
  }

  // --- robots --------------------------------------------------------------
  const robots = await fetch(`${BASE}/robots.txt`);
  const robotsText = await robots.text();
  check('robots.txt responds', robots.status === 200, String(robots.status));
  check('robots.txt points at a sitemap', /sitemap:/i.test(robotsText));

  // --- merchant feed -------------------------------------------------------
  const feed = await fetch(`${BASE}/feeds/merchant.xml`);
  const feedXml = await feed.text();
  check('the Merchant feed responds', feed.status === 200, String(feed.status));
  check('it declares the g: namespace', feedXml.includes('base.google.com/ns/1.0'));

  try {
    const feedDoc = parser.parse(feedXml) as { rss?: { channel?: { item?: unknown } } };
    check('the feed is well-formed', true);

    const items = Array.isArray(feedDoc.rss?.channel?.item)
      ? feedDoc.rss.channel.item
      : feedDoc.rss?.channel?.item
        ? [feedDoc.rss.channel.item]
        : [];

    if (items.length > 0) {
      const first = items[0] as Record<string, unknown>;
      for (const required of ['g:id', 'g:title', 'g:link', 'g:price', 'g:availability']) {
        check(`feed items carry ${required}`, required in first, Object.keys(first).join(','));
      }
      // Getting this wrong risks the whole Merchant account, not one listing.
      check('feed items declare adult status', 'g:adult' in first);
    }
  } catch (error) {
    check('the feed is well-formed', false, String(error));
  }
}

// ---------------------------------------------------------------------------
// 6. Structured data
// ---------------------------------------------------------------------------

/** Extracts and parses every JSON-LD block from a page. */
function extractJsonLd(html: string): Record<string, unknown>[] {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];

  const parsed: Record<string, unknown>[] = [];

  for (const block of blocks) {
    try {
      const value = JSON.parse(block[1] ?? '{}');
      if (Array.isArray(value)) parsed.push(...value);
      else parsed.push(value);
    } catch {
      // A block that will not parse is itself a finding, reported by the
      // caller through the count mismatch.
    }
  }

  return parsed;
}

async function verifyStructuredData(): Promise<void> {
  section('Structured data');

  // --- homepage ------------------------------------------------------------
  const home = await (await fetch(BASE, { headers: { Cookie: 'gt.age_ok=1' } })).text();
  const homeSchemas = extractJsonLd(home);

  check('the homepage emits JSON-LD', homeSchemas.length > 0, `${homeSchemas.length} blocks`);

  const types = homeSchemas.map((schema) => String(schema['@type'] ?? ''));
  check('it declares an Organization', types.includes('Organization'), types.join(','));
  check('it declares a WebSite', types.includes('WebSite'), types.join(','));

  const website = homeSchemas.find((schema) => schema['@type'] === 'WebSite');
  check(
    'the WebSite carries a SearchAction',
    Boolean(website && 'potentialAction' in website),
    'missing potentialAction',
  );

  // --- product -------------------------------------------------------------
  const product = await prisma.product.findFirst({
    where: { status: 'ACTIVE', deletedAt: null, media: { some: {} } },
    select: { slug: true, primaryCategory: { select: { path: true } } },
  });

  if (!product) {
    console.log('  (product schema skipped: no live product with media)');
    return;
  }

  const path = product.primaryCategory?.path
    ? `/shop/${product.primaryCategory.path}/${product.slug}`
    : `/shop/${product.slug}`;

  const productHtml = await (
    await fetch(`${BASE}${path}`, { headers: { Cookie: 'gt.age_ok=1' } })
  ).text();

  const schemas = extractJsonLd(productHtml);
  check('the product page emits JSON-LD', schemas.length > 0, `${schemas.length} blocks`);

  const productSchema = schemas.find((schema) => schema['@type'] === 'Product');
  check('it declares a Product', Boolean(productSchema), schemas.map((s) => s['@type']).join(','));

  if (productSchema) {
    /*
     * Google's required fields for a Product rich result.
     *
     * Missing any one of these means the markup is ignored entirely — not
     * partially honoured — so the page loses its rich result while appearing
     * to have valid structured data.
     */
    for (const required of ['name', 'image', 'description']) {
      check(`Product has ${required}`, required in productSchema, Object.keys(productSchema).join(','));
    }

    const offers = productSchema.offers as Record<string, unknown> | undefined;
    check('Product carries an Offer', Boolean(offers), 'no offers');

    if (offers) {
      /*
       * `Offer` or `AggregateOffer`, both valid.
       *
       * A product whose variants span a price range is an AggregateOffer with
       * `lowPrice` and `highPrice`; a single-price product is an Offer with
       * `price`. Asserting only the latter would have failed every product
       * with more than one variant — which is most of them.
       */
      const hasPrice = 'price' in offers || ('lowPrice' in offers && 'highPrice' in offers);
      check('the Offer names a price', hasPrice, Object.keys(offers).join(','));
      check('the Offer names a currency', 'priceCurrency' in offers, Object.keys(offers).join(','));
      check('the Offer states availability', 'availability' in offers, Object.keys(offers).join(','));

      const availability = String(offers.availability ?? '');
      check(
        'availability is a schema.org URL',
        availability.startsWith('https://schema.org/'),
        availability,
      );
    }

    // A rating must not be asserted unless it is real and displayed.
    const rating = productSchema.aggregateRating as Record<string, unknown> | undefined;
    if (rating) {
      check('a declared rating has a review count', 'reviewCount' in rating);
      check('the review count is above one', Number(rating.reviewCount ?? 0) > 1, String(rating.reviewCount));
    }
  }

  const breadcrumb = schemas.find((schema) => schema['@type'] === 'BreadcrumbList');
  check('the product page declares a BreadcrumbList', Boolean(breadcrumb));

  if (breadcrumb) {
    const items = breadcrumb.itemListElement as unknown[] | undefined;
    check('the breadcrumb has items', Array.isArray(items) && items.length > 0);
  }

  // Every block must be valid JSON — a broken one silently voids the page's
  // entire structured-data payload.
  const rawBlocks = [...productHtml.matchAll(/type=["']application\/ld\+json["']/gi)].length;
  check('every JSON-LD block parses', schemas.length >= rawBlocks, `${schemas.length} of ${rawBlocks}`);
}

// ---------------------------------------------------------------------------
// 7. Redirects
// ---------------------------------------------------------------------------

async function verifyRedirects(): Promise<void> {
  section('Redirects');

  const source = `/verify-ops-${RUN.toLowerCase()}`;

  const redirect = await prisma.redirect.create({
    data: { source, destination: '/shop', statusCode: 301, isActive: true },
    select: { id: true },
  });
  created.redirectIds.push(redirect.id);

  const response = await fetch(`${BASE}${source}`, {
    redirect: 'manual',
    headers: { Cookie: 'gt.age_ok=1' },
  });

  /*
   * 308, not 301 — and that is correct.
   *
   * A Server Component cannot emit an arbitrary status, so a permanent
   * redirect is served as 308. Google's documentation states 308 is treated
   * exactly as 301 for indexing, and 308 additionally preserves the request
   * method where 301 historically allowed browsers to rewrite POST to GET.
   */
  check(
    'an active permanent redirect is served',
    response.status === 301 || response.status === 308,
    `${response.status}`,
  );

  const location = response.headers.get('location') ?? '';
  check('it points at the destination', location.includes('/shop'), location);

  // A hit counter is what makes a dead redirect retirable on evidence rather
  // than on a guess.
  const after = await prisma.redirect.findUniqueOrThrow({ where: { id: redirect.id } });
  check('the hit is counted', after.hits >= 1, String(after.hits));
  check('the last hit is stamped', after.lastHitAt !== null);

  // Disabled redirects must stop redirecting.
  await prisma.redirect.update({ where: { id: redirect.id }, data: { isActive: false } });

  const disabled = await fetch(`${BASE}${source}`, {
    redirect: 'manual',
    headers: { Cookie: 'gt.age_ok=1' },
  });
  check(
    'a disabled redirect no longer fires',
    ![301, 302, 307, 308].includes(disabled.status),
    String(disabled.status),
  );

  // A 302 must be served as a 302 — the difference is months of browser cache.
  await prisma.redirect.update({
    where: { id: redirect.id },
    data: { isActive: true, statusCode: 302 },
  });

  const temporary = await fetch(`${BASE}${source}`, {
    redirect: 'manual',
    headers: { Cookie: 'gt.age_ok=1' },
  });
  check(
    'a temporary redirect is served as such',
    temporary.status === 302 || temporary.status === 307,
    String(temporary.status),
  );
}

// ---------------------------------------------------------------------------
// 8. Marketing
// ---------------------------------------------------------------------------

async function verifyMarketing(): Promise<void> {
  section('Marketing integrations');

  const { saveIntegration, activeIntegrations, partitioned, PROVIDERS } = await import(
    '../src/services/marketing/integrations'
  );

  check('every provider is defined', PROVIDERS.length === 10, String(PROVIDERS.length));

  const rows = await prisma.marketingIntegration.count();
  check('all providers have a row', rows === 10, String(rows));

  const before = await activeIntegrations();
  const beforeCount = before.length;

  // --- configure -----------------------------------------------------------
  await saveIntegration({
    provider: 'GA4',
    isEnabled: true,
    publicId: 'G-VERIFY12345',
    requiresConsent: true,
  });

  const after = await activeIntegrations();
  check('an enabled integration appears', after.length === beforeCount + 1, `${after.length}`);

  const ga4 = after.find((entry) => entry.provider === 'GA4');
  check('its public id is stored', ga4?.publicId === 'G-VERIFY12345', ga4?.publicId ?? 'missing');

  /*
   * A malformed id is refused rather than saved.
   *
   * A pixel with a typo'd id fails silently — the script loads, the request
   * 404s, and nobody notices for a month because the tag *looks* installed.
   */
  let refused = false;
  try {
    await saveIntegration({
      provider: 'GA4',
      isEnabled: true,
      publicId: 'not-a-measurement-id',
      requiresConsent: true,
    });
  } catch {
    refused = true;
  }
  check('a malformed measurement id is refused', refused);

  // --- consent partitioning ------------------------------------------------
  const split = await partitioned();
  check(
    'a consent-requiring tag is held back',
    split.onConsent.some((entry) => entry.provider === 'GA4'),
    split.onConsent.map((entry) => entry.provider).join(','),
  );
  check(
    'it is not in the immediate set',
    !split.immediate.some((entry) => entry.provider === 'GA4'),
  );

  // Search Console sets no cookies, so it may load immediately.
  await saveIntegration({
    provider: 'GOOGLE_SEARCH_CONSOLE',
    isEnabled: true,
    publicId: 'verify-token-12345',
    requiresConsent: false,
  });

  const split2 = await partitioned();
  check(
    'a cookieless tag may load immediately',
    split2.immediate.some((entry) => entry.provider === 'GOOGLE_SEARCH_CONSOLE'),
    split2.immediate.map((entry) => entry.provider).join(','),
  );

  // --- the storefront must honour it ---------------------------------------
  const html = await (await fetch(BASE, { headers: { Cookie: 'gt.age_ok=1' } })).text();

  /*
   * The critical assertion.
   *
   * Without consent, a consent-requiring tag must not appear in the HTML at
   * all — not blocked, not commented, not present-but-inert. A script on the
   * page is a script that can run.
   */
  check(
    'without consent, the GA4 id is absent from the page',
    !html.includes('G-VERIFY12345'),
    'the measurement id was rendered',
  );

  const consented = await (
    await fetch(BASE, { headers: { Cookie: 'gt.age_ok=1; gt.consent=granted' } })
  ).text();

  // The tag is rendered client-side after hydration, so the id may legitimately
  // be absent from the server HTML either way. What must never happen is the
  // reverse: present without consent. That is what the check above enforces.
  check(
    'the consent cookie is accepted without error',
    consented.length > 0,
    'empty response',
  );

  // --- restore -------------------------------------------------------------
  await saveIntegration({ provider: 'GA4', isEnabled: false, publicId: null, requiresConsent: true });
  await saveIntegration({
    provider: 'GOOGLE_SEARCH_CONSOLE',
    isEnabled: false,
    publicId: null,
    requiresConsent: false,
  });
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

async function cleanup(): Promise<void> {
  section('Cleanup');

  await prisma.backgroundJob.deleteMany({
    where: { scheduleId: { in: created.scheduleIds } },
  });
  await prisma.scheduledJob.deleteMany({ where: { id: { in: created.scheduleIds } } });
  await prisma.importRow.deleteMany({ where: { jobId: { in: created.importJobIds } } });
  await prisma.importJob.deleteMany({ where: { id: { in: created.importJobIds } } });
  await prisma.importTemplate.deleteMany({ where: { id: { in: created.templateIds } } });
  await prisma.redirect.deleteMany({ where: { id: { in: created.redirectIds } } });

  // Products created by the import: remove their variants and inventory first.
  const products = await prisma.product.findMany({
    where: { sku: { startsWith: `OPS-${RUN}` } },
    select: { id: true, variants: { select: { id: true } } },
  });

  const variantIds = products.flatMap((product) => product.variants.map((variant) => variant.id));

  if (variantIds.length > 0) {
    await prisma.stockAdjustment.deleteMany({ where: { variantId: { in: variantIds } } });
    await prisma.inventory.deleteMany({ where: { variantId: { in: variantIds } } });
    await prisma.variant.deleteMany({ where: { id: { in: variantIds } } });
  }

  if (products.length > 0) {
    await prisma.productSearchDocument.deleteMany({
      where: { productId: { in: products.map((product) => product.id) } },
    });
    await prisma.product.deleteMany({ where: { id: { in: products.map((p) => p.id) } } });
  }

  const leftover = await prisma.product.count({ where: { sku: { startsWith: `OPS-${RUN}` } } });
  check('the verification left nothing behind', leftover === 0, `${leftover} products remain`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
