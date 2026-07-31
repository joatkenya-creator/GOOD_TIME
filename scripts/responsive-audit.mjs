import { mkdir } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';

/**
 * Responsive audit.
 *
 * Drives a real Chromium at every breakpoint the design claims to support and
 * measures what actually renders. Breakpoint classes in the markup prove nothing —
 * this is what catches the layout that overflows at 360px because one price row
 * cannot wrap.
 *
 *   npm run audit:responsive
 *
 * Plain `.mjs` on purpose: running this through a TypeScript transform injects an
 * esbuild `__name` helper into `page.evaluate` bodies, which does not exist in the
 * browser and fails at runtime.
 *
 * Screenshots land in `.audit/`. The checks below are the parts that can be
 * automated; the screenshots are for the parts that cannot.
 */

const BASE = process.env.BASE_URL ?? 'http://localhost:3100';
const OUT = '.audit';

/** Real device widths, not round numbers. */
const VIEWPORTS = [
  { name: '360-android', width: 360, height: 800 },
  { name: '390-iphone', width: 390, height: 844 },
  { name: '768-tablet', width: 768, height: 1024 },
  { name: '1024-laptop', width: 1024, height: 768 },
  { name: '1440-desktop', width: 1440, height: 900 },
  { name: '2560-ultrawide', width: 2560, height: 1440 },
];

const PAGES = [
  { name: 'home', path: '/' },
  { name: 'listing', path: '/shop' },
  { name: 'listing-filtered', path: '/shop?material=platinum-cure-silicone&sort=price_asc' },
  { name: 'listing-list', path: '/shop?view=list' },
  { name: 'category', path: '/shop/vibrators' },
  { name: 'product', path: '/shop/vibrators/wands/aurora-rechargeable-wand' },
  { name: 'search', path: '/search?q=vibrator' },
  { name: 'compare', path: '/compare' },
];

const SHOOT_PAGES = ['home', 'listing', 'listing-list', 'category', 'product'];
const SHOOT_VIEWPORTS = ['360-android', '768-tablet', '1440-desktop', '2560-ultrawide'];

const findings = [];
const measurements = [];

/** Set by `runEngine`, so every finding says which engine produced it. */
let currentEngine = 'chromium';

function record(page, viewport, severity, detail) {
  findings.push({ engine: currentEngine, page, viewport, severity, detail });
}

/**
 * Horizontal overflow: the defining responsive bug. It produces a sideways
 * scrollbar on the whole document and makes a phone layout feel broken.
 *
 * 1px of slack absorbs sub-pixel rounding. Anything inside a deliberate
 * `overflow-x` container is excluded — scrolling those is the intended design.
 */
const OVERFLOW_PROBE = (viewportWidth) => {
  const documentOverflow = document.documentElement.scrollWidth - viewportWidth;
  const offenders = [];

  if (documentOverflow > 1) {
    const all = Array.prototype.slice.call(document.body.querySelectorAll('*'));
    for (let i = 0; i < all.length; i++) {
      const element = all[i];
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.right <= viewportWidth + 1) continue;

      let node = element;
      let inScrollRegion = false;
      while (node && node !== document.body) {
        const overflowX = getComputedStyle(node).overflowX;
        if (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'hidden') {
          inScrollRegion = true;
          break;
        }
        node = node.parentElement;
      }
      if (inScrollRegion) continue;

      const cls =
        typeof element.className === 'string' && element.className
          ? '.' + element.className.split(/\s+/).slice(0, 3).join('.')
          : '';
      offenders.push({
        selector: element.tagName.toLowerCase() + cls,
        right: Math.round(rect.right),
      });
      if (offenders.length >= 4) break;
    }
  }

  return { documentOverflow, offenders };
};

/**
 * Tap targets. WCAG 2.5.8 sets 24x24 CSS pixels as the floor; Apple and Google
 * both recommend 44. Anything under 24 is flagged.
 */
