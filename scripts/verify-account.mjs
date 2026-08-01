import { chromium } from 'playwright';

/**
 * The customer account area, in a real browser.
 *
 * Signs in as a seeded customer and walks every page: that they load, that they
 * are protected, that they are not indexable, and that the data on screen is the
 * data in the database.
 *
 *   npm run db:seed:customers
 *   npm run build && npx next start -p 3100
 *   node scripts/verify-account.mjs
 *
 * Same two rules as the checkout harness: never retry a mutating click, and poll
 * for the expected state rather than for a duration.
 */

// 127.0.0.1, not `localhost`: Chromium may resolve the name to ::1 while Next
// binds IPv4 only, which surfaces as ERR_CONNECTION_REFUSED against a live server.
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3100';
const EMAIL = 'ada.demo@example.test';
const PASSWORD = 'GoodTimeDemo2026!';

let passed = 0;
let failed = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function hydrated(page) {
  return page.waitForFunction(
    () => {
      const root = document.querySelector('main');
      return !!root && Object.keys(root).some((key) => key.startsWith('__react'));
    },
    { timeout: 25_000 },
  );
}


/**
 * Horizontal overflow — the defining responsive bug.
 *
 * Anything inside a deliberate `overflow-x` container is excluded: the account
 * nav and the product rails scroll sideways on purpose.
 */
const OVERFLOW_PROBE = (viewportWidth) => {
  const overflow = document.documentElement.scrollWidth - viewportWidth;
  if (overflow <= 1) return { overflow: 0, offenders: [] };

  const offenders = [];
  const all = Array.prototype.slice.call(document.body.querySelectorAll('*'));

  for (let i = 0; i < all.length; i++) {
    const element = all[i];
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.right <= viewportWidth + 1) continue;

    let node = element;
    let scrollable = false;
    while (node && node !== document.body) {
      const x = getComputedStyle(node).overflowX;
      if (x === 'auto' || x === 'scroll') { scrollable = true; break; }
      node = node.parentElement;
    }
    if (scrollable) continue;

    offenders.push(element.tagName.toLowerCase() + ' @' + Math.round(rect.right));
    if (offenders.length >= 3) break;
  }

  return { overflow, offenders };
};

/** Every form control needs an accessible name. */
const LABEL_PROBE = () => {
  const unlabelled = [];
  const controls = Array.prototype.slice.call(
    document.querySelectorAll('input:not([type="hidden"]), select, textarea'),
  );

  for (let i = 0; i < controls.length; i++) {
    const control = controls[i];
    const rect = control.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;

    const id = control.getAttribute('id');
    const labelled = id ? Boolean(document.querySelector('label[for="' + id + '"]')) : false;
    const aria =
      Boolean(control.getAttribute('aria-label')) ||
      Boolean(control.getAttribute('aria-labelledby'));
    const wrapped = Boolean(control.closest('label'));

    if (!labelled && !aria && !wrapped) {
      unlabelled.push((control.getAttribute('name') || control.getAttribute('type') || 'control'));
    }
  }

  return unlabelled;
};

