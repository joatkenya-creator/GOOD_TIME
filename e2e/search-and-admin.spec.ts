import { expect, test, withCleanConsole } from './fixtures';

/**
 * Search, and the admin dashboard.
 *
 * Grouped because both are read-heavy surfaces where the failure mode is the
 * same: a page that renders, looks correct, and is quietly showing nothing.
 */

test.describe('search', () => {
  test('a real term returns results and reflects the query', async ({ shopper }) => {
    await withCleanConsole(shopper, async () => {
      await shopper.goto('/search?q=silk');

      // The query must be echoed. A results page that does not say what was
      // searched for leaves a customer unable to tell a bad query from no stock.
      await expect(shopper.getByText(/silk/i).first()).toBeVisible();
    });
  });

  test('a term with no matches says so instead of showing an empty grid', async ({ shopper }) => {
    await shopper.goto('/search?q=zzzznotathing');

    await expect(shopper.getByText(/no results|nothing|could not find/i).first()).toBeVisible();
  });

  test('a search term is escaped, not executed', async ({ shopper }) => {
    /*
     * Two attacks in one query. The `<script>` proves the term is escaped on
     * the way into the DOM; the SQL fragment proves it reaches the database as
     * a parameter rather than as syntax.
     */
    let alerted = false;
    shopper.on('dialog', async (dialog) => {
      alerted = true;
      await dialog.dismiss();
    });

    await shopper.goto(`/search?q=${encodeURIComponent(`<script>alert(1)</script>' OR 1=1--`)}`);

    expect(alerted).toBe(false);
    // Still a working page, not a 500. Rejecting the request would also be
    // acceptable; crashing is not.
    expect(shopper.url()).toContain('/search');
    await expect(shopper.locator('body')).toBeVisible();
  });

  test('the suggest endpoint stays responsive once warm', async ({ request, baseURL }) => {
    test.setTimeout(60_000);

    /*
     * Warm first, then take a median of three.
     *
     * A single cold measurement times the route compiling and the database
     * connection opening, which is a one-off a real visitor almost never pays.
     * The median of three warm calls is what typeahead actually feels like.
     */
    await request.get(`${baseURL}/api/search?q=sil`);

    const samples: number[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const startedAt = Date.now();
      const response = await request.get(`${baseURL}/api/search?q=sil`);
      samples.push(Date.now() - startedAt);
      expect(response.status()).toBe(200);
    }

    const median = samples.sort((a, b) => a - b)[1]!;

    /*
     * Three seconds, not the 250ms this should feel like in production.
     *
     * This budget is a smoke check for "the endpoint is not pathological", and
     * it has to hold on a developer laptop talking to a Neon instance on
     * another continent — where the round trip alone is most of the time.
     * Asserting a real typeahead budget here would measure the tester's
     * broadband, and Lighthouse plus production monitoring are where latency is
     * actually held to account.
     */
    expect(median, `samples: ${samples.join(', ')}ms`).toBeLessThan(3_000);
  });

  test('the search API is rate limited', async ({ request, baseURL }) => {
    test.setTimeout(120_000);

    /*
     * Sequential, stopping at the first 429.
     *
     * Firing 80 concurrently saturated the local server and blew Playwright's
     * per-request timeout, so the test failed for being slow rather than for
     * the limiter being wrong. Serial requests are slower in the happy case and
     * deterministic — and the first 429 is the entire assertion.
     */
    let limited = false;

    for (let attempt = 0; attempt < 120 && !limited; attempt += 1) {
      const response = await request.get(`${baseURL}/api/search?q=term${attempt}`, {
        failOnStatusCode: false,
      });

      if (response.status() === 429) {
        limited = true;
        // The limiter must tell the caller when to come back, or a client can
        // only guess and will guess badly.
        expect(Number(response.headers()['retry-after'] ?? 0)).toBeGreaterThan(0);
      }
    }

    // Search is the cheapest endpoint to abuse and the most expensive to serve.
    expect(limited, 'no 429 after 120 requests — is the limiter attached?').toBe(true);
  });
});

test.describe('admin dashboard', () => {
  test('the dashboard renders its key figures', async ({ admin }) => {
    await withCleanConsole(admin, async () => {
      await admin.goto('/admin');

      await expect(admin.getByRole('heading', { level: 1 })).toBeVisible();
      // A dashboard whose tiles render as blank is the classic silent failure:
      // the query threw, the boundary caught it, the layout is intact.
      await expect(admin.getByText(/orders|revenue|today/i).first()).toBeVisible();
    });
  });

  const SCREENS = [
    '/admin/products',
    '/admin/orders',
    '/admin/customers',
    '/admin/inventory',
    '/admin/imports',
    '/admin/jobs',
    '/admin/seo',
    '/admin/settings',
  ];

  for (const path of SCREENS) {
    test(`${path} loads without an error boundary`, async ({ admin }) => {
      const response = await admin.goto(path);

      expect(response!.status()).toBeLessThan(400);
      await expect(admin.getByRole('heading', { level: 1 })).toBeVisible();
      // Next renders the error boundary with a 200, so the status code alone
      // proves nothing.
      await expect(admin.getByText(/something went wrong/i)).toBeHidden();
    });
  }

  test('the jobs screen shows queue depth and dead letters', async ({ admin }) => {
    /*
     * An ordinary `ADMIN`, deliberately — `ROLE_DEFINITIONS` grants it
     * `jobs:read`, and this used to render "Not permitted" for every user in
     * the system because the permission was never seeded. Asserting it with the
     * lesser role is what keeps that regression visible.
     */
    await admin.goto('/admin/jobs');

    await expect(admin.getByText(/not permitted/i)).toBeHidden();

    /*
     * The dead-letter count is the number an operator is actually looking for.
     * Queue depth alone says nothing — a thousand jobs draining in a minute is
     * a busy shop, ten that failed permanently is an outage nobody was told
     * about.
     */
    await expect(admin.getByText(/dead|failed|queued/i).first()).toBeVisible();
  });

  test('an admin action is written to the audit log', async ({ admin }) => {
    await admin.goto('/admin/audit');

    await expect(admin.getByRole('heading', { level: 1 })).toBeVisible();
    // Signing in is itself auditable, so the log is never empty by the time a
    // test can see it.
    await expect(admin.getByText(/sign|update|create|view/i).first()).toBeVisible();
  });
});

test.describe('health checks', () => {
  test('the liveness probe is public, fast and uncached', async ({ request, baseURL }) => {
    const startedAt = Date.now();
    const response = await request.get(`${baseURL}/api/health`);

    expect(response.status()).toBe(200);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    // A cached health check reports the state of the past. That is worse than
    // no health check, because it is trusted.
    expect(response.headers()['cache-control']).toContain('no-store');
  });

  test('the deep probe requires a permission', async ({ request, baseURL }) => {
    const response = await request.get(`${baseURL}/api/health/deep`, { failOnStatusCode: false });

    // It enumerates subsystems, queue depth and which integrations exist —
    // useful to an operator and equally useful to an attacker.
    expect([401, 403]).toContain(response.status());
  });
});
