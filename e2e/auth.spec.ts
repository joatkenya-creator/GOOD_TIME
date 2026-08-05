import { CUSTOMER, expect, signIn, test, withCleanConsole } from './fixtures';

/**
 * Authentication and authorisation.
 *
 * The specs that matter here are not "can a user sign in" — that breaks loudly.
 * They are the quiet ones: whether a failed sign-in reveals which accounts
 * exist, whether the admin area is reachable by guessing its URL, whether the
 * session survives a reload.
 */

test.describe('sign in', () => {
  /*
   * Its own client address, like the setup project and the lockout test below.
   *
   * These tests sign in for real — that is the point of them — and parallel
   * workers made those attempts land in the same per-IP bucket within seconds.
   * The limiter then refused a genuine sign-in and the failure looked like a
   * broken sign-in page rather than a test suite exceeding its own limit.
   */
  test.use({ extraHTTPHeaders: { 'cf-connecting-ip': '203.0.113.20' } });

  test('a seeded customer can sign in and reach their account', async ({ shopper }) => {
    await withCleanConsole(shopper, async () => {
      await signIn(shopper, CUSTOMER);
      await shopper.goto('/account');

      await expect(shopper.getByRole('heading', { level: 1 })).toBeVisible();
    });
  });

  test('the session survives a reload', async ({ shopper }) => {
    await signIn(shopper, CUSTOMER);

    await shopper.goto('/account');
    await shopper.reload();

    // A session cookie without `Secure`/`SameSite` set correctly, or one scoped
    // to the wrong path, survives the redirect and dies on the reload.
    expect(shopper.url()).toContain('/account');
  });

  test('a wrong password does not reveal whether the account exists', async ({ shopper }) => {
    await shopper.goto('/sign-in');

    await expect(shopper.getByRole('button', { name: /sign in/i })).toBeEnabled();
    await shopper.locator('input[name="email"]').fill(CUSTOMER.email);
    await shopper.locator('input[name="password"]').fill('definitely-not-the-password');
    await shopper.getByRole('button', { name: /sign in/i }).click();

    const realAccount = await shopper.getByRole('alert').first().textContent();

    await shopper.goto('/sign-in');
    await expect(shopper.getByRole('button', { name: /sign in/i })).toBeEnabled();
    await shopper.locator('input[name="email"]').fill('nobody-here@example.test');
    await shopper.locator('input[name="password"]').fill('definitely-not-the-password');
    await shopper.getByRole('button', { name: /sign in/i }).click();

    const noAccount = await shopper.getByRole('alert').first().textContent();

    /*
     * Identical messages, or the sign-in form is an account enumeration oracle:
     * "no such user" versus "wrong password" lets anyone confirm whether an
     * email address shops here. For this shop that is not a theoretical privacy
     * concern — it is disclosing something about a person.
     */
    expect(noAccount?.trim()).toBe(realAccount?.trim());
  });

  /*
   * Its own simulated client address.
   *
   * The limiter buckets by `CF-Connecting-IP`, and every test in this suite
   * otherwise shares one bucket — so these twelve deliberate failures consumed
   * the allowance of the genuine sign-in tests, which then failed with a
   * navigation timeout that looked like a broken sign-in page. Giving this test
   * its own address is both realistic (it is the header Cloudflare sets) and
   * the only way the suite stays order-independent.
   */
  test.describe('rate limiting', () => {
    // Scoped to this block alone: applied to the whole `sign in` describe it
    // would move the genuine sign-in tests onto the same throwaway address.
    test.use({ extraHTTPHeaders: { 'cf-connecting-ip': '203.0.113.99' } });

    test('repeated failures are rate limited', async ({ shopper }) => {
      // Ten per five minutes per IP. Twelve attempts must produce a lockout
      // message, or credential stuffing is unimpeded.
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await shopper.goto('/sign-in');
        await expect(shopper.getByRole('button', { name: /sign in/i })).toBeEnabled();
        await shopper.locator('input[name="email"]').fill(`probe${attempt}@example.test`);
        await shopper.locator('input[name="password"]').fill('wrong');
        await shopper.getByRole('button', { name: /sign in/i }).click();
        await shopper
          .getByRole('alert')
          .first()
          .waitFor({ timeout: 10_000 })
          .catch(() => undefined);
      }

      await expect(shopper.getByText(/too many/i).first()).toBeVisible({ timeout: 10_000 });
    });
  });
});

test.describe('authorisation', () => {
  // Separate again: this block signs in too, and must not spend the budget of
  // the block above.
  test.use({ extraHTTPHeaders: { 'cf-connecting-ip': '203.0.113.30' } });

  test('the admin area is not reachable by guessing the URL', async ({ shopper }) => {
    await shopper.goto('/admin');

    // Bounced to sign-in, or rendered as not-found. Never the dashboard.
    expect(shopper.url()).not.toMatch(/\/admin\/?$/);
  });

  test('the admin API answers in JSON, not with an HTML redirect', async ({ request, baseURL }) => {
    /*
     * Redirecting an API call to a sign-in page hands an HTML document to
     * something expecting JSON. The caller sees a parse error rather than "you
     * are not signed in", which is the least useful possible way to say no.
     */
    const response = await request.get(`${baseURL}/api/admin/products`, {
      failOnStatusCode: false,
      maxRedirects: 0,
    });

    expect([401, 403]).toContain(response.status());
    expect(response.headers()['content-type']).toContain('json');
  });

  test('a signed-in customer cannot reach admin endpoints', async ({ shopper, baseURL }) => {
    await signIn(shopper, CUSTOMER);

    const response = await shopper.request.get(`${baseURL}/api/admin/products`, {
      failOnStatusCode: false,
    });

    // Authenticated is not authorised. This is the check the edge proxy makes
    // and that every admin route re-makes against the database.
    expect(response.status()).toBe(403);
  });
});

test.describe('security headers', () => {
  test('every response carries the hardening headers', async ({ shopper }) => {
    const response = await shopper.goto('/');
    const headers = response!.headers();

    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    // Discreet-shipping category: the referrer must never reach a third party.
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['permissions-policy']).toContain('camera=()');
  });

  test('the CSP allows Klarna, or checkout silently cannot load', async ({ shopper }) => {
    const response = await shopper.goto('/');
    const csp = response!.headers()['content-security-policy'] ?? '';

    // Removing these does not "tighten" anything. It breaks payment entirely,
    // and it breaks it as a blank iframe with a console error nobody reads.
    expect(csp).toContain('x.klarnacdn.net');
    expect(csp).toContain('*.klarna.com');
  });
});
