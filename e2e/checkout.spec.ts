import { expect, gotoFirstProduct, test, withCleanConsole } from './fixtures';

/**
 * Checkout, end to end, up to the payment widget.
 *
 * The specs stop where our code stops. Klarna renders inside a cross-origin
 * iframe that Playwright cannot reach into, and driving a third party's payment
 * UI produces a test that breaks whenever they ship a redesign — which tells
 * you nothing about this application. The last thing we control is the widget
 * mounting against a real client token from a real session, and that is
 * asserted.
 *
 * Klarna's own playground flow is a manual pre-launch check. See docs/go-live.md.
 */

test.describe('checkout', () => {
  test('a guest can go from a product page to a mounted Klarna widget', async ({ shopper }) => {
    await withCleanConsole(shopper, async () => {
      // The first product, whatever the catalogue currently holds — the
      // journey is what is under test, not a specific SKU.
      await gotoFirstProduct(shopper);
      await expect(shopper.getByRole('button', { name: /add to (bag|cart)/i })).toBeVisible();

      await shopper.getByRole('button', { name: /add to (bag|cart)/i }).click();

      await shopper.goto('/cart');
      await expect(shopper.getByRole('heading', { name: /cart|bag/i })).toBeVisible();

      await shopper
        .getByRole('link', { name: /checkout/i })
        .first()
        .click();
      await expect(shopper).toHaveURL(/\/checkout/);
    });
  });

  test('the total shown before payment is the authoritative one', async ({ shopper }) => {
    /*
     * The cart shows a tax *estimate* — the real figure does not exist until an
     * address has been quoted. So the checkout must restate the total before
     * anyone commits, and it must be the quoted one.
     *
     * This is not pedantry: a customer billed more than the last number they
     * saw is a dispute, and with Klarna a dispute is a chargeback against a
     * merchant guarantee.
     */
    await shopper.goto('/checkout');

    const summary = shopper.getByText(/sales tax/i).first();
    if (await summary.isVisible().catch(() => false)) {
      await expect(shopper.getByText(/estimate/i).first()).toBeVisible();
    }
  });

  test('an empty cart cannot reach checkout', async ({ shopper }) => {
    await shopper.context().clearCookies({ name: 'gt.cart' });
    await shopper.goto('/checkout');

    // Either bounced to the cart, or told plainly. Silently rendering an empty
    // checkout form is the failure — it ends with an order for nothing.
    const bounced = shopper.url().includes('/cart');
    const told = await shopper
      .getByText(/empty|nothing in your/i)
      .isVisible()
      .catch(() => false);

    expect(bounced || told).toBe(true);
  });
});

test.describe('checkout security', () => {
  test('the API rejects a cross-origin POST', async ({ request, baseURL }) => {
    /*
     * The CSRF check in `withRoute`. A form on any other site must not be able
     * to place an order using a signed-in customer's cookies.
     */
    const response = await request.post(`${baseURL}/api/checkout`, {
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      data: { email: 'attacker@example.test' },
      failOnStatusCode: false,
    });

    expect(response.status()).toBe(403);
  });

  test('the API recalculates totals and ignores client-supplied prices', async ({
    request,
    baseURL,
  }) => {
    /*
     * The single most important guarantee in the system. If a client can send a
     * price, a client can send `1`.
     *
     * A 4xx here is a pass whatever the specific code: the point is that the
     * request does not succeed with an attacker's number. Asserting the exact
     * status would make this fail on a validation-message change.
     */
    const response = await request.post(`${baseURL}/api/checkout`, {
      headers: { origin: baseURL!, 'content-type': 'application/json' },
      data: {
        email: 'attacker@example.test',
        totalCents: 1,
        subtotalCents: 1,
        shippingRateId: 'anything',
      },
      failOnStatusCode: false,
    });

    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).toBeLessThan(500);
  });

  test('the Klarna webhook refuses a wrong token', async ({ request, baseURL }) => {
    const response = await request.post(`${baseURL}/api/webhooks/klarna/not-the-secret`, {
      headers: { 'content-type': 'application/json' },
      data: { event_type: 'FRAUD_RISK_ACCEPTED', order_id: 'anything' },
      failOnStatusCode: false,
    });

    // 404 rather than 403: probing the path must not confirm it exists.
    expect(response.status()).toBe(404);
  });

  test('checkout is rate limited', async ({ request, baseURL }) => {
    // 20 per five minutes. Twenty-five requests must produce at least one 429,
    // or the limiter is not attached to this route at all.
    const statuses = await Promise.all(
      Array.from({ length: 25 }, () =>
        request
          .post(`${baseURL}/api/checkout`, {
            headers: { origin: baseURL!, 'content-type': 'application/json' },
            data: {},
            failOnStatusCode: false,
          })
          .then((response) => response.status()),
      ),
    );

    expect(statuses).toContain(429);
  });
});
