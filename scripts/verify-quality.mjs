import { createRequire } from 'node:module';

import { chromium } from 'playwright';

/**
 * Responsiveness, accessibility, navigation and network health across the site.
 *
 *   npm run build && npx next start -p 3000
 *   npm run verify:quality
 *
 * Three things this deliberately does that a unit test cannot:
 *
 *   - runs axe-core against the real DOM, so contrast, ARIA misuse and duplicate
 *     ids are caught rather than assumed;
 *   - loads every page at three viewports, because a layout that works at 1440px
 *     tells you nothing about 375px;
 *   - watches every response and every console message for the whole run, so a
 *     500 from a fetch nobody awaited still fails the build.
 *
 * Signed-in pages are covered too — half the account area cannot be reached
 * otherwise, and that is the half handling personal data.
 */
const require = createRequire(import.meta.url);
const axePath = require.resolve('axe-core/axe.min.js');

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const ADA = { email: 'ada.demo@example.test', password: 'GoodTimeDemo2026!' };

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

/**
 * Route prefixes that are linked but not built yet — tracked, not tolerated.
 *
 * Editorial content (`/pages`), curated collections and the buying guides are
 * phase 6 work; the footer and homepage already link to them. Counting them as
 * ordinary failures would mean this script failed on every run, and a check that
 * always fails is a check nobody reads. Counting them as passes would mean the
 * twenty-ninth dead link ships unnoticed.
 *
 * So they are reported separately and by count. A new dead link outside these
 * prefixes still fails, and the day a prefix starts resolving, its entry here
 * should go. See docs/quality.md.
 */
const UNBUILT_PREFIXES = ['/pages/', '/collections', '/guides'];

const isUnbuilt = (path) => UNBUILT_PREFIXES.some((prefix) => path.startsWith(prefix));

/**
 * Paths this script asks for on purpose, expecting a non-200.
 *
 * The 404 page has to be swept like any other — it is the page people reach
 * when something has already gone wrong, and it has been the source of real
 * landmark bugs. But requesting it also trips the network watcher, which would
 * then report the sweep's own probe as a site defect.
 */
const DELIBERATE_404 = new Set(['/definitely-not-a-page']);

/** Public pages, then the account area. `auth` pages are visited signed in. */
const PAGES = [
  { path: '/', label: 'home' },
  { path: '/shop', label: 'shop' },
  { path: '/cart', label: 'cart' },
  { path: '/sign-in', label: 'sign in' },
  { path: '/register', label: 'register' },
  { path: '/orders/lookup', label: 'guest order lookup' },

  // The register form makes customers accept these two. If either stops
  // resolving, that consent becomes meaningless again — so they are swept, not
  // trusted.
  { path: '/pages/terms', label: 'terms of service' },
  { path: '/pages/privacy', label: 'privacy policy' },

  { path: '/definitely-not-a-page', label: '404', expectStatus: 404 },
  { path: '/account', label: 'account dashboard', auth: true },
  { path: '/account/profile', label: 'profile', auth: true },
  { path: '/account/addresses', label: 'addresses', auth: true },
  { path: '/account/orders', label: 'order history', auth: true },
  { path: '/account/wishlist', label: 'wishlist', auth: true },
  { path: '/account/rewards', label: 'rewards', auth: true },
  { path: '/account/security', label: 'security', auth: true },
  { path: '/account/returns', label: 'returns', auth: true },
  { path: '/account/payment-methods', label: 'payment methods', auth: true },
  { path: '/account/notifications', label: 'notifications', auth: true },
  { path: '/account/recently-viewed', label: 'recently viewed', auth: true },
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

async function newContext(browser, viewport) {
  const context = await browser.newContext({ viewport });
  await context.addCookies([{ name: 'gt.age_ok', value: '1', url: BASE }]);
  return context;
}

async function signIn(page) {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type="email"]', ADA.email);
  await page.fill('input[type="password"]', ADA.password);
  await page
    .getByRole('button', { name: /sign in/i })
    .first()
    .click();
  return page
    .waitForFunction(() => !window.location.pathname.startsWith('/sign-in'), { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
}

/**
 * axe-core, restricted to what is worth blocking on.
 *
 * `serious` and `critical` only. The `minor` bucket is full of advisory rules
 * that a design system trips constantly without any user being affected, and a
 * check that always fails is a check nobody reads.
 */
async function audit(page) {
  await page.addScriptTag({ path: axePath });
  return page.evaluate(async () => {
    const results = await window.axe.run(document, {
      resultTypes: ['violations'],
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    });

    return results.violations
      .filter((violation) => ['serious', 'critical'].includes(violation.impact))
      .map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        count: violation.nodes.length,
        sample: violation.nodes[0]?.target?.join(' ') ?? '',
      }));
  });
}

