import { createRequire } from 'node:module';

import { chromium } from 'playwright';

/**
 * The admin's rendered surface: responsive, accessible, navigable.
 *
 *   npm run build && npx next start -p 3000
 *   npm run verify:admin-ui
 *
 * `verify:admin` proves the permission model; `verify:admin-crud` proves the
 * write paths. This covers what is left — how it looks and whether it works at
 * a width other than the one it was built at.
 *
 * Both themes are audited, not just the default. The dark theme is a separate
 * set of computed colours, so a contrast pass in light mode says nothing about
 * it — and that is not a hypothetical: the dark theme's contrast overrides
 * silently did nothing for a whole phase because they targeted semantic
 * aliases that `@theme inline` had already baked out.
 */
const require = createRequire(import.meta.url);
const axePath = require.resolve('axe-core/axe.min.js');

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const OWNER = 'owner.demo@example.test';
const PASSWORD = 'GoodTimeAdmin2026!';

/**
 * Desktop and tablet, as asked.
 *
 * An admin is legitimately desktop-first — nobody reconciles inventory on a
 * phone — but 768px is a real device a manager checks orders on, and "it works
 * at 1440" says nothing about it.
 */
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
];

const PAGES = [
  '/admin',
  '/admin/products',
  '/admin/products/new',
  '/admin/categories',
  '/admin/collections',
  '/admin/inventory',
  '/admin/media',
  '/admin/orders',
  '/admin/customers',
  '/admin/promotions',
  '/admin/content',
  '/admin/blog',
  '/admin/seo',
  '/admin/reports',
  '/admin/staff',
  '/admin/audit',
  '/admin/settings',
  '/admin/alerts',
  '/admin/denied',
  // Phase 7
  '/admin/imports',
  '/admin/jobs',
  '/admin/search',
  '/admin/analytics',
  '/admin/marketing',
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

async function signIn(page) {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type="email"]', OWNER);
  await page.fill('input[type="password"]', PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).first().click();
  await page.waitForFunction(() => !window.location.pathname.startsWith('/sign-in'), {
    timeout: 30_000,
  });
}

/** Content wider than the viewport means a horizontal scrollbar. */
function overflow(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const overhang = doc.scrollWidth - doc.clientWidth;
    if (overhang <= 1) return null;

    /*
     * Name the widest offender — but ignore anything inside a horizontal
     * scroller.
     *
     * A wide table inside `overflow-x-auto` is doing exactly what it should:
     * its cells extend past the viewport and the container scrolls. Counting
     * them blamed a `<td>` for a page-level overflow caused elsewhere, which
     * sent me looking at the table for an hour.
     */
    const scrolls = (element) => {
      for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
        const overflowX = getComputedStyle(node).overflowX;
        if (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'hidden') return true;
      }
      return false;
    };

    let worst = null;
    for (const element of document.body.querySelectorAll('*')) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.right <= doc.clientWidth + 1) continue;
      if (scrolls(element)) continue;
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

async function audit(page) {
  await page.addScriptTag({ path: axePath });
  return page.evaluate(async () => {
    const result = await window.axe.run(document, {
      resultTypes: ['violations'],
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    });
    return result.violations
      .filter((violation) => ['serious', 'critical'].includes(violation.impact))
      .map((violation) => {
        const sample = violation.nodes[0];
        const data = sample?.any?.[0]?.data;
        const ratio = data?.contrastRatio ? ` ${data.contrastRatio}:1 ${data.fgColor} on ${data.bgColor}` : '';
        return `${violation.id} (${violation.nodes.length}x${ratio}) e.g. ${sample?.target?.join(' ')?.slice(0, 60)}`;
      });
  });
}