const TAP_PROBE = () => {
  const small = [];
  const nodes = document.querySelectorAll(
    'a, button, input[type=checkbox], input[type=radio], select, [role=tab], [role=radio]',
  );

  for (let i = 0; i < nodes.length; i++) {
    const element = nodes[i];
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (getComputedStyle(element).visibility === 'hidden') continue;

    /*
     * Cards use a stretched `::before` overlay so the whole tile is clickable
     * while exposing one accessible name. The anchor's own box is just the
     * title text, so measuring it reports a false positive — the real target is
     * the card.
     */
    const before = getComputedStyle(element, '::before');
    if (before.position === 'absolute' && before.inset === '0px') continue;

    if (rect.width < 24 || rect.height < 24) {
      const label =
        element.getAttribute('aria-label') ||
        (element.textContent || '').trim().slice(0, 30) ||
        element.tagName.toLowerCase();
      small.push({ label, w: Math.round(rect.width), h: Math.round(rect.height) });
      if (small.length >= 6) break;
    }
  }
  return small;
};

/** Text clipped by a fixed height rather than wrapping. */
const CLIP_PROBE = () => {
  const clipped = [];
  const nodes = document.querySelectorAll('h1, h2, h3, p, span, a, button, dd, dt');

  for (let i = 0; i < nodes.length; i++) {
    const element = nodes[i];
    if (element.children.length > 0) continue;

    const rect = element.getBoundingClientRect();
    // Screen-reader-only text is deliberately 1x1 with `overflow: hidden` and a
    // clip rect, which otherwise trips every single one of these checks.
    if (rect.width <= 1 || rect.height <= 1) continue;

    const style = getComputedStyle(element);
    if (style.overflow === 'visible') continue;
    if (style.textOverflow === 'ellipsis') continue;
    if (style.webkitLineClamp && style.webkitLineClamp !== 'none') continue;
    if (style.clip && style.clip !== 'auto') continue;
    if (element.clientHeight > 0 && element.scrollHeight > element.clientHeight + 2) {
      clipped.push({
        tag: element.tagName.toLowerCase(),
        text: (element.textContent || '').trim().slice(0, 40),
      });
      if (clipped.length >= 4) break;
    }
  }
  return clipped;
};

/** Layout expectations that differ by breakpoint. */
const LAYOUT_PROBE = () => {
  const isVisible = (selector) => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const grid = document.querySelector('ol.grid');
  const columns = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : null;

  const heroGrid = document.querySelector('main .grid');
  const heroColumns = heroGrid
    ? getComputedStyle(heroGrid).gridTemplateColumns.split(' ').length
    : null;

  return {
    desktopNav: isVisible('nav[aria-label="Main"]'),
    mobileMenuButton: isVisible('button[aria-label="Open menu"]'),
    filterSidebar: isVisible('aside[aria-label="Product filters"]'),
    headerSearch: isVisible('#site-search'),
    columns,
    heroColumns,
    bodyWidth: Math.round(document.body.getBoundingClientRect().width),
    shellWidth: (() => {
      const shell = document.querySelector('main > div, main > section');
      return shell ? Math.round(shell.getBoundingClientRect().width) : null;
    })(),
  };
};

/**
 * Runs the whole matrix against one engine.
 *
 * WebKit is included because it is Safari's engine, and Safari is where a mobile
 * storefront actually breaks: `dvh` units, `contain`, scroll-snap and
 * `backdrop-filter` all behave differently there. Verifying only in Chromium
 * tests the browser that a large share of this traffic will not be using.
 */