/** Exactly one h1, and landmarks that are not nested. */
const STRUCTURE_PROBE = () => ({
  h1: document.querySelectorAll('h1').length,
  main: document.querySelectorAll('main').length,
  nestedMain: document.querySelectorAll('main main').length,
  skipTargets: document.querySelectorAll('#main').length,
});

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: 'gt.age_ok', value: '1', url: BASE }]);
  const page = await context.newPage();

  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 160)));

  try {
    // --------------------------------------------------------------- guard
    console.log('\nAuthentication');

    for (const path of ['/account', '/account/orders', '/account/security']) {
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
      const landed = new URL(page.url()).pathname;
      check(`${path} redirects a signed-out visitor`, landed === '/sign-in', `landed on ${landed}`);
    }

    // --------------------------------------------------------------- sign in
    await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
    await hydrated(page);

    // By type, not by id: the sign-in form wires its inputs through React Hook
    // Form and a shared `FormField`, which owns the label/id association.
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).first().click();

    const signedIn = await page
      .waitForFunction(() => !window.location.pathname.startsWith('/sign-in'), { timeout: 30_000 })
      .then(() => true)
      .catch(() => false);

    check('signing in with the seeded account works', signedIn, page.url());
    if (!signedIn) return;

    // ------------------------------------------------------------ dashboard
    console.log('\nDashboard');

    await page.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });
    await hydrated(page);

    const dash = (await page.locator('main').textContent()) ?? '';
    check('greets the customer by name', /Welcome back, Ada/i.test(dash));
    check('shows an order count', /\d+ orders/i.test(dash));
    check('shows recent orders', /GT-\d+/.test(dash));
    check('shows a saved address', /Sansome/i.test(dash));
    check('shows a wishlist count', /Wishlist/i.test(dash));
    check('shows reward balances', /Points/i.test(dash) && /Store credit/i.test(dash));
    check('flags the open return', /return.{0,20}in progress/i.test(dash));

    const robots = await page
      .locator('meta[name="robots"]')
      .getAttribute('content')
      .catch(() => null);
    check('account pages are noindex', /noindex/.test(robots ?? ''), `robots="${robots}"`);

    // -------------------------------------------------------------every page
    console.log('\nEvery account page loads');

    const PAGES = [
      ['/account/profile', /Profile/],
      ['/account/addresses', /Addresses/],
      ['/account/orders', /Orders/],
      ['/account/returns', /Returns/],
      ['/account/wishlist', /Wishlist/],
      ['/account/recently-viewed', /Recently viewed/],
      ['/account/notifications', /Notifications/],
      ['/account/security', /Security/],
      ['/account/rewards', /Rewards/],
      ['/account/payment-methods', /Payment methods/],
    ];

    for (const [path, heading] of PAGES) {
      const response = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
      await hydrated(page).catch(() => {});
      const text = (await page.locator('main').textContent()) ?? '';

      check(
        `${path} renders`,
        response?.status() === 200 && heading.test(text),
        `HTTP ${response?.status()}`,
      );
    }

    // --------------------------------------------------------------- detail
    console.log('\nContent');

    await page.goto(`${BASE}/account/orders`, { waitUntil: 'domcontentloaded' });
    await hydrated(page);
    const orderLink = page.locator('a[href^="/account/orders/GT-"]').first();
    check('order history links to a detail page', (await orderLink.count()) > 0);

    const href = await orderLink.getAttribute('href');
    await page.goto(`${BASE}${href}`, { waitUntil: 'domcontentloaded' });
    await hydrated(page);

    const detail = (await page.locator('main').textContent()) ?? '';
    check('order detail shows the order number', /GT-\d+/.test(detail));
    check('order detail shows a total', /\$\d+\.\d{2}/.test(detail));
    check('order detail shows the shipping address', /Sansome/i.test(detail));
    check('order detail shows the timeline', /Order history/i.test(detail));
    check('order detail offers a reorder', /Buy it again/i.test(detail));
    check('order detail offers an invoice', /Invoice/i.test(detail));

    await page.goto(`${BASE}/account/returns`, { waitUntil: 'domcontentloaded' });
    await hydrated(page);
    const returns = (await page.locator('main').textContent()) ?? '';
    check('returns page shows the seeded RMA', /RMA-\d+/.test(returns));
    check('returns page shows a status', /Approved/i.test(returns));

    await page.goto(`${BASE}/account/security`, { waitUntil: 'domcontentloaded' });
    await hydrated(page);
    const security = (await page.locator('main').textContent()) ?? '';
    check('security shows the current device', /This device/i.test(security));
    check('security shows sign-in history', /Signed in|Wrong password/i.test(security));
    check('security explains two-factor status', /two-factor/i.test(security));

    await page.goto(`${BASE}/account/notifications`, { waitUntil: 'domcontentloaded' });
    await hydrated(page);
    const notifications = (await page.locator('main').textContent()) ?? '';
    check('notifications lists topics', /Order updates/i.test(notifications));
    check('notifications marks SMS unavailable', /not available yet/i.test(notifications));
    const disabled = await page.locator('input[name$=".sms"][disabled]').count();
    check('SMS switches are disabled', disabled > 0, `${disabled} found`);

    // ------------------------------------------------------------ isolation
    console.log('\nAccess control');

    // What matters is that nothing is disclosed. The status code is a separate,
    // known issue: `notFound()` inside a route reading params still returns 200
    // in Next 16, which is why these pages are also `noindex`.
    await page.goto(`${BASE}/account/orders/GT-999999`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);

    const missing = (await page.locator('h1').first().textContent()) ?? '';
    check(
      'an order that is not yours discloses nothing',
      /can.t find that page/i.test(missing),
      `heading read "${missing.trim()}"`,
    );

    // One `<main>` per page. The storefront layout owns the landmark and the
    // skip-link target; a not-found page nesting its own broke both.
    const landmarks = await page.locator('main').count();
    check('exactly one main landmark', landmarks === 1, `${landmarks} found`);

    // ------------------------------------------------------ responsive + a11y
    console.log('\nResponsive and accessibility');

    const AUDIT_PAGES = ['/account', '/account/profile', '/account/orders', '/account/notifications'];
    const VIEWPORTS = [
      { name: '360', width: 360, height: 800 },
      { name: '768', width: 768, height: 1024 },
      { name: '1440', width: 1440, height: 900 },
    ];

    let overflowFailures = 0;
    let labelFailures = 0;
    let structureFailures = 0;

    for (const path of AUDIT_PAGES) {
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
        await hydrated(page).catch(() => {});
        await page.waitForTimeout(250);

        const { overflow, offenders } = await page.evaluate(OVERFLOW_PROBE, viewport.width);
        if (overflow > 1) {
          overflowFailures += 1;
          console.log(`        ${path} @${viewport.name}: ${overflow}px overflow — ${offenders.join(', ')}`);
        }

        if (viewport.name === '1440') {
          const unlabelled = await page.evaluate(LABEL_PROBE);
          if (unlabelled.length > 0) {
            labelFailures += 1;
            console.log(`        ${path}: unlabelled controls — ${unlabelled.join(', ')}`);
          }

          const structure = await page.evaluate(STRUCTURE_PROBE);
          if (structure.h1 !== 1 || structure.main !== 1 || structure.nestedMain > 0 || structure.skipTargets !== 1) {
            structureFailures += 1;
            console.log(`        ${path}: ${JSON.stringify(structure)}`);
          }
        }
      }
    }

    check('no horizontal overflow at any breakpoint', overflowFailures === 0, `${overflowFailures} combinations`);
    check('every form control has an accessible name', labelFailures === 0, `${labelFailures} pages`);
    check('one h1 and one main landmark per page', structureFailures === 0, `${structureFailures} pages`);

    await page.setViewportSize({ width: 1280, height: 900 });

    const real = pageErrors.filter((error) => !/localhost:3000/.test(error));
    check('no uncaught page errors', real.length === 0, real.slice(0, 2).join(' | '));
  } finally {
    await browser.close();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  for (const failure of failures) console.log(`  FAILED: ${failure}`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
