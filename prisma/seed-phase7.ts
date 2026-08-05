import 'dotenv/config';

import { createScriptClient } from './client';
import { DEFAULT_SCHEDULES } from '../src/lib/jobs/handlers';
import { nextRun } from '../src/lib/jobs/cron';

/**
 * Phase 7 seed: schedules, templates, synonyms, and a plausible history.
 *
 *   npm run db:seed:phase7
 *
 * Idempotent. The analytics and search history are generated rather than
 * hand-written, because a dashboard tested against four rows tells you nothing
 * about what it looks like against ninety days of traffic — and "the funnel
 * chart is unreadable at real volume" is a defect you want to find here.
 *
 * All fictional. Supplier names are invented, and the two feed URLs point at
 * `example.test`, a reserved domain that resolves nowhere, so a scheduled sync
 * cannot accidentally hit a real third party.
 */
const prisma = createScriptClient();

/** Deterministic pseudo-random, so re-running produces the same shape. */
function seeded(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

async function seedSchedules(): Promise<void> {
  console.log('Schedules');

  for (const schedule of DEFAULT_SCHEDULES) {
    const payload = 'payload' in schedule ? schedule.payload : {};

    await prisma.scheduledJob.upsert({
      where: { key: schedule.key },
      update: {
        name: schedule.name,
        kind: schedule.kind,
        cron: schedule.cron,
        description: schedule.description,
      },
      create: {
        key: schedule.key,
        name: schedule.name,
        kind: schedule.kind,
        cron: schedule.cron,
        description: schedule.description,
        payload: (payload ?? {}) as never,
        // Set so the first tick does not fire everything at once. A nightly
        // job deployed at 14:00 that runs immediately is not nightly.
        nextRunAt: nextRun(schedule.cron),
      },
    });

    console.log(`  ${schedule.name} — ${schedule.cron}`);
  }
}

async function seedTemplates(): Promise<void> {
  console.log('\nImport templates');

  const templates = [
    {
      name: 'Meridian Wholesale CSV',
      sourceType: 'CSV' as const,
      config: { url: 'https://feeds.example.test/meridian/catalogue.csv', delimiter: ',' },
      mapping: {
        externalId: { from: 'item_no' },
        sku: { from: 'sku' },
        name: { from: 'product_name' },
        description: { from: 'long_description', transform: 'strip_html' },
        brandName: { from: 'manufacturer' },
        categoryPath: { from: 'category' },
        priceCents: { from: 'wholesale_price', transform: 'money_to_cents' },
        compareAtPriceCents: { from: 'rrp', transform: 'money_to_cents' },
        quantity: { from: 'stock_qty', transform: 'integer' },
        imageUrls: { from: 'images' },
        barcode: { from: 'ean' },
        material: { from: 'material' },
      },
      defaults: { currency: 'USD' },
    },
    {
      name: 'Aurelia Partner Feed (Merchant XML)',
      sourceType: 'GOOGLE_MERCHANT' as const,
      config: { url: 'https://feeds.example.test/aurelia/products.xml' },
      mapping: {
        externalId: { from: 'g_id' },
        sku: { from: 'g_mpn' },
        name: { from: 'g_title' },
        description: { from: 'g_description', transform: 'strip_html' },
        brandName: { from: 'g_brand' },
        categoryPath: { from: 'g_product_type' },
        priceCents: { from: 'g_price', transform: 'money_to_cents' },
        imageUrls: { from: 'g_image_link' },
        barcode: { from: 'g_gtin' },
        isActive: { from: 'g_availability', transform: 'boolean' },
      },
      defaults: { currency: 'USD' },
    },
    {
      name: 'Manual spreadsheet upload',
      sourceType: 'EXCEL' as const,
      config: {},
      mapping: {
        externalId: { from: 'ID' },
        sku: { from: 'SKU' },
        name: { from: 'Name' },
        description: { from: 'Description' },
        priceCents: { from: 'Price', transform: 'money_to_cents' },
        quantity: { from: 'Stock', transform: 'integer' },
      },
      defaults: { currency: 'USD' },
    },
  ];

  for (const template of templates) {
    await prisma.importTemplate.upsert({
      where: { name_sourceType: { name: template.name, sourceType: template.sourceType } },
      update: { mapping: template.mapping as never, config: template.config as never },
      create: {
        name: template.name,
        sourceType: template.sourceType,
        mapping: template.mapping as never,
        defaults: template.defaults as never,
        config: template.config as never,
      },
    });

    console.log(`  ${template.name}`);
  }
}

async function seedSynonyms(): Promise<void> {
  console.log('\nSearch synonyms');

  const synonyms = [
    {
      term: 'bullet',
      synonyms: ['mini vibrator', 'lipstick vibe', 'pocket vibrator'],
      isOneWay: false,
    },
    { term: 'wand', synonyms: ['massager', 'body wand'], isOneWay: false },
    { term: 'lube', synonyms: ['lubricant', 'gel'], isOneWay: false },
    { term: 'waterproof', synonyms: ['shower safe', 'submersible'], isOneWay: false },
    // One-way: searching "silicone" should surface body-safe products, but
    // searching "body safe" should not return every silicone item.
    { term: 'body safe', synonyms: ['silicone', 'medical grade'], isOneWay: true },
    { term: 'quiet', synonyms: ['discreet', 'whisper'], isOneWay: true },
  ];

  for (const entry of synonyms) {
    await prisma.searchSynonym.upsert({
      where: { term: entry.term },
      update: { synonyms: entry.synonyms, isOneWay: entry.isOneWay },
      create: entry,
    });
  }

  console.log(`  ${synonyms.length} synonym groups`);
}

async function seedMarketing(): Promise<void> {
  console.log('\nMarketing integrations');

  /*
   * Every one seeded as disabled with no id.
   *
   * A demo dataset that ships an enabled pixel is a demo dataset that starts
   * sending real visitor data to a third party the moment it is deployed. The
   * rows exist so the admin screen has something to show; switching one on is
   * a deliberate act.
   */
  const providers = [
    'GA4',
    'GTM',
    'GOOGLE_ADS',
    'GOOGLE_MERCHANT',
    'GOOGLE_SEARCH_CONSOLE',
    'META_PIXEL',
    'TIKTOK_PIXEL',
    'PINTEREST_TAG',
    'MICROSOFT_UET',
    'LINKEDIN_INSIGHT',
  ] as const;

  for (const provider of providers) {
    await prisma.marketingIntegration.upsert({
      where: { provider },
      update: {},
      create: {
        provider,
        isEnabled: false,
        requiresConsent: !['GOOGLE_MERCHANT', 'GOOGLE_SEARCH_CONSOLE'].includes(provider),
      },
    });
  }

  console.log(`  ${providers.length} providers, all disabled`);
}

async function seedAnalytics(): Promise<void> {
  console.log('\nAnalytics history');

  const existing = await prisma.analyticsDaily.count();
  if (existing > 0) {
    console.log('  (already present, skipped)');
    return;
  }

  const random = seeded(20260804);
  const days = 90;

  const rows: {
    day: Date;
    metric: string;
    dimension: string;
    value: number;
    valueCents: number;
  }[] = [];

  for (let offset = days; offset >= 0; offset -= 1) {
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    day.setUTCDate(day.getUTCDate() - offset);

    /*
     * A weekly rhythm with a slow upward trend.
     *
     * Flat random noise makes every chart look the same and hides whether the
     * sparkline is actually plotting anything. Real traffic has weekends, and
     * a dashboard should be tested against data that has a shape.
     */
    const weekday = day.getUTCDay();
    const weekend = weekday === 0 || weekday === 6 ? 1.35 : 1;
    const growth = 1 + (days - offset) / days / 3;
    const noise = 0.85 + random() * 0.3;

    const sessions = Math.round(420 * weekend * growth * noise);
    const pageViews = Math.round(sessions * (3.2 + random()));
    const productViews = Math.round(sessions * (1.4 + random() * 0.6));
    const searches = Math.round(sessions * 0.28);
    const addToCart = Math.round(sessions * (0.11 + random() * 0.03));
    const checkouts = Math.round(addToCart * (0.52 + random() * 0.1));
    const purchases = Math.round(checkouts * (0.63 + random() * 0.12));
    const revenue = purchases * Math.round(6200 + random() * 4000);

    const add = (metric: string, value: number, cents = 0, dimension = '') =>
      rows.push({ day, metric, dimension, value, valueCents: cents });

    add('sessions', sessions);
    add('page_views', pageViews);
    add('product_views', productViews);
    add('searches', searches);
    add('add_to_cart', addToCart);
    add('begin_checkout', checkouts);
    add('purchases', purchases);
    add('revenue', purchases, revenue);

    // Mobile-heavy, as this category reliably is.
    add('device', Math.round(pageViews * 0.62), 0, 'mobile');
    add('device', Math.round(pageViews * 0.09), 0, 'tablet');
    add('device', Math.round(pageViews * 0.29), 0, 'desktop');

    add('medium', Math.round(pageViews * 0.41), 0, 'organic');
    add('medium', Math.round(pageViews * 0.28), 0, 'none');
    add('medium', Math.round(pageViews * 0.18), 0, 'referral');
    add('medium', Math.round(pageViews * 0.13), 0, 'social');
  }

  await prisma.analyticsDaily.createMany({ data: rows, skipDuplicates: true });
  console.log(`  ${rows.length} daily rollup rows across ${days} days`);
}

async function seedSearchHistory(): Promise<void> {
  console.log('\nSearch history');

  const existing = await prisma.searchQuery.count();
  if (existing > 50) {
    console.log('  (already present, skipped)');
    return;
  }

  const random = seeded(778101);

  const found = [
    'wand',
    'bullet vibrator',
    'silicone',
    'waterproof',
    'lube',
    'beginner kit',
    'rechargeable',
    'quiet vibrator',
    'body safe',
    'travel lock',
    'glass',
    'couples',
    'massage oil',
    'storage bag',
    'gift set',
  ];

  // The commercially interesting half: demand the catalogue cannot serve.
  const notFound = [
    'app controlled',
    'long distance',
    'warming lube',
    'vegan lube',
    'stainless steel',
    'plus size harness',
    'sound machine',
    'latex free gloves',
  ];

  const rows: { term: string; resultCount: number; createdAt: Date }[] = [];

  for (let index = 0; index < 900; index += 1) {
    const daysAgo = Math.floor(random() * 30);
    const createdAt = new Date(
      Date.now() - daysAgo * 86_400_000 - Math.floor(random() * 86_400_000),
    );

    const isMiss = random() < 0.14;
    const pool = isMiss ? notFound : found;
    const term = pool[Math.floor(random() * pool.length)]!;

    rows.push({
      term,
      resultCount: isMiss ? 0 : 1 + Math.floor(random() * 24),
      createdAt,
    });
  }

  await prisma.searchQuery.createMany({ data: rows });
  console.log(`  ${rows.length} searches, ~14% with no results`);
}

async function seedJobHistory(): Promise<void> {
  console.log('\nJob history');

  const existing = await prisma.backgroundJob.count();
  if (existing > 0) {
    console.log('  (already present, skipped)');
    return;
  }

  const random = seeded(424242);
  const kinds = ['price.sync', 'inventory.sync', 'analytics.rollup', 'search.index', 'seo.audit'];

  const rows: {
    kind: string;
    status: 'SUCCEEDED' | 'DEAD' | 'QUEUED';
    attempts: number;
    createdAt: Date;
    finishedAt: Date | null;
    lastError: string | null;
  }[] = [];

  for (let index = 0; index < 60; index += 1) {
    const kind = kinds[Math.floor(random() * kinds.length)]!;
    const createdAt = new Date(Date.now() - Math.floor(random() * 7 * 86_400_000));

    // A couple of dead jobs, so the dead-letter panel is not permanently empty
    // in a demo — and so anyone reviewing the screen sees what a failure reads
    // like before one happens for real.
    const dead = index < 2;

    rows.push({
      kind,
      status: dead ? 'DEAD' : 'SUCCEEDED',
      attempts: dead ? 5 : 1,
      createdAt,
      finishedAt: new Date(createdAt.getTime() + Math.floor(random() * 30_000)),
      lastError: dead ? 'Error: The feed returned 503 Service Unavailable.' : null,
    });
  }

  await prisma.backgroundJob.createMany({ data: rows });
  console.log(`  ${rows.length} jobs, 2 in the dead-letter queue`);
}

async function main(): Promise<void> {
  console.log('\nSeeding phase 7\n');

  await seedSchedules();
  await seedTemplates();
  await seedSynonyms();
  await seedMarketing();
  await seedAnalytics();
  await seedSearchHistory();
  await seedJobHistory();

  console.log('\nDone. All fictional; feed URLs point at example.test and resolve nowhere.\n');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