async function runEngine(engineName, launcher) {
  currentEngine = engineName;
  const browser = await launcher.launch();

  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
      // Dismiss the age gate up front. Every page sits behind it and it is not
      // what this audit measures.
      storageState: {
        cookies: [
          {
            name: 'gt.age_ok',
            value: '1',
            domain: 'localhost',
            path: '/',
            expires: -1,
            httpOnly: false,
            secure: false,
            sameSite: 'Lax',
          },
        ],
        origins: [],
      },
    });

    const page = await context.newPage();

    for (const target of PAGES) {
      /*
       * `domcontentloaded` rather than `networkidle`. Next keeps a connection
       * open for RSC prefetching, so `networkidle` never settles and every
       * navigation times out. Waiting for `main` plus fonts is both faster and
       * deterministic — and fonts are what actually change the measurements.
       */
      await page.goto(`${BASE}${target.path}`, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      await page.waitForSelector('main', { timeout: 30_000 });
      await page.evaluate(() => document.fonts.ready);
      // One frame, so layout has definitely settled after webfont swap.
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => resolve(null))),
      );

      const overflow = await page.evaluate(OVERFLOW_PROBE, viewport.width);
      if (overflow.documentOverflow > 1) {
        const worst = overflow.offenders.length
          ? overflow.offenders.map((o) => `${o.selector} @ ${o.right}px`).join(' | ')
          : 'no single offender identified';
        record(
          target.name,
          viewport.name,
          'FAIL',
          `horizontal overflow +${overflow.documentOverflow}px — ${worst}`,
        );
      }

      const layout = await page.evaluate(LAYOUT_PROBE);
      const isDesktop = viewport.width >= 1024;

      if (isDesktop) {
        if (layout.desktopNav === false)
          record(target.name, viewport.name, 'FAIL', 'desktop nav hidden at >=1024');
        if (layout.mobileMenuButton === true)
          record(target.name, viewport.name, 'FAIL', 'mobile menu button visible at >=1024');
      } else {
        if (layout.desktopNav === true)
          record(target.name, viewport.name, 'FAIL', 'desktop nav visible below 1024');
        if (layout.mobileMenuButton === false)
          record(target.name, viewport.name, 'FAIL', 'mobile menu button hidden below 1024');
        if (layout.filterSidebar === true)
          record(target.name, viewport.name, 'FAIL', 'filter sidebar visible below 1024');
      }

      if (viewport.width <= 414) {
        const small = await page.evaluate(TAP_PROBE);
        for (const entry of small) {
          record(
            target.name,
            viewport.name,
            'WARN',
            `tap target ${entry.w}x${entry.h}px under 24px: "${entry.label}"`,
          );
        }
      }

      const clipped = await page.evaluate(CLIP_PROBE);
      for (const entry of clipped) {
        record(target.name, viewport.name, 'WARN', `clipped <${entry.tag}>: "${entry.text}"`);
      }

      measurements.push(
        `${engineName.padEnd(9)} ${viewport.name.padEnd(15)} ${target.name.padEnd(17)} ` +
          `overflow=${(overflow.documentOverflow > 1 ? `+${overflow.documentOverflow}px` : 'none').padEnd(8)} ` +
          `cols=${String(layout.columns ?? '-').padEnd(3)} ` +
          `nav=${layout.desktopNav === true ? 'desktop' : 'mobile '} ` +
          `filters=${layout.filterSidebar === true ? 'sidebar' : 'drawer '}`,
      );

      // Screenshots from one engine only — they are for eyeballing layout, and
      // two sets of the same pages is just more to look at.
      if (
        engineName === 'chromium' &&
        SHOOT_PAGES.includes(target.name) &&
        SHOOT_VIEWPORTS.includes(viewport.name)
      ) {
        await page.screenshot({
          path: `${OUT}/${target.name}--${viewport.name}.png`,
          // Above the fold: where layout problems show up first, and small enough
          // to actually look at.
          fullPage: false,
        });
      }
    }

    await context.close();
  }

  await browser.close();
}

async function main() {
  await mkdir(OUT, { recursive: true });

  for (const [name, launcher] of [
    ['chromium', chromium],
    ['webkit', webkit],
  ]) {
    await runEngine(name, launcher);
  }

  console.log('\n=== measurements ===');
  console.log(measurements.join('\n'));

  const fails = findings.filter((f) => f.severity === 'FAIL');
  const warns = findings.filter((f) => f.severity === 'WARN');

  console.log('\n=== findings ===');
  if (!findings.length) console.log('none');
  for (const finding of fails.concat(warns)) {
    console.log(
      `${finding.severity}  [${finding.engine}] ${finding.page} @ ${finding.viewport}: ${finding.detail}`,
    );
  }

  console.log(
    `\n${fails.length} failures, ${warns.length} warnings across ${measurements.length} page/viewport combinations.`,
  );
  console.log(`Screenshots in ${OUT}/`);

  if (fails.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
