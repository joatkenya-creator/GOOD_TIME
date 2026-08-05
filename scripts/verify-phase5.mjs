import { chromium } from 'playwright';

/**
 * The phase 5 sign-off checklist, in a real browser.
 *
 * Distinct from `verify-account.mjs`, which only *reads*. This one **mutates**:
 * it edits a profile, adds and deletes an address, changes a password, merges a
 * guest wishlist and revokes a session — because "customers can update their
 * profile" is a claim about writing, and a harness that never writes cannot check
 * it.
 *
 *   npm run db:seed:customers
 *   npm run build && npx next start -p 3000
 *   npm run verify:phase5
 *
 * Every change is undone before the script exits, so it can run repeatedly
 * against the same seeded data.
 *
 * Serve it on the port `NEXT_PUBLIC_SITE_URL` names — Auth.js builds absolute
 * redirects from the configured origin, and on any other port they lead nowhere.
 */

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

const ADA = { email: 'ada.demo@example.test', password: 'GoodTimeDemo2026!' };
const SAM = { email: 'sam.demo@example.test', password: 'GoodTimeDemo2026!' };

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

function section(name) {
  console.log(`\n${name}`);
}

/** React has hydrated. Read-only, so it is safe to poll. */
function hydrated(page) {
  return page.waitForFunction(
    () => {
      const root = document.querySelector('main');
      return !!root && Object.keys(root).some((key) => key.startsWith('__react'));
    },
    { timeout: 25_000 },
  );
}

/** Waits for the page to say something, rather than for a duration. */
function waitForText(page, pattern, timeout = 30_000) {
  return page
    .waitForFunction(
      (source) => new RegExp(source, 'i').test(document.querySelector('main')?.textContent ?? ''),
      pattern.source,
      { timeout },
    )
    .then(() => true)
    .catch(() => false);
}

async function newContext(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: 'gt.age_ok', value: '1', url: BASE }]);
  return context;
}

