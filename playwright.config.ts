import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests.
 *
 * ## Against a production build, not the dev server
 *
 * `next dev` is a different application: unminified, unbundled, with different
 * caching, no `next/script` ordering guarantees, and error overlays that swallow
 * failures a customer would see. Testing it proves the dev server works.
 *
 * ## Data
 *
 * These run against the seeded catalogue (`npm run db:seed:catalog` and
 * friends), which is why the specs reference known slugs rather than "the first
 * product on the page". A test that clicks whatever happens to be first fails
 * for a reason that has nothing to do with the code the day the catalogue is
 * reordered.
 *
 * ## Payments
 *
 * Klarna's widget renders inside a cross-origin iframe that Playwright cannot
 * and should not drive — automating a third party's payment UI produces a test
 * that fails whenever Klarna ships a redesign. The specs go as far as the
 * widget mounting with a real client token, which is the last thing we control.
 * Klarna's own playground flow is a manual pre-launch check; see
 * docs/go-live.md.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './.playwright',

  /*
   * Fully parallel, but writes are serialised per file.
   *
   * Two workers racing to place an order against the same seeded variant
   * deplete stock and fail each other in a way that looks like a checkout bug.
   * Specs that mutate declare `test.describe.serial`.
   */
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,

  // A `.only` left in a commit silently skips the rest of the suite.
  forbidOnly: Boolean(process.env.CI),

  /*
   * One retry in CI, none locally.
   *
   * Retries hide flakes, and a hidden flake becomes a real bug nobody
   * investigated. One is enough to ride out a cold start; more is a policy of
   * not looking.
   */
  retries: process.env.CI ? 1 : 0,

  reporter: process.env.CI
    ? [
        ['github'],
        ['html', { open: 'never' }],
        ['json', { outputFile: '.playwright/results.json' }],
      ]
    : [['list']],

  /*
   * 60s per test, not Playwright's 30s default.
   *
   * Every test here talks to a real database that may be a continent away, and
   * signing in additionally pays bcrypt — which is deliberately slow. A single
   * sign-in measures 5–7s on a developer machine and more with parallel workers
   * competing for the same connection pool.
   *
   * At 30s the auth tests failed on `page.waitForURL: Test timeout exceeded`,
   * which reads as a broken sign-in page rather than a budget that was too
   * tight. This is headroom for latency, not permission to write slow tests:
   * anything genuinely approaching a minute is doing something wrong.
   */
  timeout: 60_000,

  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    // Only on a failure, and only for the retry — traces are large and nobody
    // opens the ones from a passing run.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Generous, because a cold Next.js route compiles on first hit.
    actionTimeout: 15_000,
    /*
     * 60s, matching the per-test budget.
     *
     * A sign-in navigation waits on bcrypt plus several round trips to a
     * database that may be on another continent — measured at 5–15s here, and
     * longer with parallel workers competing for the connection pool. At 30s
     * the auth tests failed on `page.waitForURL: Timeout`, which reads as a
     * broken sign-in page rather than a budget that was too tight for the
     * environment.
     */
    navigationTimeout: 60_000,
  },

  projects: [
    /*
     * Runs first. Signs in once and saves the sessions the `admin` fixture
     * reuses — see `e2e/auth.setup.ts` for why signing in per test made the
     * application's own rate limiter fail the suite.
     */
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
      /*
       * Its own simulated client address.
       *
       * The limiter buckets by `CF-Connecting-IP`, so without this the three
       * setup sign-ins share one allowance with `auth.spec.ts`'s genuine
       * sign-in tests. Together they approach ten attempts in five minutes and
       * the limiter — correctly — starts refusing, which surfaces as the setup
       * project timing out and every dependent test being skipped.
       *
       * Three separate identities keep the suite order-independent: setup here,
       * the deliberate lockout test on another, and the real sign-in tests on
       * the default.
       */
      use: { extraHTTPHeaders: { 'cf-connecting-ip': '203.0.113.10' } },
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
    {
      /*
       * WebKit is not optional here.
       *
       * Safari is where `upgrade-insecure-requests`, cookie `SameSite`
       * defaults, `Intl` formatting and iframe storage access all behave
       * differently — and it is a large share of the traffic for a shop like
       * this one. Chromium-only E2E has repeatedly shipped a Safari-only
       * checkout failure.
       */
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      dependencies: ['setup'],
    },
    {
      name: 'mobile',
      use: { ...devices['iPhone 14'] },
      dependencies: ['setup'],
    },
  ],

  /*
   * Starts the built app unless one is already running.
   *
   * `reuseExistingServer` locally so a developer with `npm start` in another
   * terminal is not fighting Playwright for the port; never in CI, where a
   * leftover process would silently test the wrong build.
   */
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'npm run start',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
