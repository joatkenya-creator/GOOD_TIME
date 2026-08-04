import { chromium } from 'playwright';

/**
 * The admin's write paths, driven through the real UI.
 *
 *   npm run build && npx next start -p 3000
 *   npm run db:seed:admin
 *   npm run verify:admin-crud
 *
 * `verify:admin` proves the permission model holds and every page renders. This
 * proves the other half: that filling in a form actually changes the database.
 * Those are different failures — a screen can render perfectly and save
 * nothing, and a passing render test says nothing about it.
 *
 * Every check verifies by **reloading the page afterwards**. Reading back the
 * value the form just echoed proves only that React kept it in memory; coming
 * back to it on a fresh request is the only evidence it was written down.
 *
 * Creates its own records and deletes them again.
 */
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const OWNER = 'owner.demo@example.test';
const PASSWORD = 'GoodTimeAdmin2026!';

/** Stamped into every record so a failed run's leftovers are identifiable. */
const RUN = Date.now().toString(36).slice(-5).toUpperCase();

let passed = 0;
let failed = 0;
const failures = [];

function check(label, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(name) {
  console.log(`\n${name}`);
}

async function signIn(page) {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type="email"]', OWNER);
  await page.fill('input[type="password"]', PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).first().click();
  await page.waitForFunction(() => !window.location.pathname.startsWith('/sign-in'), {
    timeout: 30_000,
  });
}

/** Reload and return the main region's text — the persistence assertion. */
async function reloadText(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  return (await page.locator('main').textContent()) ?? '';
}

/*
 * Submit, then wait for the *result*.
 *
 * Every earlier version of this file slept for a fixed 1500ms and then
 * navigated away. A save against this database takes about four seconds, so the
 * harness was aborting the very writes it was testing and reporting them as
 * persistence failures — convincingly enough that I nearly filed them as
 * application bugs.
 *
 * A duration is a guess about someone else's latency. The confirmation message
 * and a settled network are facts.
 */
