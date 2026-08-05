import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mockFetch, type FetchMock } from './mocks/fetch';

/**
 * Error reporting.
 *
 * The things worth asserting about a crash reporter are not that it reports —
 * that is one `fetch` — but that it cannot make an outage worse, and that it
 * never carries a session cookie to a third party.
 */

const DSN = 'https://abc123def456@o42.ingest.sentry.io/1337';

let fetchMock: FetchMock;

async function loadSentry(dsn: string | null = DSN) {
  vi.resetModules();
  vi.stubEnv('SENTRY_DSN', dsn ?? '');
  vi.stubEnv('SENTRY_ENVIRONMENT', 'test');
  vi.stubEnv('SENTRY_RELEASE', 'abc1234');

  return import('@/lib/monitoring/sentry');
}

/** The envelope is newline-delimited JSON; the event is the third line. */
function eventFrom(body: unknown): Record<string, unknown> {
  return JSON.parse(String(body).split('\n')[2]!);
}

beforeEach(() => {
  fetchMock = mockFetch();
  fetchMock.on('ingest.sentry.io', () => new Response('{}', { status: 200 }));
});

afterEach(() => {
  fetchMock.restore();
  vi.unstubAllEnvs();
});

describe('DSN handling', () => {
  it('derives the envelope endpoint and the public key', async () => {
    const sentry = await loadSentry();

    expect(sentry.isSentryEnabled()).toBe(true);

    sentry.captureException(new Error('boom'));
    await sentry.flush();

    const call = fetchMock.calls[0]!;
    expect(call.url).toBe('https://o42.ingest.sentry.io/api/1337/envelope/');
    expect(call.headers['x-sentry-auth']).toContain('sentry_key=abc123def456');
  });

  it('is a no-op when no DSN is set', async () => {
    const sentry = await loadSentry(null);

    expect(sentry.isSentryEnabled()).toBe(false);
    expect(sentry.captureException(new Error('boom'))).toBeNull();
    // Not "sends nowhere" — sends *nothing*. A dev machine must not attempt a
    // network call on every caught error.
    expect(fetchMock.calls).toHaveLength(0);
  });

  it('refuses to boot on a DSN that is not a URL at all', async () => {
    // Caught by `env.ts` at import, before a single request is served. A crash
    // at boot with a readable message beats discovering three weeks later that
    // nothing was ever reported.
    await expect(loadSentry('not-a-url')).rejects.toThrow(/SENTRY_DSN/);
  });

  it('treats a URL-shaped DSN with no key or project as disabled', async () => {
    // Passes `z.url()` and is still unusable: no public key, no project id.
    // Degrading to "off" is right here — the alternative is a `fetch` to a
    // nonsense endpoint on every caught error.
    const sentry = await loadSentry('https://sentry.io');

    expect(sentry.isSentryEnabled()).toBe(false);
    expect(sentry.captureException(new Error('boom'))).toBeNull();
    expect(fetchMock.calls).toHaveLength(0);
  });
});

