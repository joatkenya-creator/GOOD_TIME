import { mkdir } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';

/**
 * Cart and checkout audit, in real browsers.
 *
 * Unlike the catalogue audit, this one has to *do* something first: an empty cart
 * renders an empty state and `/checkout` redirects away from it, so nothing about
 * the real layout is observable until something is in the bag. Each run adds a
 * variant through the API, then drives the pages that result.
 *
 *   npm run build && npx next start -p 3100
 *   npm run audit:checkout
 *
 * Serve on whatever port `NEXT_PUBLIC_SITE_URL` names. On any other port Auth.js
 * issues a callback URL for the configured origin, the client's session fetch
 * becomes cross-origin, and CSP blocks it — a console error that belongs to the
 * test setup, not to the application.
 *
 * Plain `.mjs` on purpose — a TypeScript transform injects an esbuild `__name`
 * helper into `page.evaluate` bodies, which does not exist in the browser.
 */

const BASE = process.env.BASE_URL ?? 'http://localhost:3100';
const OUT = '.audit/checkout';

const VIEWPORTS = [
  { name: '360-android', width: 360, height: 800 },
  { name: '390-iphone', width: 390, height: 844 },
  { name: '768-tablet', width: 768, height: 1024 },
  { name: '1440-desktop', width: 1440, height: 900 },
];

const findings = [];
let currentEngine = 'chromium';

function record(page, viewport, severity, detail) {
  findings.push({ engine: currentEngine, page, viewport, severity, detail });
}

/** Horizontal overflow — the defining responsive bug. */
const OVERFLOW_PROBE = (viewportWidth) => {
  const documentOverflow = document.documentElement.scrollWidth - viewportWidth;
  if (documentOverflow <= 1) return { overflow: 0, offenders: [] };

  const offenders = [];
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
      if (overflowX === 'auto' || overflowX === 'scroll') {
        inScrollRegion = true;
        break;
      }
      node = node.parentElement;
    }
    if (inScrollRegion) continue;

    offenders.push(
      element.tagName.toLowerCase() +
        (element.className && typeof element.className === 'string'
          ? '.' + element.className.split(' ').slice(0, 3).join('.')
          : '') +
        ' @' +
        Math.round(rect.right),
    );
    if (offenders.length >= 4) break;
  }

  return { overflow: documentOverflow, offenders };
};

/**
 * WCAG 2.5.8: every interactive control needs a 24x24 target, and 44x44 is the
 * number that actually works for a thumb. Checkout is where an undersized target
 * costs an order rather than a click.
 */
const TAP_TARGET_PROBE = () => {
  const selector = 'a[href], button, input[type="checkbox"], input[type="radio"], select';
  const small = [];

  const elements = Array.prototype.slice.call(document.querySelectorAll(selector));
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (getComputedStyle(element).visibility === 'hidden') continue;

    // A control wrapped in a label inherits the label's hit area.
    const label = element.closest('label');
    const box = label ? label.getBoundingClientRect() : rect;
    if (box.width >= 24 && box.height >= 24) continue;

    small.push(
      element.tagName.toLowerCase() +
        ' "' +
        (element.textContent || element.getAttribute('aria-label') || '').trim().slice(0, 24) +
        '" ' +
        Math.round(box.width) +
        'x' +
        Math.round(box.height),
    );
    if (small.length >= 6) break;
  }

  return small;
};

/** Content that renders before JavaScript runs — the LCP and the no-JS case. */
const ABOVE_FOLD_PROBE = (viewportHeight) => {
  let visible = 0;
  const elements = Array.prototype.slice.call(
    document.querySelectorAll('h1, h2, p, li, button, a[href], input, label'),
  );

  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    const rect = element.getBoundingClientRect();
    if (rect.top >= viewportHeight || rect.bottom <= 0) continue;
    if (rect.width === 0 || rect.height === 0) continue;

    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || Number(style.opacity) < 0.05) continue;

    visible += 1;
  }

  return visible;
};

/** Every form control must have an accessible name. */
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
    const hasLabelFor = id ? Boolean(document.querySelector('label[for="' + id + '"]')) : false;
    const hasAria =
      Boolean(control.getAttribute('aria-label')) ||
      Boolean(control.getAttribute('aria-labelledby'));
    const wrapped = Boolean(control.closest('label'));

    if (!hasLabelFor && !hasAria && !wrapped) {
      unlabelled.push(
        (control.getAttribute('name') || control.getAttribute('type') || 'control') +
          ' (' +
          control.tagName.toLowerCase() +
          ')',
      );
    }
  }

  return unlabelled;
};

/** Adds a real variant to a real cart, so the pages have something to render. */
async function seedCart(context) {
  const response = await context.request.get(`${BASE}/api/products?limit=1`);
  const body = await response.json();
  const slug = body?.data?.[0]?.slug;
  if (!slug) throw new Error('No products available — run `npm run db:seed:catalog` first.');

  const detail = await context.request.get(`${BASE}/api/products/${slug}`);
  const product = await detail.json();
  const variantId = product?.data?.variants?.[0]?.id;
  if (!variantId) throw new Error(`Product ${slug} has no variants.`);

  const added = await context.request.post(`${BASE}/api/cart`, {
    data: { variantId, quantity: 2 },
    headers: { origin: BASE },
  });

  if (!added.ok()) {
    throw new Error(`Add to cart failed: ${added.status()} ${await added.text()}`);
  }

  return { slug, variantId };
}

