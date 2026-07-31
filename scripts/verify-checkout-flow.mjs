import { chromium } from 'playwright';

/**
 * End-to-end verification of the cart and checkout, in a real browser.
 *
 * Every check drives the actual UI — clicking the real buttons, reading the
 * rendered numbers — rather than calling the API underneath. A cart service that
 * works while the button calling it does not is a cart that does not work.
 *
 *   npm run build && npx next start -p 3100
 *   node scripts/verify-checkout-flow.mjs
 *
 * ## Two rules this harness learned the hard way
 *
 * 1. **Never retry a mutating click.** An earlier version wrapped "click, then
 *    check" in a retry loop; the check used a wrong selector, so it clicked
 *    "increase quantity" fourteen times and reported a $1246 subtotal as a
 *    pricing bug. Wait for hydration once, with a read-only probe, then act.
 * 2. **Wait for the server action, not for a guess.** These actions take seconds
 *    against a remote database. A fixed `waitForTimeout` turns latency into a
 *    phantom failure — which it did, and cost an hour chasing a cart bug that
 *    did not exist.
 *
 * Plain `.mjs`: a TypeScript transform injects an esbuild `__name` helper into
 * `page.evaluate` bodies, which does not exist in the browser.
 */

const BASE = process.env.BASE_URL ?? 'http://localhost:3100';

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

/** Money on screen ("$178.00") back to integer cents, so checks compare exactly. */
function cents(text) {
  const match = (text ?? '').replace(/\s/g, '').match(/-?\$?([\d,]+)\.(\d{2})/);
  return match ? Number(match[1].replace(/,/g, '')) * 100 + Number(match[2]) : null;
}

/**
 * React has taken over the markup.
 *
 * Read-only, so it is safe to poll: React stamps `__reactFiber$…` onto DOM nodes
 * as it hydrates them, and before that every onClick is inert.
 */
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
 * Clicks once, then polls read-only until the page reflects the change.
 *
 * Waiting for the action's HTTP response is not enough: the re-render streams in
 * afterwards, so a read taken the instant the POST resolves still sees the old
 * numbers. `expectation` runs in the browser and must be side-effect free -
 * polling it is safe, re-clicking would not be.
 */
async function act(page, locator, expectation) {
  await locator.click();

  if (!expectation) {
    await page
      .waitForResponse(
        (r) => r.request().method() === 'POST' && !!r.request().headers()['next-action'],
        { timeout: 30_000 },
      )
      .catch(() => {});
    await page.waitForTimeout(800);
    return true;
  }

  return page
    .waitForFunction(expectation, { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
}



async function newGuest(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: 'gt.age_ok', value: '1', url: BASE }]);
  return context;
}