async function main() {
  const browser = await chromium.launch();

  const badResponses = [];
  const pageErrors = [];
  const consoleErrors = [];

  function watch(page, context) {
    page.on('response', (response) => {
      const status = response.status();
      const url = response.url();
      if (status < 400 || !url.startsWith(BASE)) return;

      // Documented storefront gaps — see docs/quality.md. Tracked as a note
      // there rather than as a failure here.
      const path = url.replace(BASE, '');
      if (/^\/(guides|collections|pages)(\/|\?|$)/.test(path)) return;

      badResponses.push(`${status} ${path} [${context}]`);
    });
    page.on('pageerror', (error) => pageErrors.push(`${context}: ${String(error).slice(0, 140)}`));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      // The browser narrating a 4xx the response watcher already judged.
      if (/Failed to load resource/.test(text)) return;
      consoleErrors.push(`${context}: ${text.slice(0, 140)}`);
    });
  }

  // ------------------------------------------- responsive + accessibility
  for (const theme of ['light', 'dark']) {
    for (const viewport of VIEWPORTS) {
      section(`${theme} · ${viewport.name} — ${viewport.width}x${viewport.height}`);

      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
      });
      await context.addCookies([
        { name: 'gt.age_ok', value: '1', url: BASE },
        { name: 'gt.admin_theme', value: theme, url: BASE },
      ]);

      const page = await context.newPage();
      watch(page, `${theme}/${viewport.name}`);
      await signIn(page);

      for (const path of PAGES) {
        const label = `${theme} ${viewport.name} ${path}`;

        const response = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);

        check(`${label} returns 200`, response?.status() === 200, `got ${response?.status()}`);

        // The theme has to actually be applied, or every dark-mode check below
        // is silently auditing the light theme twice.
        const applied = await page.locator(`[data-admin-theme="${theme}"]`).count();
        check(`${label} renders in the ${theme} theme`, applied === 1, `${applied} found`);

        const spill = await overflow(page);
        check(
          `${label} has no horizontal overflow`,
          spill === null,
          spill
            ? spill.worst
              ? `${spill.overhang}px past the viewport, widest <${spill.worst.tag} class="${spill.worst.cls}">`
              : `${spill.overhang}px past the viewport — every offender is inside a scroll container, so the cause is an absolutely-positioned or escaping child`
            : undefined,
        );

        const headings = await page.locator('h1').count();
        check(`${label} has exactly one h1`, headings === 1, `${headings} found`);

        const mains = await page.locator('main').count();
        check(`${label} has exactly one main landmark`, mains === 1, `${mains} found`);

        const violations = await audit(page);
        check(`${label} passes accessibility`, violations.length === 0, violations.join('; '));
      }

      await context.close();
    }
  }

  // ------------------------------------------------------------ navigation
  section('Navigation');

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: 'gt.age_ok', value: '1', url: BASE }]);
  const page = await context.newPage();
  watch(page, 'crawl');
  await signIn(page);

  const seen = new Set();
  const broken = [];

  for (const path of PAGES) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);

    const links = await page.evaluate(() =>
      [...document.querySelectorAll('a[href]')]
        .map((a) => a.getAttribute('href'))
        .filter((href) => href && href.startsWith('/') && !href.startsWith('//')),
    );

    for (const href of links) {
      const clean = href.split('#')[0];
      if (!clean || seen.has(clean)) continue;
      seen.add(clean);

      const response = await context.request.get(`${BASE}${clean}`, { maxRedirects: 5 });
      if (response.status() >= 400) broken.push(`${clean} -> ${response.status()} (from ${path})`);
    }
  }

  check(
    `every link reachable from the admin resolves — ${seen.size} followed`,
    broken.length === 0,
    broken.slice(0, 8).join('; '),
  );

  // The sidebar is the admin's spine: every entry must go somewhere real.
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  const navLinks = await page.evaluate(() =>
    [...document.querySelectorAll('nav[aria-label="Admin"] a')].map((a) => a.getAttribute('href')),
  );
  check('the sidebar lists every module', navLinks.length >= 16, `${navLinks.length} entries`);

  const navBroken = [];
  for (const href of navLinks) {
    if (!href) continue;
    const response = await context.request.get(`${BASE}${href}`, { maxRedirects: 5 });
    if (response.status() >= 400) navBroken.push(`${href} -> ${response.status()}`);
  }
  check('every sidebar entry resolves', navBroken.length === 0, navBroken.join('; '));

  // ------------------------------------------------------------------ API
  section('Admin APIs');

  const endpoints = [
    { path: '/api/admin/search?q=pebble', expect: 200, label: 'global search' },
    { path: '/api/admin/reports/sales?format=csv', expect: 200, label: 'sales export' },
    { path: '/api/admin/reports/inventory?format=csv', expect: 200, label: 'inventory export' },
    { path: '/api/admin/reports/customers?format=xls', expect: 200, label: 'customer export' },
  ];

  for (const endpoint of endpoints) {
    const response = await context.request.get(`${BASE}${endpoint.path}`);
    check(
      `${endpoint.label} responds ${endpoint.expect}`,
      response.status() === endpoint.expect,
      `got ${response.status()}`,
    );
  }

  // An unknown report key must not 500 — it falls back rather than throwing.
  const unknown = await context.request.get(`${BASE}/api/admin/reports/not-a-report?format=csv`);
  check('an unknown report key falls back rather than erroring', unknown.status() === 200, `got ${unknown.status()}`);

  await context.close();

  // -------------------------------------------------------------- network
  section('Network and console');

  check('no unexpected 4xx/5xx responses', badResponses.length === 0, badResponses.slice(0, 6).join('; '));
  check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 4).join('; '));
  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 4).join('; '));

  await browser.close();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  for (const failure of failures) console.log(`  FAILED: ${failure}`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