/** Content wider than the viewport means a horizontal scrollbar on a phone. */
function overflow(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const overhang = doc.scrollWidth - doc.clientWidth;
    if (overhang <= 1) return null;

    // Name the widest offender, or the report is unactionable.
    let worst = null;
    for (const element of document.body.querySelectorAll('*')) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.right <= doc.clientWidth + 1) continue;
      if (!worst || rect.right > worst.right) {
        worst = {
          right: Math.round(rect.right),
          tag: element.tagName.toLowerCase(),
          cls: String(element.className).slice(0, 60),
        };
      }
    }
    return { overhang, worst };
  });
}

async function main() {
  const browser = await chromium.launch();

  // Every response and every uncaught error, for the whole run.
  const badResponses = [];
  const pageErrors = [];
  const consoleErrors = [];

  function watch(page, context) {
    page.on('response', (response) => {
      const status = response.status();
      const url = response.url();
      if (status >= 400 && url.startsWith(BASE)) {
        // Next prefetches links on hover and viewport entry, so an unbuilt page
        // produces a 404 here without anyone clicking. Same split as the crawl.
        const path = new URL(url).pathname;
        if (!isUnbuilt(path) && !DELIBERATE_404.has(path)) {
          badResponses.push({ context, status, url: url.replace(BASE, '') });
        }
      }
    });
    page.on('pageerror', (error) => pageErrors.push(`${context}: ${String(error).slice(0, 160)}`));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;

      // "Failed to load resource: 404" is the browser narrating a response the
      // watcher above already judged. Counting it again reports one event twice.
      const text = message.text();
      if (/Failed to load resource.*404/.test(text)) return;

      consoleErrors.push(`${context}: ${text.slice(0, 160)}`);
    });
  }

  // ------------------------------------------- responsive + accessibility
  for (const viewport of VIEWPORTS) {
    section(`${viewport.name} — ${viewport.width}x${viewport.height}`);

    const context = await newContext(browser, viewport);
    const page = await context.newPage();
    watch(page, viewport.name);

    const signedIn = await signIn(page);
    check(`${viewport.name}: signing in works`, signedIn);

    for (const target of PAGES) {
      const label = `${viewport.name}: ${target.label}`;
      const response = await page.goto(`${BASE}${target.path}`, {
        waitUntil: 'domcontentloaded',
      });

      // A 404 page is expected to say 404; everything else must not.
      const expected = target.expectStatus ?? 200;
      check(
        `${label} returns ${expected}`,
        response?.status() === expected,
        `got ${response?.status()}`,
      );

      // Let client components settle before measuring or auditing.
      await page.waitForTimeout(600);

      const spill = await overflow(page);
      check(
        `${label} has no horizontal overflow`,
        spill === null,
        spill
          ? `${spill.overhang}px past the viewport, widest: <${spill.worst?.tag} class="${spill.worst?.cls}">`
          : undefined,
      );

      const violations = await audit(page);
      check(
        `${label} passes accessibility`,
        violations.length === 0,
        violations.map((v) => `${v.id} (${v.impact}, ${v.count}x, e.g. ${v.sample})`).join('; '),
      );
    }

    console.log(`  ${viewport.name}: ${PAGES.length} pages audited`);
    await context.close();
  }

  // ------------------------------------------------------------ navigation
  section('Navigation');

  const context = await newContext(browser, VIEWPORTS[2]);
  const page = await context.newPage();
  watch(page, 'crawl');
  await signIn(page);

  // Every internal link reachable from the pages above, visited once.
  const seen = new Set();
  const broken = [];
  const knownGaps = [];

  for (const target of PAGES) {
    if (target.expectStatus) continue;
    await page.goto(`${BASE}${target.path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);

    const links = await page.evaluate(() =>
      [...document.querySelectorAll('a[href]')]
        .map((a) => a.getAttribute('href'))
        .filter((href) => href && href.startsWith('/') && !href.startsWith('//')),
    );

    for (const href of links) {
      const clean = href.split('#')[0];
      if (!clean || seen.has(clean)) continue;
      seen.add(clean);

      // `sign-out` is a POST endpoint and `api` routes are not navigation.
      if (clean.startsWith('/api/')) continue;

      const response = await context.request.get(`${BASE}${clean}`, { maxRedirects: 5 });
      if (response.status() >= 400) {
        const entry = `${clean} -> ${response.status()} (linked from ${target.path})`;
        if (isUnbuilt(clean)) knownGaps.push(entry);
        else broken.push(entry);
      }
    }
  }

  check(
    `every internal link resolves — ${seen.size} followed, ${knownGaps.length} known gaps skipped`,
    broken.length === 0,
    broken.slice(0, 8).join('; '),
  );

  // Loud, but not a failure. Silence here would be how the count creeps up.
  console.log(
    `  NOTE  ${knownGaps.length} links point at unbuilt content (/pages, /collections, /guides) — see docs/quality.md`,
  );

  // ------------------------------------------------------------------ APIs
  section('API health');

  const endpoints = [
    { path: '/api/users/me', expect: 200, label: 'profile (signed in)' },
    { path: '/api/health', expect: 200, label: 'health' },
    { path: '/robots.txt', expect: 200, label: 'robots.txt' },
    { path: '/sitemap.xml', expect: 200, label: 'sitemap' },
  ];

  for (const endpoint of endpoints) {
    const response = await context.request.get(`${BASE}${endpoint.path}`);
    // A route that does not exist is reported, not silently tolerated.
    check(
      `${endpoint.label} responds ${endpoint.expect}`,
      response.status() === endpoint.expect,
      `got ${response.status()}`,
    );
  }

  /*
   * Every URL the sitemap publishes must resolve.
   *
   * A sitemap is a promise to a crawler that these pages exist. This one was
   * listing `/collections`, `/brands` and `/guides` — none of which had ever
   * been built — plus a URL per collection. Nothing in the app fails when that
   * drifts, because nobody on the team clicks a sitemap.
   */
  const sitemap = await context.request.get(`${BASE}/sitemap.xml`);
  const urls = [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const deadSitemapUrls = [];

  for (const url of urls) {
    const path = new URL(url).pathname;
    const response = await context.request.get(`${BASE}${path}`, { maxRedirects: 5 });
    if (response.status() >= 400) deadSitemapUrls.push(`${path} -> ${response.status()}`);
  }

  check(
    `every sitemap URL resolves — ${urls.length} published`,
    deadSitemapUrls.length === 0,
    deadSitemapUrls.slice(0, 8).join('; '),
  );

  // Unauthenticated reads of personal data must be refused, not merely empty.
  const anon = await newContext(browser, VIEWPORTS[2]);
  const anonMe = await anon.request.get(`${BASE}/api/users/me`);
  check(
    'profile API refuses an unauthenticated read',
    anonMe.status() === 401,
    `got ${anonMe.status()}`,
  );
  await anon.close();

  await context.close();

  // -------------------------------------------------------------- network
  section('Network and console');

  check(
    'no unexpected 4xx/5xx responses',
    badResponses.length === 0,
    badResponses
      .slice(0, 8)
      .map((r) => `${r.status} ${r.url} [${r.context}]`)
      .join('; '),
  );
  check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 5).join('; '));
  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 5).join('; '));

  await browser.close();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  for (const failure of failures) console.log(`  FAILED: ${failure}`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