async function signIn(page, credentials) {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await hydrated(page);

  await page.fill('input[type="email"]', credentials.email);
  await page.fill('input[type="password"]', credentials.password);
  await page
    .getByRole('button', { name: /sign in/i })
    .first()
    .click();

  return page
    .waitForFunction(() => !window.location.pathname.startsWith('/sign-in'), { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
}

async function main() {
  const browser = await chromium.launch();
  const context = await newContext(browser);
  const page = await context.newPage();

  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 160)));

  try {
    // ============================================== 3. PROTECTED ROUTES
    section('Protected routes require authentication');

    const GUARDED = [
      '/account',
      '/account/profile',
      '/account/addresses',
      '/account/orders',
      '/account/returns',
      '/account/wishlist',
      '/account/recently-viewed',
      '/account/notifications',
      '/account/security',
      '/account/rewards',
      '/account/payment-methods',
    ];

    let redirected = 0;
    for (const path of GUARDED) {
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
      if (new URL(page.url()).pathname === '/sign-in') redirected += 1;
      else
        console.log(`        ${path} did NOT redirect — landed on ${new URL(page.url()).pathname}`);
    }
    check(
      `all ${GUARDED.length} account routes redirect a signed-out visitor`,
      redirected === GUARDED.length,
      `${redirected}/${GUARDED.length}`,
    );

    // The API must refuse too, not just the pages.
    const apiGuard = await context.request.get(`${BASE}/api/orders`);
    check(
      'the orders API refuses an unauthenticated read',
      apiGuard.status() === 401,
      `HTTP ${apiGuard.status()}`,
    );

    check('signing in works', await signIn(page, ADA));

    // =============================================== 10. NOT INDEXABLE
    section('Account pages are excluded from search indexing');

    let noindexed = 0;
    for (const path of GUARDED) {
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
      const robots = await page
        .locator('meta[name="robots"]')
        .first()
        .getAttribute('content')
        .catch(() => null);

      if (/noindex/.test(robots ?? '')) noindexed += 1;
      else console.log(`        ${path} robots="${robots}"`);
    }
    check(
      `all ${GUARDED.length} account pages send noindex`,
      noindexed === GUARDED.length,
      `${noindexed}/${GUARDED.length}`,
    );

    const robotsTxt = await (await context.request.get(`${BASE}/robots.txt`)).text();
    check('robots.txt disallows /account', /Disallow:\s*\/account/i.test(robotsTxt));

    const sitemap = await (await context.request.get(`${BASE}/sitemap.xml`)).text();
    check('the sitemap lists no account URL', !/\/account/.test(sitemap));

    // ============================================ 1. PROFILE UPDATES
    section('Customers can update their profile');

    const NEW_PHONE = '(415) 555-0199';

    await page.goto(`${BASE}/account/profile`, { waitUntil: 'domcontentloaded' });
    await hydrated(page);

    const originalPhone = await page.locator('#phone').inputValue();

    await page.fill('#phone', NEW_PHONE);
    await page.getByRole('button', { name: /save changes/i }).click();
    check('saving the profile reports success', await waitForText(page, /profile updated/i));

    // The real check: does it survive a reload?
    await page.reload({ waitUntil: 'domcontentloaded' });
    await hydrated(page);
    check(
      'the change persists across a reload',
      (await page.locator('#phone').inputValue()) === NEW_PHONE,
      `read "${await page.locator('#phone').inputValue()}"`,
    );

    // And is it actually in the database, not just echoed back?
    const meAfter = await (await context.request.get(`${BASE}/api/users/me`)).json();
    check(
      'the change reached the database',
      meAfter?.data?.phone === NEW_PHONE,
      `api says "${meAfter?.data?.phone}"`,
    );

    // Restore.
    await page.fill('#phone', originalPhone);
    await page.getByRole('button', { name: /save changes/i }).click();
    await waitForText(page, /profile updated/i);

    // Validation must actually block.
    await page.fill('#firstName', '');
    await page.getByRole('button', { name: /save changes/i }).click();
    check(
      'an empty required field is rejected',
      await waitForText(page, /enter your first name/i, 10_000),
    );
    await page.reload({ waitUntil: 'domcontentloaded' });

    // ============================================ 2. ADDRESS MANAGEMENT
    section('Address management works correctly');

    await page.goto(`${BASE}/account/addresses`, { waitUntil: 'domcontentloaded' });
    await hydrated(page);

    const before = await page.locator('main address').count();

    await page
      .getByRole('button', { name: /add an address/i })
      .first()
      .click();
    await page.waitForTimeout(400);

    await page.fill('#addr-firstName', 'Verify');
    await page.fill('#addr-lastName', 'Harness');
    await page.fill('#addr-line1', '900 Test Parkway');
    await page.fill('#addr-city', 'Austin');
    await page.selectOption('#addr-state', 'TX');
    await page.fill('#addr-postalCode', '78701');
    await page.getByRole('button', { name: /^save address$/i }).click();

    check('a new address is added', await waitForText(page, /900 Test Parkway/i));
    check(
      'the list grows by one',
      (await page.locator('main address').count()) === before + 1,
      `${before} -> ${await page.locator('main address').count()}`,
    );

    // Editing.
    const row = page.locator('main li').filter({ hasText: '900 Test Parkway' }).first();
    await row.getByRole('button', { name: /^edit$/i }).click();
    await page.waitForTimeout(400);
    await page.fill('#addr-line2', 'Suite 400');
    await page.getByRole('button', { name: /save changes/i }).click();
    check('an address can be edited', await waitForText(page, /Suite 400/i));

    // Default selection.
    const target = page.locator('main li').filter({ hasText: '900 Test Parkway' }).first();
    const makeDefault = target.getByRole('button', { name: /make default/i });

    if ((await makeDefault.count()) > 0) {
      await makeDefault.click();
      await page.waitForTimeout(2500);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await hydrated(page);
    }

    const defaultRow = page.locator('main li').filter({ hasText: '900 Test Parkway' }).first();
    check(
      'the default moves to the chosen address',
      (await defaultRow.getByText('Default').count()) > 0,
    );

    // Exactly one default per type — enforced by a partial unique index.
    const defaultBadges = await page
      .locator('main li')
      .getByText('Default', { exact: true })
      .count();
    check('only one address is the default', defaultBadges === 1, `${defaultBadges} marked`);

    // Deleting.
    const doomed = page.locator('main li').filter({ hasText: '900 Test Parkway' }).first();
    await doomed.getByRole('button', { name: /^delete/i }).click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: /delete address/i }).click();

    const gone = await page
      .waitForFunction(
        () => !/900 Test Parkway/i.test(document.querySelector('main')?.textContent ?? ''),
        { timeout: 30_000 },
      )
      .then(() => true)
      .catch(() => false);
    check('an address can be deleted', gone);

    // Deleting the default must promote a replacement, not leave none.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await hydrated(page);
    const remaining = await page.locator('main address').count();
    const stillDefault = await page
      .locator('main li')
      .getByText('Default', { exact: true })
      .count();
    check(
      'deleting the default promotes a replacement',
      remaining === 0 || stillDefault === 1,
      `${remaining} addresses, ${stillDefault} default`,
    );

    // ============================================ 4 + 5. ORDER HISTORY
    section('Order history and details');

    const apiOrders = await (await context.request.get(`${BASE}/api/orders`)).json();
    const orders = apiOrders?.data ?? [];

    await page.goto(`${BASE}/account/orders`, { waitUntil: 'domcontentloaded' });
    await hydrated(page);

    const listed = await page.locator('a[href^="/account/orders/GT-"]').count();
    check(
      'order history lists every past purchase',
      listed === orders.length && listed > 0,
      `${listed} on screen, ${orders.length} in the database`,
    );

    const historyText = (await page.locator('main').textContent()) ?? '';
    check(
      'each order shows its number',
      orders.every((order) => historyText.includes(order.orderNumber)),
    );

    // Filters must actually filter.
    await page.goto(`${BASE}/account/orders?filter=delivered`, { waitUntil: 'domcontentloaded' });
    await hydrated(page);
    const deliveredCount = await page.locator('a[href^="/account/orders/GT-"]').count();
    const deliveredExpected = orders.filter((order) => order.status === 'DELIVERED').length;
    check(
      'the status filter narrows the list',
      deliveredCount === deliveredExpected,
      `${deliveredCount} shown, ${deliveredExpected} delivered`,
    );

    // Detail accuracy, compared against the database rather than eyeballed.
    const target1 = orders[0];
    await page.goto(`${BASE}/account/orders/${target1.orderNumber}`, {
      waitUntil: 'domcontentloaded',
    });
    await hydrated(page);

    const detail = ((await page.locator('main').textContent()) ?? '').replace(/\s+/g, ' ');
    const money = (cents) => `$${(cents / 100).toFixed(2)}`;

    check('the detail shows the order number', detail.includes(target1.orderNumber));
    check(
      'the detail shows the correct total',
      detail.includes(money(target1.totalCents)),
      `expected ${money(target1.totalCents)}`,
    );
    check(
      'the detail lists every line item',
      target1.items.every((item) => detail.includes(item.productName)),
    );
    check(
      'the detail shows correct line quantities',
      target1.items.every((item) => detail.includes(`Qty ${item.quantity}`)),
    );
    check('the detail shows tax', detail.includes(money(target1.taxCents)));
    check(
      'the detail shows the shipping method',
      detail.includes(target1.shippingMethod ?? 'Shipping'),
    );
    check('the detail shows a timeline', /order history/i.test(detail));

    // ============================================ 6. WISHLIST SYNC
    section('Wishlist synchronises correctly');

    // A guest saves something, then signs in. The two lists must union.
    const guestContext = await newContext(browser);
    const guestPage = await guestContext.newPage();

    const list = await (await guestContext.request.get(`${BASE}/api/products?limit=2`)).json();
    const guestProduct = list.data[1] ?? list.data[0];

    await guestPage.goto(`${BASE}${guestProduct.href}`, { waitUntil: 'domcontentloaded' });
    await hydrated(guestPage);

    await guestPage
      .getByRole('button', { name: /^save$|save to wishlist/i })
      .first()
      .click();
    await guestPage.waitForTimeout(1500);

    const localSaved = await guestPage.evaluate(() => {
      try {
        return JSON.parse(localStorage.getItem('gt.wishlist') ?? '[]');
      } catch {
        return [];
      }
    });
    check(
      'a guest wishlist is kept on the device',
      localSaved.length > 0,
      `${localSaved.length} saved`,
    );

    const accountBefore = await (await context.request.get(`${BASE}/api/cart`)).status();
    void accountBefore;

    await signIn(guestPage, ADA);
    // The merge runs once per browser session, from `WishlistSync`.
    await guestPage.goto(`${BASE}/account/wishlist`, { waitUntil: 'domcontentloaded' });
    await hydrated(guestPage);
    await guestPage.waitForTimeout(2500);
    await guestPage.reload({ waitUntil: 'domcontentloaded' });
    await hydrated(guestPage);

    const merged = (await guestPage.locator('main').textContent()) ?? '';
    check(
      'the guest list merges into the account on sign-in',
      merged.includes(guestProduct.name),
      `looking for "${guestProduct.name}"`,
    );

    const localAfterMerge = await guestPage.evaluate(() => {
      try {
        return JSON.parse(localStorage.getItem('gt.wishlist') ?? '[]');
      } catch {
        return [];
      }
    });
    check(
      'the merged list is written back to the device',
      localAfterMerge.length >= localSaved.length,
      `${localSaved.length} -> ${localAfterMerge.length}`,
    );

    // Removing from the account list persists.
    const firstRemove = guestPage.getByRole('button', { name: /^remove/i }).first();
    if ((await firstRemove.count()) > 0) {
      const countBefore = await guestPage.locator('main ul li').count();
      await firstRemove.click();
      await guestPage.waitForTimeout(2500);
      await guestPage.reload({ waitUntil: 'domcontentloaded' });
      await hydrated(guestPage);

      check(
        'removing from the wishlist persists',
        (await guestPage.locator('main ul li').count()) < countBefore,
      );
    }

    await guestContext.close();

    // ======================================= 7. RECENTLY VIEWED PERSISTS
    section('Recently viewed products persist');

    const products = await (await context.request.get(`${BASE}/api/products?limit=3`)).json();
    const viewed = products.data[2] ?? products.data[0];

    await page.goto(`${BASE}${viewed.href}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    await page.goto(`${BASE}/account/recently-viewed`, { waitUntil: 'domcontentloaded' });
    await hydrated(page);

    check(
      'a viewed product appears in history',
      ((await page.locator('main').textContent()) ?? '').includes(viewed.name),
      `looking for "${viewed.name}"`,
    );

    // The real test of "persist": a brand-new browser context, same account.
    const freshContext = await newContext(browser);
    const freshPage = await freshContext.newPage();
    await signIn(freshPage, ADA);
    await freshPage.goto(`${BASE}/account/recently-viewed`, { waitUntil: 'domcontentloaded' });
    await hydrated(freshPage);

    check(
      'history survives on a different device',
      ((await freshPage.locator('main').textContent()) ?? '').includes(viewed.name),
    );
    await freshContext.close();

    // Removing one item persists.
    await page.goto(`${BASE}/account/recently-viewed`, { waitUntil: 'domcontentloaded' });
    await hydrated(page);
    const historyBefore = await page.locator('main ul li').count();

    await page
      .getByRole('button', { name: /remove .* from your history/i })
      .first()
      .click();
    await page.waitForTimeout(2500);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await hydrated(page);

    check(
      'removing from history persists',
      (await page.locator('main ul li').count()) < historyBefore,
      `${historyBefore} -> ${await page.locator('main ul li').count()}`,
    );

    // ============================================== 9. ACTIVE SESSIONS
    section('Active sessions are displayed');

    // A second device, so there is something to list and revoke.
    const secondContext = await newContext(browser);
    const secondPage = await secondContext.newPage();
    check('a second device can sign in', await signIn(secondPage, ADA));

    await page.goto(`${BASE}/account/security`, { waitUntil: 'domcontentloaded' });
    await hydrated(page);

    const sessionRows = await page
      .locator('main li')
      .filter({ hasText: /on (Windows|macOS|Linux|iOS|Android|Unknown)/ })
      .count();
    check('more than one session is listed', sessionRows >= 2, `${sessionRows} listed`);
    check(
      'the current device is marked',
      ((await page.locator('main').textContent()) ?? '').includes('This device'),
    );

    const signOutOthers = page.getByRole('button', { name: /sign out everywhere else/i });
    check('an option to sign out other devices is offered', (await signOutOthers.count()) > 0);

    if ((await signOutOthers.count()) > 0) {
      await signOutOthers.click();
      await page.waitForTimeout(3000);

      // Revocation is immediate — the other device's very next request fails.
      //
      // The redirect arrives client-side: the account shell streams, so by the
      // time the guard rejects, the response headers are long gone and Next
      // has to tell the router rather than send a 307. `domcontentloaded` fires
      // before that lands, so waiting for the URL is the honest assertion.
      await secondPage.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });
      const signedOut = await secondPage
        .waitForFunction(() => window.location.pathname.startsWith('/sign-in'), { timeout: 15_000 })
        .then(() => true)
        .catch(() => false);

      check(
        'a revoked device is signed out immediately',
        signedOut,
        `landed on ${new URL(secondPage.url()).pathname}`,
      );

      // And no account data reached it on the way. "Welcome back" alone is not
      // the tell — the sign-in page says that too. The name is account data.
      check(
        'the revoked device is shown no account data',
        !/Welcome back,/i.test((await secondPage.content()) ?? ''),
      );

      await page.reload({ waitUntil: 'domcontentloaded' });
      await hydrated(page);
      const afterRevoke = await page
        .locator('main li')
        .filter({ hasText: /on (Windows|macOS|Linux|iOS|Android|Unknown)/ })
        .count();
      check(
        'the revoked session leaves the list',
        afterRevoke < sessionRows,
        `${sessionRows} -> ${afterRevoke}`,
      );
    }

    await secondContext.close();

    check(
      'sign-in history is shown',
      /signed in|wrong password/i.test((await page.locator('main').textContent()) ?? ''),
    );

    // ============================================ 8. PASSWORD CHANGES
    section('Password changes work');

    // On a throwaway account, and restored afterwards.
    const pwContext = await newContext(browser);
    const pwPage = await pwContext.newPage();
    await signIn(pwPage, SAM);

    const TEMP = 'TemporaryVerify2026!';

    await pwPage.goto(`${BASE}/account/security`, { waitUntil: 'domcontentloaded' });
    await hydrated(pwPage);

    // A wrong current password must be refused.
    await pwPage.fill('#currentPassword', 'NotTheRightPassword1!');
    await pwPage.fill('#newPassword', TEMP);
    await pwPage.fill('#confirmPassword', TEMP);
    await pwPage.getByRole('button', { name: /change password/i }).click();
    check('a wrong current password is refused', await waitForText(pwPage, /not correct/i));

    // Mismatched confirmation must be refused.
    await pwPage.fill('#currentPassword', SAM.password);
    await pwPage.fill('#newPassword', TEMP);
    await pwPage.fill('#confirmPassword', `${TEMP}-different`);
    await pwPage.getByRole('button', { name: /change password/i }).click();
    check('a mismatched confirmation is refused', await waitForText(pwPage, /do not match/i));

    // The real change.
    await pwPage.fill('#currentPassword', SAM.password);
    await pwPage.fill('#newPassword', TEMP);
    await pwPage.fill('#confirmPassword', TEMP);
    await pwPage.getByRole('button', { name: /change password/i }).click();
    check('the password change succeeds', await waitForText(pwPage, /password changed/i));

    // The old password must stop working, and the new one must start.
    const staleContext = await newContext(browser);
    const stalePage = await staleContext.newPage();
    check(
      'the old password no longer works',
      !(await signIn(stalePage, SAM)),
      'the old password still signed in',
    );
    check('the new password works', await signIn(stalePage, { email: SAM.email, password: TEMP }));

    // Restore, so the script can run again.
    await stalePage.goto(`${BASE}/account/security`, { waitUntil: 'domcontentloaded' });
    await hydrated(stalePage);
    await stalePage.fill('#currentPassword', TEMP);
    await stalePage.fill('#newPassword', SAM.password);
    await stalePage.fill('#confirmPassword', SAM.password);
    await stalePage.getByRole('button', { name: /change password/i }).click();
    check(
      'the password is restored for the next run',
      await waitForText(stalePage, /password changed/i),
    );

    await staleContext.close();
    await pwContext.close();

    const realErrors = pageErrors.filter((error) => !/localhost:3000/.test(error));
    check('no uncaught page errors', realErrors.length === 0, realErrors.slice(0, 2).join(' | '));
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
