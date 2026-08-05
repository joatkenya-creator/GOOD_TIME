import { expect, test as base, type Page } from '@playwright/test';

/**
 * Shared E2E fixtures.
 *
 * Two things live here rather than being repeated in every spec: signing in,
 * and the age gate.
 *
 * The age gate is the one that would otherwise poison the whole suite. It is an
 * interstitial on first visit, so *every* spec's first navigation lands on it
 * instead of the page under test — and the failure reads as "product page has
 * no add-to-cart button", which sends someone looking in entirely the wrong
 * place.
 */

/** Seeded by `npm run db:seed:customers`. */
export const CUSTOMER = {
  email: 'ada.demo@example.test',
  password: 'GoodTimeDemo2026!',
};

/**
 * Seeded by `npm run db:seed:admin`. Role `ADMIN` — deliberately *not* the
 * highest. Most admin screens should work for an ordinary administrator, and
 * testing with a super-admin would hide a permission that was never granted.
 */
export const ADMIN = {
  email: 'admin.demo@example.test',
  password: 'GoodTimeAdmin2026!',
};

/**
 * Where `e2e/auth.setup.ts` saves the signed-in sessions.
 *
 * Gitignored: these files contain live session cookies.
 */
export const STORAGE_STATE = {
  admin: '.playwright/state-admin.json',
} as const;

/**
 * Accepts the age gate by setting its cookie directly.
 *
 * Clicking through it on every test would add a navigation to each spec and
 * make the gate's own test meaningless — it would be exercised a hundred times
 * and asserted nowhere. `e2e/age-gate.spec.ts` tests the real interaction; the
 * rest start past it.
 */
export async function acceptAgeGate(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      // `COOKIES.ageGate` in src/constants. The value is compared literally.
      name: 'gt.age_ok',
      value: '1',
      domain: new URL(page.url() === 'about:blank' ? 'http://localhost:3000' : page.url()).hostname,
      path: '/',
    },
  ]);
}

/*
 * Playwright names the second fixture argument `use` by convention. Here it is
 * `run`, because ESLint's React Hooks rule treats any call to `use(...)` as the
 * React hook of the same name and fails the build. The name is arbitrary to
 * Playwright; the collision is not.
 */
export const test = base.extend<{ shopper: Page; admin: Page }>({
  /** A page that has already passed the age gate but is not signed in. */
  shopper: async ({ page, baseURL }, run) => {
    await page
      .context()
      .addCookies([
        { name: 'gt.age_ok', value: '1', domain: new URL(baseURL!).hostname, path: '/' },
      ]);
    await run(page);
  },

  /**
   * A signed-in admin, from the session `auth.setup.ts` established once.
   *
   * It used to sign in here, per test. Eleven admin tests meant eleven sign-ins
   * from one IP inside a minute, and the application's own rate limiter — ten
   * attempts per five minutes — correctly refused them. Every admin test then
   * failed on a navigation timeout that looked like an admin bug and was not.
   *
   * The session still comes from the real form; it is just obtained once, in
   * the setup project, and reused. `auth.spec.ts` deliberately does *not* use
   * this fixture, so sign-in itself is still tested end to end.
   */
  admin: async ({ browser, baseURL }, run) => {
    const context = await browser.newContext({ storageState: STORAGE_STATE.admin });
    await context.addCookies([
      { name: 'gt.age_ok', value: '1', domain: new URL(baseURL!).hostname, path: '/' },
    ]);

    const page = await context.newPage();
    await run(page);
    await context.close();
  },
});

export { expect };

/**
 * Signs in through the real form, robustly.
 *
 * Three things this does that the obvious four lines do not, each of which
 * caused a flake:
 *
 *   1. **Targets by `name`, not by label.** The footer's newsletter signup adds
 *      a second email field once the page hydrates, so `getByLabel(/email/i)`
 *      is unambiguous on the server-rendered HTML and ambiguous a moment later.
 *   2. **Waits for hydration before typing.** Filling a React-controlled input
 *      before it is hydrated lets hydration reset the value, so the form
 *      submits empty and answers "Enter a valid email address" — a message that
 *      sends you looking at the schema rather than at the timing.
 *   3. **Verifies the values stuck** before submitting, so a future variation of
 *      the same race fails here, naming the cause, rather than 60 seconds later
 *      as a navigation timeout.
 */
