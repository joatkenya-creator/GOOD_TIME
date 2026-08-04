import { createRequire } from 'node:module';

import { chromium } from 'playwright';

/**
 * The admin, in a real browser.
 *
 * The checks that matter here are not "does the page render" — the type checker
 * covers most of that — but "does the permission model actually hold". Every
 * role gets signed in and pointed at surfaces it should and should not reach,
 * because an authorisation bug is invisible to every other kind of test: the
 * page looks perfect, it is simply showing it to the wrong person.
 *
 *   npm run build && npx next start -p 3000
 *   npm run db:seed:admin
 *   npm run verify:admin
 */
const require = createRequire(import.meta.url);
const axePath = require.resolve('axe-core/axe.min.js');

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const PASSWORD = 'GoodTimeAdmin2026!';

const OWNER = 'owner.demo@example.test';
const ANALYST = 'analyst.demo@example.test';
const SUPPORT = 'support.demo@example.test';
const EDITOR = 'editor.demo@example.test';
const STOCK = 'stock.demo@example.test';

/** Every admin route, for the sweep the owner runs. */
const PAGES = [
  { path: '/admin', label: 'dashboard' },
  { path: '/admin/products', label: 'products' },
  { path: '/admin/products/new', label: 'new product' },
  { path: '/admin/categories', label: 'categories' },
  { path: '/admin/collections', label: 'collections' },
  { path: '/admin/inventory', label: 'inventory' },
  { path: '/admin/media', label: 'media' },
  { path: '/admin/orders', label: 'orders' },
  { path: '/admin/customers', label: 'customers' },
  { path: '/admin/promotions', label: 'promotions' },
  { path: '/admin/content', label: 'content' },
  { path: '/admin/blog', label: 'blog' },
  { path: '/admin/seo', label: 'seo' },
  { path: '/admin/reports', label: 'reports' },
  { path: '/admin/staff', label: 'staff' },
  { path: '/admin/audit', label: 'audit' },
  { path: '/admin/settings', label: 'settings' },
  { path: '/admin/alerts', label: 'alerts' },
];

let passed = 0;
let failed = 0;
const failures = [];

function check(label, ok, detail) {
  if (ok) {
    passed += 1;
  } else {
    failed += 1;
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(name) {
  console.log(`\n${name}`);
}

async function contextFor(browser, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport });
  await context.addCookies([{ name: 'gt.age_ok', value: '1', url: BASE }]);
  return context;
}

