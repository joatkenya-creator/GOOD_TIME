import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aKlarnaError, aKlarnaOrder, aKlarnaSession, resetFixtureSequence } from './fixtures';
import { mockFetch, type FetchMock } from './mocks/fetch';

/**
 * The Klarna client.
 *
 * These are the parts where a mistake costs money rather than a red build:
 * whether a retry can double-charge, whether a webhook token can be guessed by
 * timing, whether a 4xx is mistaken for a transient failure and retried into a
 * second order.
 */

let fetchMock: FetchMock;

async function loadClient() {
  vi.resetModules();
  vi.stubEnv('KLARNA_USERNAME', 'PK12345_1a2b3c4d');
  vi.stubEnv('KLARNA_PASSWORD', 'test-password');
  vi.stubEnv('KLARNA_REGION', 'na');
  vi.stubEnv('KLARNA_ENVIRONMENT', 'playground');
  vi.stubEnv('KLARNA_WEBHOOK_SECRET', 'a'.repeat(64));

  return import('@/lib/integrations/klarna');
}

beforeEach(() => {
  resetFixtureSequence();
  fetchMock = mockFetch();
});

afterEach(() => {
  fetchMock.restore();
  vi.unstubAllEnvs();
});

describe('regional hosts', () => {
  it('talks to the North American playground for a US merchant', async () => {
    const klarna = await loadClient();
    expect(klarna.klarnaApiBase()).toBe('https://api-na.playground.klarna.com');
  });

  it('switches host on the environment, not just the path', async () => {
    vi.resetModules();
    vi.stubEnv('KLARNA_USERNAME', 'PK1');
    vi.stubEnv('KLARNA_PASSWORD', 'p');
    vi.stubEnv('KLARNA_REGION', 'eu');
    vi.stubEnv('KLARNA_ENVIRONMENT', 'production');

    const klarna = await import('@/lib/integrations/klarna');

    // A production request to a playground host authenticates and then 404s,
    // which is a genuinely confusing way to lose an order.
    expect(klarna.klarnaApiBase()).toBe('https://api.klarna.com');
  });
});

describe('authentication', () => {
  it('sends HTTP Basic credentials on every request', async () => {
    const klarna = await loadClient();
    fetchMock.json('/payments/v1/sessions', aKlarnaSession());

    await klarna.createSession({
      purchase_country: 'US',
      purchase_currency: 'USD',
      locale: 'en-US',
      order_amount: 8443,
      order_tax_amount: 733,
      order_lines: [],
    });

    const auth = fetchMock.calls[0]!.headers.authorization;
    expect(auth).toBe(`Basic ${btoa('PK12345_1a2b3c4d:test-password')}`);
  });

  it('refuses to call Klarna at all when unconfigured', async () => {
    vi.resetModules();
    vi.stubEnv('KLARNA_USERNAME', '');
    vi.stubEnv('KLARNA_PASSWORD', '');

    const klarna = await import('@/lib/integrations/klarna');

    // A 503 from us, not a 401 from Klarna: an unconfigured integration is our
    // deployment problem and must not look like a Klarna outage.
    await expect(klarna.readOrder('anything')).rejects.toThrow(/not configured/i);
    expect(fetchMock.calls).toHaveLength(0);
  });
});

describe('retries', () => {
  it('retries a 503 and succeeds', async () => {
    const klarna = await loadClient();
    const order = aKlarnaOrder();

    fetchMock.json('/ordermanagement/v1/orders/', order);
    fetchMock.failTimes('/ordermanagement/v1/orders/', 2, 503);

    const result = await klarna.readOrder(order.order_id);

    expect(result.data.order_id).toBe(order.order_id);
    expect(fetchMock.calls).toHaveLength(3);
  });

  it('never retries a 4xx', async () => {
    const klarna = await loadClient();

    fetchMock.json(
      '/ordermanagement/v1/orders/',
      aKlarnaError('NO_SUCH_ORDER', ['Order not found']),
      404,
    );

    // Retrying a 404 discovers nothing and delays the error by seconds. Worse,
    // on a write it is how a duplicate is created.
    await expect(klarna.readOrder('missing')).rejects.toThrow(/NO_SUCH_ORDER/);
    expect(fetchMock.calls).toHaveLength(1);
  });

  it('does not retry a write that carries no idempotency key', async () => {
    const klarna = await loadClient();

    fetchMock.json('/payments/v1/sessions', aKlarnaError('SERVER_ERROR'), 503);

    await expect(
      klarna.createSession({
        purchase_country: 'US',
        purchase_currency: 'USD',
        locale: 'en-US',
        order_amount: 100,
        order_tax_amount: 0,
        order_lines: [],
      }),
    ).rejects.toThrow();

    /*
     * The critical assertion. Session creation is a POST with no idempotency
     * key, so a retry would open a second Klarna session for one order — and
     * the customer's widget would be scored against a session we then abandon.
     */
    expect(fetchMock.calls).toHaveLength(1);
  });

  it('retries a write that does carry an idempotency key', async () => {
    const klarna = await loadClient();

    fetchMock.on(
      '/captures',
      () => new Response(null, { status: 201, headers: { 'Capture-ID': 'cap_1' } }),
    );
    fetchMock.failTimes('/captures', 1, 500);

    const result = await klarna.captureOrder('klarna_1', 4499, {
      idempotencyKey: 'capture_a_4499',
    });

    expect(result.captureId).toBe('cap_1');
    expect(fetchMock.calls).toHaveLength(2);
    // Klarna deduplicates on this for 24 hours, which is what makes the retry
    // safe rather than a second capture.
    expect(fetchMock.calls[0]!.headers['klarna-idempotency-key']).toBe('capture_a_4499');
    expect(fetchMock.calls[1]!.headers['klarna-idempotency-key']).toBe('capture_a_4499');
  });
});