export async function signIn(
  page: Page,
  credentials: { email: string; password: string },
): Promise<void> {
  await page.goto('/sign-in');

  const email = page.locator('input[name="email"]');
  const password = page.locator('input[name="password"]');
  const submit = page.getByRole('button', { name: /sign in/i });

  // The submit button being enabled is the cheapest available signal that the
  // client form is mounted and owns its inputs.
  await expect(submit).toBeEnabled();

  await email.fill(credentials.email);
  await password.fill(credentials.password);

  await expect(email).toHaveValue(credentials.email);
  await expect(password).toHaveValue(credentials.password);

  await submit.click();
  await page.waitForURL((url) => !url.pathname.includes('/sign-in'));
}

/**
 * Navigates to the first real product page.
 *
 * Not `getByRole('link', { name: /view|details/i })`. That matched the header's
 * "Shop" link before it ever reached a product card, so the test then asserted
 * product markup against a category page and failed with "expected Product,
 * received undefined" — a message that blames the schema for a navigation bug.
 *
 * A product URL is `/shop/{category}/{subcategory}/{slug}`: four segments.
 * Category pages have two or three, so the segment count is what distinguishes
 * them, and it keeps working when the catalogue is reordered or renamed.
 */
export async function gotoFirstProduct(page: Page): Promise<string> {
  await page.goto('/shop');

  const href = await page.locator('a[href^="/shop/"]').evaluateAll((links) => {
    const urls = links
      .map((link) => link.getAttribute('href') ?? '')
      .filter((url) => url.split('/').filter(Boolean).length >= 4);
    return urls[0] ?? '';
  });

  expect(href, 'no product link found on /shop').not.toBe('');

  await page.goto(href);
  return href;
}

/**
 * Fails the test on any console error or failed request during the block.
 *
 * A page can look perfect and still be broken: a 500 from a fetch nobody
 * awaited, a hydration mismatch, a CSP violation blocking the analytics
 * beacon. None of those change a single pixel, and all of them are bugs.
 *
 * The ignore list is deliberately short and each entry is justified — a growing
 * ignore list is how this check stops catching anything.
 */
export async function withCleanConsole(page: Page, block: () => Promise<void>): Promise<void> {
  const problems: string[] = [];

  const IGNORED = [
    // Third-party analytics blocked by an ad blocker in the test browser. Not
    // our failure, and not reproducible for a customer without one.
    /googletagmanager|clarity\.ms|facebook\.net|tiktok|pinimg/i,
    // Playwright's own navigation aborts when a test moves on mid-request.
    /net::ERR_ABORTED/,
    /*
     * The browser's generic console line for a failed subresource. It carries
     * no URL, so it is pure noise — the `response` listener below reports the
     * same failure with the address that actually caused it.
     */
    /^Failed to load resource:/,
  ];

  const ignored = (text: string) => IGNORED.some((pattern) => pattern.test(text));

  const onConsole = (message: { type(): string; text(): string }) => {
    if (message.type() === 'error' && !ignored(message.text())) {
      problems.push(`console: ${message.text()}`);
    }
  };

  /*
   * 4xx counts, not just 5xx.
   *
   * A 404 on a link the site itself renders is a broken link — the single most
   * common way a page looks perfect and is not. Next prefetches every visible
   * link, so a missing route shows up here as a 404 on `?_rsc=...` before any
   * customer has clicked it.
   *
   * The URL is included because "console: Failed to load resource: 404" on its
   * own sends people looking through the wrong file.
   */
  const onResponse = (response: { status(): number; url(): string }) => {
    if (response.status() >= 400 && !ignored(response.url())) {
      problems.push(`HTTP ${response.status()}  ${response.url()}`);
    }
  };

  page.on('console', onConsole as never);
  page.on('response', onResponse as never);

  try {
    await block();
  } finally {
    page.off('console', onConsole as never);
    page.off('response', onResponse as never);
  }

  expect(problems, `Page reported errors:\n${problems.join('\n')}`).toEqual([]);
}