async function signIn(page, email) {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).first().click();
  return page
    .waitForFunction(() => !window.location.pathname.startsWith('/sign-in'), { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
}

/** Landed somewhere other than the page asked for = the guard redirected. */
async function reaches(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  return new URL(page.url()).pathname === path;
}

async function main() {
  const browser = await chromium.launch();
  const pageErrors = [];

  // ------------------------------------------------------ the front door
  section('The front door');

  const anon = await contextFor(browser);
  const anonPage = await anon.newPage();
  await anonPage.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await anonPage.waitForTimeout(600);
  check(
    'a signed-out visitor cannot open the admin',
    !new URL(anonPage.url()).pathname.startsWith('/admin'),
    `landed on ${new URL(anonPage.url()).pathname}`,
  );

  // `maxRedirects: 0` so a redirect is visible as one rather than followed to
  // an HTML sign-in page that would look like a 200.
  const anonApi = await anon.request.get(`${BASE}/api/admin/search?q=test`, { maxRedirects: 0 });
  check(
    'the admin search API refuses anonymous with a status, not a redirect',
    anonApi.status() === 401,
    `got ${anonApi.status()}`,
  );

  const anonExport = await anon.request.get(`${BASE}/api/admin/reports/customers?format=csv`, {
    maxRedirects: 0,
  });
  check(
    'the customer export refuses anonymous',
    anonExport.status() === 401,
    `got ${anonExport.status()}`,
  );
  await anon.close();

  // A signed-in shopper is not staff.
  const shopper = await contextFor(browser);
  const shopperPage = await shopper.newPage();
  const shopperIn = await signIn(shopperPage, 'ada.demo@example.test').catch(() => false);
  if (shopperIn) {
    await shopperPage.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
    await shopperPage.waitForTimeout(600);
    check(
      'a customer is bounced out of the admin',
      !new URL(shopperPage.url()).pathname.startsWith('/admin'),
      `landed on ${new URL(shopperPage.url()).pathname}`,
    );
  }
  await shopper.close();

  // ------------------------------------------------- every page, as owner
  section('Every page renders for a super administrator');

  const ownerContext = await contextFor(browser);
  const ownerPage = await ownerContext.newPage();
  ownerPage.on('pageerror', (error) => pageErrors.push(`owner: ${String(error).slice(0, 140)}`));

  check('the owner can sign in', await signIn(ownerPage, OWNER));

  for (const target of PAGES) {
    const response = await ownerPage.goto(`${BASE}${target.path}`, {
      waitUntil: 'domcontentloaded',
    });
    await ownerPage.waitForTimeout(350);

    check(`${target.label} returns 200`, response?.status() === 200, `got ${response?.status()}`);

    const heading = await ownerPage.locator('h1').count();
    check(`${target.label} has exactly one h1`, heading === 1, `${heading} found`);

    const mains = await ownerPage.locator('main').count();
    check(`${target.label} has exactly one main landmark`, mains === 1, `${mains} found`);
  }

  // ------------------------------------------------------- accessibility
  section('Accessibility');

  for (const target of [
    { path: '/admin', label: 'dashboard' },
    { path: '/admin/products', label: 'products' },
    { path: '/admin/orders', label: 'orders' },
    { path: '/admin/staff', label: 'staff' },
    { path: '/admin/settings', label: 'settings' },
  ]) {
    await ownerPage.goto(`${BASE}${target.path}`, { waitUntil: 'domcontentloaded' });
    await ownerPage.waitForTimeout(500);
    await ownerPage.addScriptTag({ path: axePath });

    const violations = await ownerPage.evaluate(async () => {
      const result = await window.axe.run(document, {
        resultTypes: ['violations'],
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      });
      return result.violations
        .filter((violation) => ['serious', 'critical'].includes(violation.impact))
        .map((violation) => `${violation.id} (${violation.nodes.length})`);
    });

    check(`${target.label} passes accessibility`, violations.length === 0, violations.join('; '));
  }

  // --------------------------------------------------------- dark theme
  section('Dark theme');

  await ownerContext.addCookies([
    { name: 'gt.admin_theme', value: 'dark', url: BASE },
  ]);
  await ownerPage.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await ownerPage.waitForTimeout(500);

  const themed = await ownerPage.locator('[data-admin-theme="dark"]').count();
  check('the dark theme applies from the cookie', themed === 1);

  await ownerPage.addScriptTag({ path: axePath });
  const darkViolations = await ownerPage.evaluate(async () => {
    const result = await window.axe.run(document, {
      resultTypes: ['violations'],
      runOnly: ['color-contrast'],
    });
    return result.violations.flatMap((violation) =>
      violation.nodes.map((node) => node.any?.[0]?.data?.contrastRatio).filter(Boolean),
    );
  });
  check(
    'the dark theme has no contrast failures',
    darkViolations.length === 0,
    darkViolations.slice(0, 4).join(', '),
  );

  await ownerContext.addCookies([{ name: 'gt.admin_theme', value: 'light', url: BASE }]);

  // ---------------------------------------------------- the whole point
  section('Permissions are enforced');

  const cases = [
    {
      email: ANALYST,
      label: 'read-only analyst',
      allowed: ['/admin', '/admin/products', '/admin/orders', '/admin/reports'],
      denied: ['/admin/staff', '/admin/settings', '/admin/products/new', '/admin/seo'],
    },
    {
      email: SUPPORT,
      label: 'customer support',
      allowed: ['/admin/orders', '/admin/customers'],
      denied: ['/admin/staff', '/admin/settings', '/admin/reports', '/admin/seo'],
    },
    {
      email: EDITOR,
      label: 'content editor',
      allowed: ['/admin/content', '/admin/blog', '/admin/media', '/admin/seo'],
      denied: ['/admin/orders', '/admin/customers', '/admin/staff', '/admin/settings'],
    },
    {
      email: STOCK,
      label: 'inventory manager',
      allowed: ['/admin/inventory', '/admin/products'],
      denied: ['/admin/orders', '/admin/customers', '/admin/staff'],
    },
  ];

  for (const scenario of cases) {
    const context = await contextFor(browser);
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(`${scenario.label}: ${String(error).slice(0, 140)}`));

    check(`${scenario.label} can sign in`, await signIn(page, scenario.email));

    for (const path of scenario.allowed) {
      check(`${scenario.label} reaches ${path}`, await reaches(page, path));
    }

    for (const path of scenario.denied) {
      const got = await reaches(page, path);
      check(`${scenario.label} is refused ${path}`, !got, 'the page rendered');
    }

    // The menu shows only what they can use — no map of doors they cannot open.
    await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' }).catch(() => null);
    await page.waitForTimeout(400);
    const menuLinks = await page.evaluate(() =>
      [...document.querySelectorAll('nav[aria-label="Admin"] a')].map((a) => a.getAttribute('href')),
    );
    const leaked = scenario.denied.filter((path) => menuLinks.includes(path));
    check(`${scenario.label}'s menu hides what they cannot open`, leaked.length === 0, leaked.join(', '));

    await context.close();
  }

  // ------------------------------------------------------ PII masking
  section('Customer data is masked without the PII permission');

  const analystContext = await contextFor(browser);
  const analystPage = await analystContext.newPage();
  await signIn(analystPage, ANALYST);
  await analystPage.goto(`${BASE}/admin/customers`, { waitUntil: 'domcontentloaded' });
  await analystPage.waitForTimeout(500);

  const body = (await analystPage.locator('main').textContent()) ?? '';
  check('an analyst sees masked email addresses', body.includes('•'), 'no masking found');
  check(
    'an analyst does not see a full demo address',
    !body.includes('ada.demo@example.test'),
    'a full address was rendered',
  );
  await analystContext.close();

  // ---------------------------------------------------- audit is written
  section('The audit trail records changes');

  await ownerPage.goto(`${BASE}/admin/audit`, { waitUntil: 'domcontentloaded' });
  await ownerPage.waitForTimeout(500);
  const auditText = (await ownerPage.locator('main').textContent()) ?? '';
  check('the audit log has entries', !auditText.includes('Nothing recorded yet'));

  // An export writes one, which is what makes data leaving the building
  // answerable later.
  const before = (auditText.match(/EXPORT/g) ?? []).length;
  await ownerContext.request.get(`${BASE}/api/admin/reports/sales?format=csv`);
  await ownerPage.goto(`${BASE}/admin/audit?status=EXPORT`, { waitUntil: 'domcontentloaded' });
  await ownerPage.waitForTimeout(500);
  const after = ((await ownerPage.locator('main').textContent()) ?? '').match(/EXPORT/g)?.length ?? 0;
  check('an export is recorded in the audit log', after > 0, `${before} → ${after}`);

  // ------------------------------------------------------------ exports
  section('Report exports');

  for (const format of ['csv', 'xls', 'print']) {
    const response = await ownerContext.request.get(
      `${BASE}/api/admin/reports/sales?format=${format}`,
    );
    check(`the ${format} export returns 200`, response.status() === 200, `got ${response.status()}`);
  }

  const csv = await (await ownerContext.request.get(`${BASE}/api/admin/reports/inventory?format=csv`)).text();
  check('the CSV has a header row', csv.split('\r\n')[0]?.includes('SKU') ?? false);
  check(
    'money is exported as a decimal, not as cents',
    !/,\d{4,},/.test(csv.split('\r\n')[1] ?? ''),
    csv.split('\r\n')[1],
  );

  // ------------------------------------------------------- global search
  section('Global search');

  const search = await ownerContext.request.get(`${BASE}/api/admin/search?q=pebble`);
  check('search returns 200 for staff', search.status() === 200);
  const searchBody = await search.json();
  check('search returns results', Array.isArray(searchBody.data));

  await ownerContext.close();

  check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 4).join('; '));

  await browser.close();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  for (const failure of failures) console.log(`  FAILED: ${failure}`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
