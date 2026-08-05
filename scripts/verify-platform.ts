import 'dotenv/config';

import { createScriptClient } from '../prisma/client';
import { parseCron, nextRun, isValidCron, describeCron } from '../src/lib/jobs/cron';
import { parseCsv, parseXml, parseJson, detectDelimiter } from '../src/services/import/adapters';
import { moneyToCents, mapRow, suggestMapping, validateRow } from '../src/services/import/mapper';
import { checkUpload, checkFeedUrl, neutraliseFormula } from '../src/lib/security/uploads';

/**
 * Phase 7's logic, verified against its edge cases.
 *
 *   npm run verify:platform
 *
 * Everything here is a pure function with a documented contract and a failure
 * mode that costs money: a money parser that loses a penny, a queue that hands
 * one job to two workers, a CSV parser that mangles a quoted description, an
 * SSRF guard that lets a feed URL reach the metadata endpoint.
 *
 * The queue section writes to the database and cleans up after itself.
 */
const prisma = createScriptClient();

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

async function main(): Promise<void> {
  console.log('\nPhase 7 platform\n');

  // ------------------------------------------------------------ money
  section('Money parsing');

  check('plain decimal', moneyToCents('19.99') === 1999, String(moneyToCents('19.99')));
  check('European comma', moneyToCents('19,99') === 1999, String(moneyToCents('19,99')));
  check('currency symbol', moneyToCents('$19.99') === 1999, String(moneyToCents('$19.99')));
  check('thousands, US', moneyToCents('1,234.56') === 123456, String(moneyToCents('1,234.56')));
  check('thousands, EU', moneyToCents('1.234,56') === 123456, String(moneyToCents('1.234,56')));
  check('whole number', moneyToCents('20') === 2000, String(moneyToCents('20')));
  check('one decimal place', moneyToCents('19.9') === 1990, String(moneyToCents('19.9')));
  check('trailing spaces', moneyToCents('  5.00  ') === 500, String(moneyToCents('  5.00  ')));
  check('empty is null', moneyToCents('') === null);
  check('garbage is null', moneyToCents('call us') === null, String(moneyToCents('call us')));

  /*
   * The float trap.
   *
   * `parseFloat("19.99") * 100` is 1998.9999999999998. Any parser that rounds
   * that is one `Math.floor` away from charging a penny less, forever.
   */
  check(
    'no floating-point drift across a range',
    ['0.01', '0.07', '1.10', '19.99', '99.99', '129.95'].every((value) => {
      const cents = moneyToCents(value);
      const expected = Math.round(Number(value) * 100);
      return cents === expected;
    }),
  );

  // -------------------------------------------------------------- CSV
  section('CSV parsing');

  const csv = parseCsv('sku,name,price\nA1,Widget,19.99\nA2,"Wand, large",29.99\n');
  check('reads the header', csv.columns.join(',') === 'sku,name,price', csv.columns.join(','));
  check('reads both rows', csv.rows.length === 2, String(csv.rows.length));
  check(
    'a comma inside quotes stays in the field',
    csv.rows[1]?.name === 'Wand, large',
    csv.rows[1]?.name,
  );

  const quoted = parseCsv('a,b\n"say ""hi""",2\n');
  check('doubled quotes unescape', quoted.rows[0]?.a === 'say "hi"', quoted.rows[0]?.a);

  const multiline = parseCsv('a,b\n"line one\nline two",2\n');
  check(
    'a newline inside quotes does not split the row',
    multiline.rows.length === 1 && multiline.rows[0]?.a?.includes('\n') === true,
    `${multiline.rows.length} rows`,
  );

  const bom = parseCsv('﻿sku,name\nA1,Widget\n');
  check('a UTF-8 BOM does not corrupt the first column', bom.columns[0] === 'sku', bom.columns[0]);

  const semi = parseCsv('sku;name;price\nA1;Widget;19,99\n', ';');
  check('a semicolon delimiter works', semi.rows[0]?.price === '19,99', semi.rows[0]?.price);

  check('the delimiter is detected', detectDelimiter('a;b;c\n1;2;3') === ';');
  check('a comma is the fallback', detectDelimiter('single-column') === ',');

  const noTrailing = parseCsv('a,b\n1,2');
  check('a last line without a newline still counts', noTrailing.rows.length === 1);

  // -------------------------------------------------------------- XML
  section('XML and JSON');

  const xml = parseXml(`<?xml version="1.0"?>
    <rss><channel>
      <item><g:id>1</g:id><g:title>Wand</g:title><g:price>19.99 USD</g:price></item>
      <item><g:id>2</g:id><g:title>Bullet</g:title><g:price>9.99 USD</g:price></item>
    </channel></rss>`);

  check('finds the repeating item element', xml.rows.length === 2, String(xml.rows.length));
  check('namespaces become legal keys', xml.rows[0]?.g_title === 'Wand', xml.rows[0]?.g_title);

  const single = parseXml('<rss><channel><item><id>1</id></item></channel></rss>');
  check('a feed with one item is still a list', single.rows.length === 1);

  const json = parseJson('{"products":[{"sku":"A1","price":10},{"sku":"A2","price":20}]}');
  check('finds a nested product array', json.rows.length === 2, String(json.rows.length));

  const bare = parseJson('[{"sku":"A1"}]');
  check('a bare array works', bare.rows.length === 1);

  // ----------------------------------------------------------- mapping
  section('Field mapping');

  const suggested = suggestMapping([
    'item_no',
    'SKU',
    'product_name',
    'wholesale_price',
    'stock_qty',
  ]);
  check('guesses the id column', (suggested.externalId as { from: string })?.from === 'item_no');
  check(
    'guesses the price column and its transform',
    (suggested.priceCents as { from: string; transform: string })?.transform === 'money_to_cents',
  );

  const mapped = mapRow(
    {
      item_no: 'X1',
      SKU: 'SKU-1',
      product_name: 'Wand',
      wholesale_price: '$24.50',
      cat: 'Toys > Wands',
    },
    {
      externalId: { from: 'item_no' },
      sku: { from: 'SKU' },
      name: { from: 'product_name' },
      priceCents: { from: 'wholesale_price', transform: 'money_to_cents' },
      categoryPath: { from: 'cat' },
    },
    { currency: 'USD' },
  );

  check('maps and converts price', mapped.data.priceCents === 2450, String(mapped.data.priceCents));
  check('defaults fill what the feed omits', mapped.data.currency === 'USD');
  check(
    'a category path splits on its separator',
    Array.isArray(mapped.data.categoryPath) && (mapped.data.categoryPath as string[]).length === 2,
    JSON.stringify(mapped.data.categoryPath),
  );

  const valid = validateRow(mapped.data);
  check('a complete row validates', valid.ok, valid.errors.join('; '));

  const invalid = validateRow({ sku: 'X', name: '', priceCents: -1 });
  check('a row missing required fields is refused', !invalid.ok);
  check('the failure names the fields', invalid.errors.length > 0, invalid.errors.join('; '));

  // Relative image URLs resolve against the *supplier's* host, not ours.
  const images = mapRow(
    { img: 'https://cdn.example.test/a.jpg|/relative/b.jpg|http://insecure.test/c.jpg' },
    { imageUrls: { from: 'img' } },
  );
  check(
    'only absolute https image URLs survive',
    (images.data.imageUrls as string[]).length === 1,
    JSON.stringify(images.data.imageUrls),
  );

  // ---------------------------------------------------------- security
  section('Upload and feed validation');

  const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]).buffer;
  check('a Windows executable named .csv is refused', !checkUpload('feed.csv', exe).ok);

  const elf = new Uint8Array([0x7f, 0x45, 0x4c, 0x46]).buffer;
  check('a Linux binary is refused', !checkUpload('feed.json', elf).ok);

  const text = new TextEncoder().encode('sku,name\nA1,Widget\n').buffer;
  check('a real CSV passes', checkUpload('feed.csv', text).ok);

  check('an unlisted extension is refused', !checkUpload('feed.php', text).ok);
  check('an empty file is refused', !checkUpload('feed.csv', new ArrayBuffer(0)).ok);

  const fakeXlsx = new TextEncoder().encode('not a zip').buffer;
  check('an .xlsx that is not a zip is refused', !checkUpload('book.xlsx', fakeXlsx).ok);

  check('http feed URLs are refused', !checkFeedUrl('http://feeds.example.test/a.csv').ok);
  check('https feed URLs pass', checkFeedUrl('https://feeds.example.test/a.csv').ok);
  check('localhost is refused', !checkFeedUrl('https://localhost/feed.csv').ok);
  check(
    'the cloud metadata address is refused',
    !checkFeedUrl('https://169.254.169.254/latest').ok,
  );
  check('private ranges are refused', !checkFeedUrl('https://10.0.0.5/feed.csv').ok);
  check('.internal is refused', !checkFeedUrl('https://db.internal/feed.csv').ok);

  check('a formula cell is neutralised', neutraliseFormula('=1+1').startsWith("'"));
  check('a plain value is untouched', neutraliseFormula('Wand') === 'Wand');
  check('a negative number is neutralised', neutraliseFormula('-5').startsWith("'"));

  // -------------------------------------------------------------- cron
  section('Cron');

  check('validates a good expression', isValidCron('0 2 * * *'));
  check('rejects four fields', !isValidCron('0 2 * *'));
  check('rejects an out-of-range value', !isValidCron('0 99 * * *'));

  const hourly = parseCron('0 * * * *');
  check('hourly matches minute zero only', hourly.minute.size === 1 && hourly.hour.size === 24);

  const everyFive = parseCron('*/15 * * * *');
  check('a step expands correctly', everyFive.minute.size === 4, String(everyFive.minute.size));

  const range = parseCron('0 9-17 * * 1-5');
  check('a range expands correctly', range.hour.size === 9 && range.dayOfWeek.size === 5);

  const from = new Date('2026-03-15T12:30:00Z');
  const next = nextRun('0 2 * * *', from);
  check(
    'the next run is tomorrow at 02:00',
    next?.toISOString() === '2026-03-16T02:00:00.000Z',
    next?.toISOString(),
  );

  /*
   * The classic cron trap: with both day fields restricted, POSIX cron ORs
   * them. "0 0 1 * 1" is the 1st AND every Monday, not Mondays that fall on
   * the 1st. Getting this backwards makes a monthly job nearly never run.
   */
  const bothDays = parseCron('0 0 1 * 1');
  check('both day fields restricted means OR', bothDays.bothDaysRestricted);

  check('describes a common schedule in words', describeCron('0 0 * * *').includes('Daily'));

  // ------------------------------------------------------------- queue
  section('The job queue');

  const { enqueue, claim, succeed, fail, stats, registerHandler } =
    await import('../src/lib/jobs/queue');

  registerHandler('verify.noop', async () => ({ ok: true }));

  const created: string[] = [];

  try {
    const first = await enqueue({ kind: 'verify.noop', payload: { n: 1 } });
    created.push(first.id);
    check('a job can be enqueued', Boolean(first.id));

    // Dedupe: the same key twice is one job, which is what stops a bulk edit
    // of four hundred products queueing four hundred identical reindexes.
    const a = await enqueue({ kind: 'verify.noop', dedupeKey: 'verify:dedupe' });
    const b = await enqueue({ kind: 'verify.noop', dedupeKey: 'verify:dedupe' });
    created.push(a.id);
    check('a duplicate dedupe key collapses', a.id === b.id && b.deduped);

    /*
     * The race that matters.
     *
     * Two workers claiming at once must not both get the same job. Without
     * `FOR UPDATE SKIP LOCKED` they do, and the job runs twice — which for an
     * import means every product created twice.
     */
    const [claimA, claimB] = await Promise.all([claim('worker-a', 5), claim('worker-b', 5)]);

    const idsA = new Set(claimA.map((job) => job.id));
    const overlap = claimB.filter((job) => idsA.has(job.id));

    check(
      'two workers never claim the same job',
      overlap.length === 0,
      `${overlap.length} overlapped`,
    );

    for (const job of [...claimA, ...claimB]) {
      if (!created.includes(job.id)) created.push(job.id);
    }

    // Succeeding and failing.
    const one = claimA[0] ?? claimB[0];
    if (one) {
      await succeed(one.id, { done: true });
      const row = await prisma.backgroundJob.findUnique({ where: { id: one.id } });
      check('a successful job is marked succeeded', row?.status === 'SUCCEEDED', row?.status);
      check('its result is recorded', row?.result !== null);
    }

    // A job that exhausts its retries becomes DEAD, not deleted — the
    // dead-letter queue is a status, so "show me what broke" is one filter.
    const doomed = await enqueue({ kind: 'verify.noop', maxAttempts: 1 });
    created.push(doomed.id);

    const claimed = await claim('worker-c', 10);
    const target = claimed.find((job) => job.id === doomed.id);

    if (target) {
      const outcome = await fail(doomed.id, new Error('verification failure'));
      check('an exhausted job goes to the dead-letter queue', outcome === 'dead', outcome);

      const row = await prisma.backgroundJob.findUnique({ where: { id: doomed.id } });
      check('it is kept, not deleted', row !== null);
      check('its error is recorded', Boolean(row?.lastError));
    }

    for (const job of claimed) {
      if (!created.includes(job.id)) created.push(job.id);
    }

    const queueHealth = await stats();
    check('stats report a shape', typeof queueHealth.queued === 'number');
  } finally {
    if (created.length > 0) {
      await prisma.backgroundJob.deleteMany({ where: { id: { in: created } } });
    }
    await prisma.backgroundJob.deleteMany({ where: { kind: 'verify.noop' } });
  }

  // ------------------------------------------------------------- report
  console.log(`\n${passed} passed, ${failed} failed\n`);
  for (const failure of failures) console.log(`  FAILED: ${failure}`);

  await prisma.$disconnect();
  if (failed > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