async function main() {
  const browser = await chromium.launch();
  const context = await newGuest(browser);
  const page = await context.newPage();

  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 160)));

  try {
    const list = await (await context.request.get(`${BASE}/api/products?limit=1`)).json();
    const slug = list?.data?.[0]?.slug;
    if (!slug) throw new Error('No products — run `npm run db:seed:catalog`.');

    const detail = await (await context.request.get(`${BASE}/api/products/${slug}`)).json();
    const product = detail.data;
    const unitPriceCents = product.variants[0].salePriceCents ?? product.variants[0].priceCents;

    // ---------------------------------------------------------------- CART
    console.log('\nCart');

    await page.goto(`${BASE}${product.href}`, { waitUntil: 'domcontentloaded' });
    await hydrated(page);

    const started = Date.now();
    const addedOk = await act(
      page,
      page.getByRole('button', { name: /add to bag/i }).first(),
      () => /added to your bag/i.test(document.body.textContent ?? ''),
    );
    const addMs = Date.now() - started;
    check('add to cart from the product page', addedOk);
    console.log(`        (add-to-cart round trip: ${addMs}ms)`);

    const badgeOk = await page
      .waitForFunction(
        () =>
          /1 item/.test(
            document.querySelector('button[aria-label*="bag"]')?.getAttribute('aria-label') ?? '',
          ),
        { timeout: 15_000 },
      )
      .then(() => true)
      .catch(() => false);
    const badge = await page.locator('button[aria-label*="bag"]').first().getAttribute('aria-label');
    check('header bag badge updates without a reload', badgeOk, `read "${badge}"`);

    await page.goto(`${BASE}/cart`, { waitUntil: 'domcontentloaded' });
    await hydrated(page);
    check(
      'item appears on the cart page',
      await page.locator('main').getByText(product.name).first().isVisible(),
    );

    await page.reload({ waitUntil: 'domcontentloaded' });
    await hydrated(page);
    check(
      'cart survives a page refresh',
      await page.locator('main').getByText(product.name).first().isVisible(),
    );

    const subtotal = () => page.locator('main dl dd').first().textContent();
    check('subtotal matches the unit price', cents(await subtotal()) === unitPriceCents);

    // Quantity up. One click, then poll until the stepper actually reads 2.
    const doubled = unitPriceCents * 2;
    check(
      'quantity increases',
      await act(page, page.getByRole('button', { name: /increase quantity/i }).first(), () => {
        const value = document.querySelector('main span[aria-live="polite"]');
        return (value?.textContent ?? '').trim().startsWith('2');
      }),
    );
    check(
      'subtotal doubles with quantity',
      cents(await subtotal()) === doubled,
      `expected ${doubled}c, read ${cents(await subtotal())}c`,
    );

    // Down again. At quantity 1 the control is labelled "Remove", so this
    // selector only matches while the line holds 2.
    check(
      'quantity decreases',
      await act(page, page.getByRole('button', { name: /decrease quantity/i }).first(), () => {
        const value = document.querySelector('main span[aria-live="polite"]');
        return (value?.textContent ?? '').trim().startsWith('1');
      }),
    );

    check(
      'save for later moves the item out of the bag',
      await act(page, page.getByRole('button', { name: /save for later/i }).first(), () =>
        /saved for later/i.test(document.querySelector('main')?.textContent ?? ''),
      ),
    );

    check(
      'move back to bag restores it',
      await act(page, page.getByRole('button', { name: /move to bag/i }).first(), () =>
        !/saved for later/i.test(document.querySelector('main')?.textContent ?? ''),
      ),
    );

    // Promo code.
    await page.fill('#coupon-code', 'WELCOME10');
    check(
      'promo code applies',
      await act(page, page.getByRole('button', { name: 'Apply', exact: true }), () =>
        /WELCOME10 applied/i.test(document.querySelector('main')?.textContent ?? ''),
      ),
    );
    check(
      'discount appears in the summary',
      /discount/i.test((await page.locator('main dl').first().textContent()) ?? ''),
    );

    // Tax estimate for a real destination.
    await page.getByRole('button', { name: /estimate shipping/i }).click();
    await page.waitForTimeout(300);
    await page.selectOption('select[name="state"]', 'CA');
    await page.fill('input[name="postalCode"]', '90002');
    check(
      'tax is charged once a destination is known',
      await act(page, page.getByRole('button', { name: 'Update', exact: true }), () => {
        const text = document.querySelector('main dl')?.textContent ?? '';
        return text.includes('Sales tax') && !/estimated at checkout/i.test(text);
      }),
    );

    // Remove, then undo. The undo lives in a toast that auto-dismisses after five
    // seconds, so it is claimed first — the emptied bag behind it takes a server
    // round trip and would outlast the toast if waited on first.
    const undo = page.getByRole('button', { name: /^Undo$/ }).first();
    await page.getByRole('button', { name: /^Remove/i }).first().click();

    const undoOffered = await undo
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    check('undo is offered after removing', undoOffered);

    if (undoOffered) {
      // Clicked immediately, while the removal is still in flight — the case the
      // undo handler has to chain rather than race.
      await undo.click();
      await page.waitForTimeout(4000);
      await page.goto(`${BASE}/cart`, { waitUntil: 'domcontentloaded' });
      await hydrated(page);
      check(
        'undo restores the item, even mid-removal',
        await page
          .locator('main')
          .getByText(product.name)
          .first()
          .waitFor({ state: 'visible', timeout: 20_000 })
          .then(() => true)
          .catch(() => false),
      );
    }

    // Now remove for real and let it settle.
    check(
      'remove empties the bag',
      await act(page, page.getByRole('button', { name: /^Remove/i }).first(), () =>
        /your bag is empty/i.test(document.querySelector('main')?.textContent ?? ''),
      ),
    );

    // Guest isolation. A fresh context has no cart cookie and must see nothing.
    const other = await newGuest(browser);
    const otherPage = await other.newPage();
    await otherPage.goto(`${BASE}/cart`, { waitUntil: 'domcontentloaded' });
    check(
      'a second guest gets their own empty cart',
      await otherPage
        .locator('main')
        .getByText(/your bag is empty/i)
        .last()
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => true)
        .catch(() => false),
    );
    await other.close();

    // ------------------------------------------------------------ CHECKOUT
    console.log('\nCheckout');

    // Guarantee a non-empty bag regardless of how the cart section ended, or
    // `/checkout` redirects away and every check below reports a phantom failure.
    const cartNow = await (await context.request.get(`${BASE}/api/cart`)).json();
    if (!cartNow.data || cartNow.data.lines.length === 0) {
      await context.request.post(`${BASE}/api/cart`, {
        data: { variantId: product.variants[0].id, quantity: 1 },
        headers: { origin: BASE },
      });
    }

    await page.goto(`${BASE}/checkout`, { waitUntil: 'domcontentloaded' });
    await hydrated(page);
    check('checkout loads with items in the bag', new URL(page.url()).pathname === '/checkout');

    const heading = () => page.locator('#checkout-step-heading').textContent();
    check('step 1 is Contact', (await heading())?.includes('reach you'));

    await page.fill('#email', 'not-an-email');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForTimeout(700);
    check('invalid email blocks the step', (await heading())?.includes('reach you'));
    check(
      'invalid email is called out',
      await page.locator('#email-error').isVisible().catch(() => false),
    );

    await page.fill('#email', 'verify@example.test');
    await page.getByRole('button', { name: 'Continue' }).click();
    check(
      'valid email advances to Shipping',
      await page
        .waitForFunction(
          () => /Where is it going/.test(
            document.getElementById('checkout-step-heading')?.textContent ?? '',
          ),
          { timeout: 15_000 },
        )
        .then(() => true)
        .catch(() => false),
    );

    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForTimeout(700);
    check('empty address blocks the step', (await heading())?.includes('Where is it going'));
    const addressErrors = await page.locator('[role="alert"]').count();
    check('empty address reports field errors', addressErrors > 0, `${addressErrors} shown`);

    await page.fill('#shippingAddress-firstName', 'Ada');
    await page.fill('#shippingAddress-lastName', 'Lovelace');
    await page.fill('#shippingAddress-line1', '1 Analytical Way');
    await page.fill('#shippingAddress-city', 'Los Angeles');
    await page.selectOption('#shippingAddress-state', 'CA');
    await page.fill('#shippingAddress-postalCode', '123');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForTimeout(800);

    check('malformed ZIP blocks the step', (await heading())?.includes('Where is it going'));
    const zipError = await page
      .locator('#shippingAddress-postalCode-error')
      .textContent()
      .catch(() => null);
    check('malformed ZIP is called out', /valid ZIP/i.test(zipError ?? ''), `read "${zipError}"`);

    const options = await page.locator('input[name="shippingRateId"]').count();
    check('delivery methods are offered', options >= 2, `${options} shown`);
    check(
      'a delivery method is preselected',
      (await page.locator('input[name="shippingRateId"]:checked').count()) === 1,
    );

    await page.fill('#shippingAddress-postalCode', '90002');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForTimeout(800);
    check('valid address advances to Payment', (await heading())?.includes('like to pay'));

    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForTimeout(700);
    check('advances to Review', (await heading())?.includes('Check everything over'));

    const review = (await page.locator('main dl').first().textContent()) ?? '';
    check('review shows the email', review.includes('verify@example.test'));
    check('review shows the address', /1 Analytical Way/.test(review) && /90002/.test(review));
    check('review shows the delivery method', /business days/i.test(review));

    check('age confirmation is not pre-ticked', !(await page.locator('#ageConfirmed').isChecked()));
    check('terms are not pre-ticked', !(await page.locator('#acceptTerms').isChecked()));

    await page.getByRole('button', { name: /continue to payment/i }).click();
    await page.waitForTimeout(1000);
    check('unticked age/terms block submission', (await heading())?.includes('Check everything'));
    check(
      'unticked age/terms are called out',
      (await page.locator('#ageConfirmed-error, #acceptTerms-error').count()) > 0,
    );

    // The summary beside the form must agree with the cart it came from.
    const onScreen = cents(await page.locator('aside .text-h5').first().textContent());
    const apiCart = await (await context.request.get(`${BASE}/api/cart`)).json();
    check(
      'checkout summary total matches the cart',
      onScreen === apiCart.data.totals.totalCents,
      `screen ${onScreen}c vs api ${apiCart.data.totals.totalCents}c`,
    );

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