async function submitAndSettle(page, buttonName, { expectLive = false } = {}) {
  if (expectLive) {
    // The product editor reports through an aria-live region, which is the
    // most direct evidence available: the server said "saved".
    await page.getByRole('button', { name: buttonName }).first().click();
    await page
      .waitForFunction(
        () => {
          const live = document.querySelector('[aria-live="polite"]');
          return Boolean(live && live.textContent && live.textContent.trim().length > 0);
        },
        { timeout: 40000 },
      )
      .catch(() => undefined);
    return;
  }

  /*
   * Wait for the action's own POST to come back.
   *
   * `networkidle` is the trap here: the page is already idle at the moment of
   * the click, so it resolves instantly and the harness navigates away before
   * the server action has even been dispatched. Three writes were silently
   * abandoned that way — a product duplicate, a stock adjustment and a set of
   * customer tags — and every one was reported as a persistence bug in code
   * that was working perfectly.
   *
   * The POST response is the thing that actually means "the server has
   * finished". Some of these actions redirect, so a navigation counts too.
   */
  await Promise.all([
    page
      .waitForResponse((response) => response.request().method() === 'POST', { timeout: 40000 })
      .catch(() => undefined),
    page.getByRole('button', { name: buttonName }).first().click(),
  ]);

  // Server actions revalidate and re-render after responding; give that render
  // a moment to land before anything reads the DOM.
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => undefined);
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: 'gt.age_ok', value: '1', url: BASE }]);

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 140)));

  await signIn(page);

  let productUrl = null;

  // ------------------------------------------------------ 1. Product CRUD
  section('Product CRUD');

  const productName = `Verify Wand ${RUN}`;
  const productSlug = `verify-wand-${RUN.toLowerCase()}`;

  await page.goto(`${BASE}/admin/products/new`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);

  await page.fill('#name', productName);
  await page.fill('#slug', productSlug);
  await page.fill('#shortDescription', 'Created by the CRUD verification.');
  await page.fill('#sku', `VER-${RUN}`);
  await page.getByRole('button', { name: /create product/i }).click();

  /*
   * Creation redirects to the editor, which is how we learn the id.
   *
   * The wait explicitly excludes `/new`. An earlier version matched
   * `/admin/products/<anything>` and so resolved instantly on the form itself,
   * before the action had finished — the harness then navigated away
   * mid-request, aborted the creation it was testing, and reported a failure
   * that was entirely its own doing.
   */
  const landed = await page
    .waitForFunction(
      () => {
        const id = window.location.pathname.split('/').pop();
        return Boolean(id) && id !== 'new' && window.location.pathname.startsWith('/admin/products/');
      },
      { timeout: 30_000 },
    )
    .then(() => true)
    .catch(() => false);

  check('a product can be created', landed, `landed on ${new URL(page.url()).pathname}`);
  productUrl = new URL(page.url()).pathname;

  const inList = await reloadText(page, '/admin/products?q=' + encodeURIComponent(RUN));
  check('the new product appears in the list', inList.includes(productName));

  // Read the status from the editor, not the list: the list's filter chips
  // include the word "Drafts", so searching the page text for it passes even
  // when no row is a draft — and passed exactly that way until this was fixed.
  await page.goto(`${BASE}${productUrl}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  check(
    'it starts as a draft, not live',
    (await page.locator('#status').inputValue()) === 'DRAFT',
    `status is ${await page.locator('#status').inputValue()}`,
  );

  // --- Update ---
  const editedName = `${productName} Edited`;
  await page.goto(`${BASE}${productUrl}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.fill('#name', editedName);
  await page.fill('#subtitle', 'Subtitle written by the harness');
  await submitAndSettle(page, /save changes/i, { expectLive: true });

  await page.goto(`${BASE}${productUrl}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  check(
    'an edit survives a reload',
    (await page.locator('#name').inputValue()) === editedName,
    `read "${await page.locator('#name').inputValue()}"`,
  );
  check(
    'a second field on the same save also persisted',
    (await page.locator('#subtitle').inputValue()) === 'Subtitle written by the harness',
  );

  // --- SEO on the product, which is the per-record half of "SEO persists" ---
  await page.getByRole('tab', { name: /seo/i }).click();
  await page.fill('#seoTitle', `SEO title ${RUN}`);
  await page.fill('#seoDescription', `SEO description ${RUN}`);
  await submitAndSettle(page, /save changes/i, { expectLive: true });

  await page.goto(`${BASE}${productUrl}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.getByRole('tab', { name: /seo/i }).click();
  check(
    'product SEO metadata persists',
    (await page.locator('#seoTitle').inputValue()) === `SEO title ${RUN}`,
    `read "${await page.locator('#seoTitle').inputValue()}"`,
  );

  // --- Publish, which is the status transition the list filters on ---
  await page.selectOption('#status', 'ACTIVE');
  await submitAndSettle(page, /save changes/i, { expectLive: true });

  await page.goto(`${BASE}${productUrl}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  check(
    'publishing persists',
    (await page.locator('#status').inputValue()) === 'ACTIVE',
    `status is ${await page.locator('#status').inputValue()}`,
  );

  // And the row itself, read from the table rather than the whole page.
  await page.goto(`${BASE}/admin/products?q=${encodeURIComponent(RUN)}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  const row = (await page.locator('main table tbody tr').first().textContent()) ?? '';
  check('the list row shows it as published', row.includes('Published'), row.slice(0, 80));

  // --- Duplicate ---
  await page.goto(`${BASE}${productUrl}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await submitAndSettle(page, /duplicate/i);

  const afterCopy = await reloadText(page, '/admin/products?q=' + encodeURIComponent(RUN));
  check('a product can be duplicated', afterCopy.includes('(copy)'));
  // The copy must not go live on its own — that would put an unedited
  // "Copy of..." on the shop.
  check('the duplicate is a draft, whatever the original was', afterCopy.includes('Draft'));

  // --- History, which proves the audit trail is written on real edits ---
  await page.goto(`${BASE}${productUrl}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  const detail = (await page.locator('main').textContent()) ?? '';
  check('the product records its own edit history', /History/i.test(detail));

  // --------------------------------------------------------- 2. Inventory
  section('Inventory');

  await page.goto(`${BASE}/admin/inventory`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);

  const rows = page.locator('main table tbody tr');
  const hasStockRows = (await rows.count()) > 0;

  if (!hasStockRows) {
    console.log('  (skipped: no inventory rows to adjust)');
  } else {
    /*
     * Target a row by its SKU, never by position.
     *
     * This table is sorted by quantity ascending, so adjusting a row moves it.
     * An earlier version read "the first row" before and after — which is a
     * different variant each time — and then applied the reverting adjustment
     * to whichever row had taken its place. That is not a flaky test, it is a
     * test that writes to the wrong record; it left seven units of phantom
     * stock on a product nobody had touched.
     */
    const sku = (await rows.first().locator('td').first().textContent())?.match(/GT-[\w-]+/)?.[0];

    if (!sku) {
      console.log('  (skipped: could not identify a SKU to adjust)');
    } else {
      const rowFor = (label) => page.locator('main table tbody tr', { hasText: label });

      // Column 2 is "On hand". Reading the cell, not scraping digits out of the
      // whole row — the row text contains the SKU, whose digits an earlier
      // version happily parsed as a stock level.
      const onHand = async () =>
        Number((await rowFor(sku).locator('td').nth(1).textContent())?.trim() ?? '0');

      const before = await onHand();

      await rowFor(sku).locator('input[name="delta"]').fill('7');
      await rowFor(sku).locator('select[name="reason"]').selectOption('RECEIVED');
      await Promise.all([
        page
          .waitForResponse((response) => response.request().method() === 'POST', { timeout: 40000 })
          .catch(() => undefined),
        rowFor(sku).getByRole('button', { name: /adjust stock for/i }).click(),
      ]);
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => undefined);

      await page.goto(`${BASE}/admin/inventory?q=${encodeURIComponent(sku)}`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForLoadState('networkidle').catch(() => undefined);

      const after = await onHand();
      check(
        'the stock quantity itself changed',
        after === before + 7,
        `${sku} went ${before} -> ${after}, expected ${before + 7}`,
      );

      const body = (await page.locator('main').textContent()) ?? '';
      check(
        'the ledger records the adjustment, its reason and its size',
        /received/i.test(body) && /\+7/.test(body),
        'no "+7 received" entry found',
      );

      // Put it back — on the same row, found the same way.
      await rowFor(sku).locator('input[name="delta"]').fill('-7');
      await rowFor(sku).locator('select[name="reason"]').selectOption('CORRECTION');
      await Promise.all([
        page
          .waitForResponse((response) => response.request().method() === 'POST', { timeout: 40000 })
          .catch(() => undefined),
        rowFor(sku).getByRole('button', { name: /adjust stock for/i }).click(),
      ]);
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => undefined);

      await page.goto(`${BASE}/admin/inventory?q=${encodeURIComponent(sku)}`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForLoadState('networkidle').catch(() => undefined);
      check(
        'the verification leaves the stock as it found it',
        (await onHand()) === before,
        `${sku} left at ${await onHand()}, started at ${before}`,
      );
    }
  }

  // -------------------------------------------------- 3. Customers
  section('Customer management');

  await page.goto(`${BASE}/admin/customers`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);

  const customerLink = page.locator('main a[href^="/admin/customers/"]').first();
  const hasCustomer = (await customerLink.count()) > 0;

  if (!hasCustomer) {
    console.log('  (skipped: no customers)');
  } else {
    const customerPath = await customerLink.getAttribute('href');
    await page.goto(`${BASE}${customerPath}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);

    const note = `Verification note ${RUN}`;
    await page.fill('#customer-note', note);
    await submitAndSettle(page, /add note/i);

    const afterNote = await reloadText(page, customerPath);
    check('a staff note on a customer persists', afterNote.includes(note));

    await page.fill('#tags', `verify-${RUN.toLowerCase()}`);
    await submitAndSettle(page, /save tags/i);

    /*
     * Read the input's value, not the page's text.
     *
     * Tags render inside an `<input>` for anyone who can edit them, and
     * `textContent` does not include input values — so the previous assertion
     * searched the page for a string that was never going to be in it, and
     * reported a persistence failure against code that persists perfectly.
     */
    await page.goto(`${BASE}${customerPath}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    check(
      'customer tags persist',
      (await page.locator('#tags').inputValue()).includes(`verify-${RUN.toLowerCase()}`),
      `read "${await page.locator('#tags').inputValue()}"`,
    );

    // Tags exist to segment on, so the filter has to actually narrow the list —
    // "the page rendered" is not evidence of that.
    const filtered = await reloadText(
      page,
      `/admin/customers?tag=${encodeURIComponent(`verify-${RUN.toLowerCase()}`)}`,
    );
    const unfiltered = await reloadText(page, '/admin/customers');
    check(
      'filtering by tag narrows the customer list',
      filtered.length < unfiltered.length && !/No customers match/i.test(filtered),
      `${filtered.length} vs ${unfiltered.length} chars`,
    );

    // Remove the tag again.
    await page.goto(`${BASE}${customerPath}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.fill('#tags', '');
    await submitAndSettle(page, /save tags/i);
  }

  // ----------------------------------------------------------- 4. Orders
  section('Order management');

  await page.goto(`${BASE}/admin/orders`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);

  const orderLink = page.locator('main a[href^="/admin/orders/"]').first();
  const hasOrder = (await orderLink.count()) > 0;

  if (!hasOrder) {
    console.log('  (skipped: no orders)');
  } else {
    const orderPath = await orderLink.getAttribute('href');
    await page.goto(`${BASE}${orderPath}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);

    const detailText = (await page.locator('main').textContent()) ?? '';
    check('an order detail shows its line items', /Items/i.test(detailText));
    check('an order detail shows its timeline', /Timeline/i.test(detailText));

    const orderNote = `Order note ${RUN}`;
    await page.fill('#note-body', orderNote);
    await submitAndSettle(page, /add note/i);

    const afterOrderNote = await reloadText(page, orderPath);
    check('an internal note on an order persists', afterOrderNote.includes(orderNote));

    // Documents staff actually print.
    const slip = await context.request.get(
      `${BASE}/api/admin/orders/${orderPath.split('/').pop()}/packing-slip`,
    );
    check('a packing slip renders', slip.status() === 200, `got ${slip.status()}`);
    const slipHtml = await slip.text();
    check('the packing slip carries no prices', !/\$\d/.test(slipHtml));

    const label = await context.request.get(
      `${BASE}/api/admin/orders/${orderPath.split('/').pop()}/label`,
    );
    check('a shipping label renders', label.status() === 200, `got ${label.status()}`);
  }

  // ------------------------------------------------------------- 5. CMS
  section('CMS — pages, blocks and blog');

  const pageTitle = `Verify Page ${RUN}`;
  await page.goto(`${BASE}/admin/content`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);

  await page.fill('#page-title', pageTitle);
  await page.fill('#page-slug', `verify-page-${RUN.toLowerCase()}`);
  await page.fill('#page-content', 'Body written by the CRUD verification.');
  await submitAndSettle(page, /create page/i);

  const afterPage = await reloadText(page, '/admin/content');
  check('a CMS page can be created and persists', afterPage.includes(pageTitle));

  const blockTitle = `Verify FAQ ${RUN}`;
  await page.selectOption('#block-type', 'FAQ');
  await page.fill('#block-title', blockTitle);
  await page.fill('#block-body', 'Answer written by the verification.');
  await submitAndSettle(page, /add block/i);

  const afterBlock = await reloadText(page, '/admin/content');
  check('a content block can be created and persists', afterBlock.includes(blockTitle));

  const postTitle = `Verify Post ${RUN}`;
  await page.goto(`${BASE}/admin/blog`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);

  await page.fill('#post-title', postTitle);
  await page.fill('#post-slug', `verify-post-${RUN.toLowerCase()}`);
  await page.fill('#post-content', 'A blog post body, long enough to compute a reading time from.');
  await page.fill('#post-tags', `verify-${RUN.toLowerCase()}`);
  await submitAndSettle(page, /save post/i);

  const afterPost = await reloadText(page, '/admin/blog');
  check('a blog post can be created and persists', afterPost.includes(postTitle));
  check('the post keeps the tag it was given', afterPost.includes(`verify-${RUN.toLowerCase()}`));
  check('reading time is computed from the body', /min read/i.test(afterPost));

  // ------------------------------------------------------------- 6. SEO
  section('SEO');

  const source = `/verify-${RUN.toLowerCase()}`;
  await page.goto(`${BASE}/admin/seo`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);

  await page.fill('#redirect-source', source);
  await page.fill('#redirect-destination', '/shop');
  await page.selectOption('#redirect-code', '301');
  await page.fill('#redirect-note', `Created by verification ${RUN}`);
  await submitAndSettle(page, /add redirect/i);

  const afterRedirect = await reloadText(page, '/admin/seo');
  check('a redirect can be created and persists', afterRedirect.includes(source));
  check('the redirect records its type', afterRedirect.includes('301'));

  // A chain is refused at save — the check that stops crawl budget leaking.
  await page.fill('#redirect-source', '/shop');
  await page.fill('#redirect-destination', source);
  await submitAndSettle(page, /add redirect/i);

  const afterChain = await reloadText(page, '/admin/seo');
  const chainCount = (afterChain.match(/\/shop/g) ?? []).length;
  check('a redirect chain is refused rather than saved', chainCount < 4, `${chainCount} matches`);

  // ---------------------------------------------------- 7. Audit coverage
  section('Everything above was audited');

  const audit = await reloadText(page, '/admin/audit');
  check('the audit log recorded the product work', /Product/.test(audit));
  check('the audit log recorded the content work', /Page|ContentBlock|Post/.test(audit));

  // -------------------------------------------------------------- Cleanup
  section('Cleanup');

  // Products: select every row matching this run and delete.
  await page.goto(`${BASE}/admin/products?q=${encodeURIComponent(RUN)}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForLoadState('networkidle').catch(() => undefined);

  const boxes = page.locator('input[name="selected"]');
  const count = await boxes.count();
  for (let index = 0; index < count; index += 1) await boxes.nth(index).check();

  if (count > 0) {
    await submitAndSettle(page, /^Delete$/);
  }

  const leftover = await reloadText(page, `/admin/products?q=${encodeURIComponent(RUN)}`);
  check('the verification products were cleaned up', !leftover.includes('Verify Wand'));

  // Content blocks and redirects have their own delete buttons.
  await page.goto(`${BASE}/admin/seo`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  const redirectRow = page.locator('tr', { hasText: source });
  if ((await redirectRow.count()) > 0) {
    await redirectRow.getByRole('button', { name: /delete/i }).first().click();
    await page.waitForLoadState('networkidle').catch(() => undefined);
  }

  await page.goto(`${BASE}/admin/content`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  const blockRow = page.locator('li', { hasText: blockTitle });
  if ((await blockRow.count()) > 0) {
    await blockRow.getByRole('button', { name: /delete/i }).first().click();
    await page.waitForLoadState('networkidle').catch(() => undefined);
  }

  check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join('; '));

  await browser.close();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  for (const failure of failures) console.log(`  FAILED: ${failure}`);
  console.log(
    '\nNote: pages and posts are left behind deliberately — neither has a delete\n' +
      'control yet, which is itself worth knowing. They are prefixed "Verify".\n',
  );
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