describe('event payload', () => {
  it('carries environment, release and an exception with frames', async () => {
    const sentry = await loadSentry();

    sentry.captureException(new TypeError('cannot read property of undefined'), {
      transaction: 'POST /api/checkout',
      tags: { route: '/api/checkout' },
    });
    await sentry.flush();

    const event = eventFrom(fetchMock.calls[0]!.body);

    expect(event.environment).toBe('test');
    expect(event.release).toBe('abc1234');
    expect(event.transaction).toBe('POST /api/checkout');

    const exception = (event.exception as { values: Record<string, unknown>[] }).values[0]!;
    expect(exception.type).toBe('TypeError');
    expect(exception.value).toBe('cannot read property of undefined');

    // Without frames Sentry groups by message alone, so an error carrying an
    // order id becomes one issue per order.
    const frames = (exception.stacktrace as { frames: unknown[] }).frames;
    expect(frames.length).toBeGreaterThan(0);
  });

  it('accepts a fingerprint so ids in messages do not fragment an issue', async () => {
    const sentry = await loadSentry();

    sentry.captureException(new Error('Order GT-100042 not found'), {
      fingerprint: ['route', 'GET', '/api/orders/[id]'],
    });
    await sentry.flush();

    expect(eventFrom(fetchMock.calls[0]!.body).fingerprint).toEqual([
      'route',
      'GET',
      '/api/orders/[id]',
    ]);
  });

  it('wraps a non-Error throw rather than dropping it', async () => {
    const sentry = await loadSentry();

    sentry.captureException('something went wrong');
    await sentry.flush();

    const exception = (
      eventFrom(fetchMock.calls[0]!.body).exception as { values: Record<string, unknown>[] }
    ).values[0]!;

    expect(exception.value).toBe('something went wrong');
  });
});

describe('what never leaves the building', () => {
  it('sends only allowlisted request headers', async () => {
    const sentry = await loadSentry();

    sentry.captureException(new Error('boom'), {
      request: {
        url: 'https://example.test/account',
        method: 'GET',
        headers: {
          'user-agent': 'Mozilla/5.0',
          cookie: 'authjs.session-token=SECRET_SESSION_VALUE',
          authorization: 'Bearer SECRET_TOKEN',
          'x-api-key': 'SECRET_KEY',
          'cf-ray': '8a1b2c3d4e5f',
        },
      },
    });
    await sentry.flush();

    const raw = String(fetchMock.calls[0]!.body);
    const headers = (eventFrom(raw).request as { headers: Record<string, string> }).headers;

    // An allowlist, not a denylist: a denylist is one new header away from
    // shipping a session cookie to a third party.
    expect(headers).toEqual({ 'user-agent': 'Mozilla/5.0', 'cf-ray': '8a1b2c3d4e5f' });
    expect(raw).not.toContain('SECRET_SESSION_VALUE');
    expect(raw).not.toContain('SECRET_TOKEN');
    expect(raw).not.toContain('SECRET_KEY');
  });
});

describe('failure containment', () => {
  it('does not reject when Sentry itself is down', async () => {
    const sentry = await loadSentry();

    fetchMock.on('ingest.sentry.io', () => {
      throw new TypeError('fetch failed');
    });

    // The one property that matters. An unhandled rejection here would take
    // down the isolate that was merely trying to report a caught error.
    expect(() => sentry.captureException(new Error('boom'))).not.toThrow();
    await expect(sentry.flush()).resolves.toBeUndefined();
  });

  it('flush is bounded, so a hanging Sentry cannot hang a queue consumer', async () => {
    const sentry = await loadSentry();

    // A request that never settles. Without the timeout, `flush` would await it
    // forever and take the queue consumer or the scheduled handler with it.
    fetchMock.on('ingest.sentry.io', () => new Promise<Response>(() => {}));

    sentry.captureException(new Error('boom'));

    const startedAt = Date.now();
    await sentry.flush(100);
    const elapsed = Date.now() - startedAt;

    /*
     * Resolving at all is the assertion; an unbounded flush would hang here
     * until the runner's own timeout killed the suite.
     *
     * The elapsed bound is deliberately loose rather than tight. This measures
     * wall-clock on a machine that may be running a build in another terminal,
     * and a 100ms timer asserted at 1000ms flaked exactly that way. Five
     * seconds still distinguishes "bounded" from "hangs forever", which is the
     * only distinction that matters, and it cannot fail for being busy.
     */
    expect(elapsed).toBeLessThan(5_000);
  });

  it('returns an event id callers can show on an error page', async () => {
    const sentry = await loadSentry();

    const id = sentry.captureException(new Error('boom'));

    // 32 hex characters, no dashes — Sentry's own format, so it is searchable
    // by pasting it straight into the issue search.
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });
});