async function auditPage(context, page, { name, path, shoot }, viewport) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });

  let response;
  try {
    response = await page.goto(`${BASE}${path}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
  } catch (error) {
    // A redirect mid-navigation aborts the goto. That is itself the finding —
    // `/checkout` bouncing to `/cart` means the guest cart was not carried.
    record(name, viewport.name, 'error', `navigation interrupted: ${String(error).slice(0, 120)}`);
    return;
  }

  if (!response || response.status() >= 400) {
    record(name, viewport.name, 'error', `HTTP ${response ? response.status() : 'no response'}`);
    return;
  }

  const landed = new URL(page.url()).pathname;
  if (landed !== path.split('?')[0]) {
    record(name, viewport.name, 'error', `redirected to ${landed}`);
    return;
  }

  await page.waitForSelector('main', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(350);

  const { overflow, offenders } = await page.evaluate(OVERFLOW_PROBE, viewport.width);
  if (overflow > 1) {
    record(
      name,
      viewport.name,
      'error',
      `${overflow}px horizontal overflow — ${offenders.join(', ')}`,
    );
  }

  const small = await page.evaluate(TAP_TARGET_PROBE);
  if (small.length > 0) {
    record(name, viewport.name, 'warn', `tap targets under 24px: ${small.join('; ')}`);
  }

  const unlabelled = await page.evaluate(LABEL_PROBE);
  if (unlabelled.length > 0) {
    record(name, viewport.name, 'error', `unlabelled controls: ${unlabelled.join(', ')}`);
  }

  const aboveFold = await page.evaluate(ABOVE_FOLD_PROBE, viewport.height);
  if (aboveFold < 3) {
    record(name, viewport.name, 'error', `only ${aboveFold} visible elements above the fold`);
  }

  if (shoot && (viewport.name === '360-android' || viewport.name === '1440-desktop')) {
    await page.screenshot({
      path: `${OUT}/${currentEngine}-${name}-${viewport.name}.png`,
      fullPage: true,
    });
  }
}

async function runEngine(engineName, engine) {
  currentEngine = engineName;
  console.log(`\n${engineName}`);

  const browser = await engine.launch();
  // One context for the whole engine, so the guest cart cookie persists across
  // pages — a fresh context per page would mean an empty cart every time.
  const context = await browser.newContext();

  // Pre-consent to the age gate. Without this the modal covers every page and
  // every measurement below describes the dialog rather than the page under it.
  await context.addCookies([{ name: 'gt.age_ok', value: '1', url: BASE }]);
  const page = await context.newPage();

  try {
    const seeded = await seedCart(context);
    console.log(`  seeded cart with ${seeded.slug}`);

    const PAGES = [
      { name: 'cart', path: '/cart', shoot: true },
      { name: 'checkout', path: '/checkout', shoot: true },
      { name: 'order-lookup', path: '/orders/lookup', shoot: false },
    ];

    for (const target of PAGES) {
      for (const viewport of VIEWPORTS) {
        await auditPage(context, page, target, viewport);
      }
      console.log(`  ${target.name}`);
    }

    // Checkout is a stepper; the later steps only exist after advancing.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/checkout`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('main', { timeout: 15_000 }).catch(() => {});

    // Fill *and* click inside the retry loop. The stepper is client state, so
    // neither does anything until React has hydrated — and a value typed before
    // hydration is not in the form's state, so a later click validates an empty
    // field. WebKit hydrates measurably later than Chromium, which is why a
    // single fill-then-click reports a phantom failure there and not here.
    let onShipping = false;
    for (let attempt = 0; attempt < 5 && !onShipping; attempt += 1) {
      await page.fill('#email', 'audit@example.test').catch(() => {});
      await page
        .getByRole('button', { name: 'Continue' })
        .click({ timeout: 5000 })
        .catch(() => {});
      onShipping = await page
        .waitForFunction(
          () =>
            document.getElementById('checkout-step-heading')?.textContent === 'Where is it going?',
          { timeout: 2000 },
        )
        .then(() => true)
        .catch(() => false);
    }

    if (!onShipping) {
      record('checkout', '390-iphone', 'error', 'could not advance past the contact step');
    } else {
      const { overflow, offenders } = await page.evaluate(OVERFLOW_PROBE, 390);
      if (overflow > 1) {
        record(
          'checkout-shipping',
          '390-iphone',
          'error',
          `${overflow}px overflow — ${offenders.join(', ')}`,
        );
      }

      const unlabelled = await page.evaluate(LABEL_PROBE);
      if (unlabelled.length > 0) {
        record('checkout-shipping', '390-iphone', 'error', `unlabelled: ${unlabelled.join(', ')}`);
      }

      const small = await page.evaluate(TAP_TARGET_PROBE);
      if (small.length > 0) {
        record('checkout-shipping', '390-iphone', 'warn', `small targets: ${small.join('; ')}`);
      }

      await page.screenshot({
        path: `${OUT}/${engineName}-checkout-shipping-390.png`,
        fullPage: true,
      });
      console.log('  checkout-shipping');
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });

  await runEngine('chromium', chromium);
  await runEngine('webkit', webkit);

  const errors = findings.filter((finding) => finding.severity === 'error');
  const warnings = findings.filter((finding) => finding.severity === 'warn');

  console.log(`\n${errors.length} errors, ${warnings.length} warnings\n`);

  for (const finding of [...errors, ...warnings]) {
    console.log(
      `  ${finding.severity.toUpperCase().padEnd(5)} [${finding.engine}] ${finding.page} @ ${finding.viewport}\n        ${finding.detail}`,
    );
  }

  console.log(`\nScreenshots in ${OUT}/\n`);
  if (errors.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
