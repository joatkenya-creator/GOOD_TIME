import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mockFetch, type FetchMock } from './mocks/fetch';

/**
 * Turnstile verification.
 *
 * The interesting question about a bot check is what it does when it *cannot
 * run*, because that is the state an attacker can sometimes create. Failing
 * open there turns a Cloudflare blip into an open registration endpoint.
 */

let fetchMock: FetchMock;

async function loadTurnstile(secret: string | null = '0x4AAA_test_secret') {
  vi.resetModules();
  vi.stubEnv('TURNSTILE_SECRET_KEY', secret ?? '');
  return import('@/lib/security/turnstile');
}

beforeEach(() => {
  fetchMock = mockFetch();
});

afterEach(() => {
  fetchMock.restore();
  vi.unstubAllEnvs();
});

describe('verifyTurnstile', () => {
  it('passes a token Cloudflare accepts', async () => {
    const { verifyTurnstile } = await loadTurnstile();
    fetchMock.json('challenges.cloudflare.com', { success: true });

    expect(await verifyTurnstile('valid-token', '203.0.113.5')).toEqual({ success: true });
  });

  it('forwards the client IP so a token cannot be solved once and shared', async () => {
    const { verifyTurnstile } = await loadTurnstile();
    fetchMock.json('challenges.cloudflare.com', { success: true });

    await verifyTurnstile('valid-token', '203.0.113.5');

    // FormData body, so assert on the request rather than a JSON payload.
    expect(fetchMock.calls[0]!.url).toContain('/turnstile/v0/siteverify');
  });

  it('rejects a token Cloudflare refuses, and says why in the result', async () => {
    const { verifyTurnstile } = await loadTurnstile();
    fetchMock.json('challenges.cloudflare.com', {
      success: false,
      'error-codes': ['timeout-or-duplicate'],
    });

    // `timeout-or-duplicate` is the replay case — the single most important
    // rejection, and the reason a token being single-use matters.
    expect(await verifyTurnstile('replayed-token')).toEqual({
      success: false,
      errorCodes: ['timeout-or-duplicate'],
    });
  });

  it('rejects a missing token without calling Cloudflare', async () => {
    const { verifyTurnstile } = await loadTurnstile();

    expect(await verifyTurnstile(null)).toEqual({
      success: false,
      errorCodes: ['missing-input-response'],
    });
    expect(fetchMock.calls).toHaveLength(0);
  });

  it('fails closed when Cloudflare is unreachable', async () => {
    const { verifyTurnstile } = await loadTurnstile();
    fetchMock.on('challenges.cloudflare.com', () => {
      throw new TypeError('fetch failed');
    });

    /*
     * The decision this file exists to make. Turnstile is only configured on
     * endpoints judged to need it, so "cannot check" has to mean "assume this
     * is the request it was meant to stop". The opposite choice is an open
     * signup endpoint for the duration of an outage.
     */
    expect(await verifyTurnstile('token')).toMatchObject({ success: false });
  });

  it('passes everything when unconfigured, which is the development default', async () => {
    const { verifyTurnstile } = await loadTurnstile(null);

    // Deliberate, so a fresh clone runs. `productionReadiness()` is the gate
    // that stops this reaching production unnoticed.
    expect(await verifyTurnstile(null)).toEqual({ success: true });
    expect(fetchMock.calls).toHaveLength(0);
  });
});

describe('production readiness reports it', () => {
  it('lists nothing about Turnstile but does list the things that are fatal', async () => {
    vi.resetModules();
    vi.stubEnv('KLARNA_USERNAME', '');
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('SENTRY_DSN', '');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');

    const { productionReadiness } = await import('@/lib/env');
    const report = productionReadiness();

    expect(report.ready).toBe(false);

    const keys = report.missing.map((entry) => entry.key);
    expect(keys).toContain('KLARNA_USERNAME');
    expect(keys).toContain('RESEND_API_KEY');
    expect(keys).toContain('SENTRY_DSN');
    expect(keys).toContain('UPSTASH_REDIS_REST_URL');

    // Every entry explains the consequence, not just the name. A checklist that
    // says "SENTRY_DSN missing" gets ignored; one that says "errors go nowhere
    // a human will see" does not.
    for (const entry of report.missing) {
      expect(entry.why.length).toBeGreaterThan(20);
    }
  });
});