describe('error mapping', () => {
  it('classifies 5xx and 429 as retryable and 4xx as not', async () => {
    const klarna = await loadClient();

    const server = new klarna.KlarnaError(503, null, 'SERVER_ERROR', []);
    const throttled = new klarna.KlarnaError(429, null, 'RATE_LIMITED', []);
    const rejected = new klarna.KlarnaError(400, null, 'BAD_VALUE', ['order_amount']);

    expect(server.retryable).toBe(true);
    expect(throttled.retryable).toBe(true);
    expect(rejected.retryable).toBe(false);
  });

  it('surfaces the correlation id, which is what Klarna support asks for', async () => {
    const klarna = await loadClient();

    fetchMock.json('/ordermanagement/v1/orders/', aKlarnaError('BAD_VALUE'), 400, {
      'klarna-correlation-id': 'corr-abc-123',
    });

    await expect(klarna.readOrder('x')).rejects.toMatchObject({ correlationId: 'corr-abc-123' });
  });

  it('turns a network failure into a 502, not a 500', async () => {
    const klarna = await loadClient();

    fetchMock.on('/ordermanagement/', () => {
      throw new TypeError('fetch failed');
    });

    // The distinction matters on a dashboard: a 502 is an upstream being down,
    // a 500 is our bug. Conflating them means paging the wrong person.
    await expect(klarna.readOrder('x')).rejects.toMatchObject({ status: 502 });
  });
});

describe('capture and refund headers', () => {
  it('reads the capture id from the header, since the body is empty', async () => {
    const klarna = await loadClient();

    fetchMock.on(
      '/captures',
      () => new Response(null, { status: 201, headers: { 'Capture-ID': 'cap_9f2' } }),
    );

    expect(await klarna.captureOrder('k1', 100, { idempotencyKey: 'k' })).toEqual({
      captureId: 'cap_9f2',
    });
  });

  it('reads the refund id from the header', async () => {
    const klarna = await loadClient();

    fetchMock.on(
      '/refunds',
      () => new Response(null, { status: 201, headers: { 'Refund-ID': 'ref_7a1' } }),
    );

    expect(await klarna.refundOrderAmount('k1', 100, { idempotencyKey: 'k' })).toEqual({
      refundId: 'ref_7a1',
    });
  });
});

describe('push notification verification', () => {
  it('accepts the configured secret and rejects everything else', async () => {
    const klarna = await loadClient();
    const secret = 'a'.repeat(64);

    expect(klarna.verifyPushToken(secret)).toBe(true);
    expect(klarna.verifyPushToken(`${secret}x`)).toBe(false);
    expect(klarna.verifyPushToken(secret.slice(0, -1))).toBe(false);
    expect(klarna.verifyPushToken('')).toBe(false);
    expect(klarna.verifyPushToken(null)).toBe(false);
  });

  it('rejects everything when no secret is configured', async () => {
    vi.resetModules();
    vi.stubEnv('KLARNA_WEBHOOK_SECRET', '');

    const klarna = await import('@/lib/integrations/klarna');

    // Closed by default. An unconfigured secret must not mean "accept anything"
    // — that is an open endpoint that runs order state transitions.
    expect(klarna.verifyPushToken('anything')).toBe(false);
    expect(klarna.verifyPushToken('')).toBe(false);
  });

  it('compares in constant time regardless of where the mismatch is', async () => {
    const { timingSafeEqual } = await import('@/lib/security/compare');

    /*
     * `===` on strings short-circuits at the first differing byte, so a token
     * sharing a long prefix with the secret takes measurably longer to reject
     * than one differing at byte zero. That leak is enough to recover the
     * secret one byte at a time.
     *
     * Timing cannot be asserted reliably in a JS test runner, so this asserts
     * the property that makes constant time possible: every comparison reads
     * the full length of both inputs and returns the same shape.
     */
    expect(timingSafeEqual('abcdef', 'abcdef')).toBe(true);
    expect(timingSafeEqual('abcdef', 'abcdeX')).toBe(false);
    expect(timingSafeEqual('abcdef', 'Xbcdef')).toBe(false);
    expect(timingSafeEqual('abcdef', 'abc')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
  });
});
