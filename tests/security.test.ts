import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { escapeJsonLd, normalizeText, safeRedirectPath, safeUrl } from '@/lib/security/sanitize';
import { clientIdentifier, rateLimit, rateLimitHeaders } from '@/lib/security/rate-limit';
import { securityHeaders } from '@/lib/security/headers';

import { isSameOrigin } from '@/lib/security/csrf';

describe('safeUrl', () => {
  it('accepts the protocols we render in hrefs', () => {
    expect(safeUrl('https://example.com/x')).toBe('https://example.com/x');
    expect(safeUrl('mailto:hi@example.com')).toBe('mailto:hi@example.com');
  });

  it('rejects scheme-based injection', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html;base64,PHNjcmlwdD4=')).toBeNull();
  });

  it('allows site-relative paths but not protocol-relative ones', () => {
    expect(safeUrl('/shop')).toBe('/shop');
    expect(safeUrl('//evil.example.com')).toBeNull();
  });
});

describe('safeRedirectPath', () => {
  it('falls back for anything that could leave the site', () => {
    expect(safeRedirectPath('/account/orders')).toBe('/account/orders');
    expect(safeRedirectPath('https://evil.example.com')).toBe('/');
    expect(safeRedirectPath('//evil.example.com')).toBe('/');
    expect(safeRedirectPath(null, '/shop')).toBe('/shop');
  });
});

describe('escapeJsonLd', () => {
  it('prevents a product name from closing the script tag', () => {
    const output = escapeJsonLd({ name: '</script><script>alert(1)</script>' });
    expect(output).not.toContain('</script>');
    expect(output).toContain('\\u003c');
  });
});

describe('normalizeText', () => {
  it('collapses whitespace without gluing words together', () => {
    expect(normalizeText('  hello \n\t world  ')).toBe('hello world');
  });
});

describe('securityHeaders', () => {
  const headerValue = (key: string) => securityHeaders().find((entry) => entry.key === key)?.value;

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('in development', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');
    });

    it('omits upgrade-insecure-requests', () => {
      // It rewrites http://localhost fetches as https:// and every one fails.
      expect(headerValue('Content-Security-Policy')).not.toContain('upgrade-insecure-requests');
    });

    it('allows the Fast Refresh websocket', () => {
      expect(headerValue('Content-Security-Policy')).toMatch(/connect-src[^;]*\bws:/);
    });

    it('omits HSTS', () => {
      expect(headerValue('Strict-Transport-Security')).toBeUndefined();
    });
  });

  /**
   * `next start` is production mode over plain http. Emitting the HTTPS-only
   * directives there makes WebKit upgrade every asset URL to https, fail every
   * request, and render the page with no CSS at all — verified in WebKit.
   */
  describe('in a production build served over http', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3100');
    });

    it('omits upgrade-insecure-requests', () => {
      expect(headerValue('Content-Security-Policy')).not.toContain('upgrade-insecure-requests');
    });

    it('omits HSTS', () => {
      expect(headerValue('Strict-Transport-Security')).toBeUndefined();
    });

    it('still hardens everything that does not depend on the scheme', () => {
      expect(headerValue('Content-Security-Policy')).toContain("frame-ancestors 'none'");
      expect(headerValue('X-Content-Type-Options')).toBe('nosniff');
    });
  });

  describe('in production', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://intimatebunnie.example');
    });

    it('upgrades insecure requests', () => {
      expect(headerValue('Content-Security-Policy')).toContain('upgrade-insecure-requests');
    });

    it('does not permit eval', () => {
      expect(headerValue('Content-Security-Policy')).not.toContain("'unsafe-eval'");
    });

    it('does not permit websockets', () => {
      expect(headerValue('Content-Security-Policy')).not.toMatch(/connect-src[^;]*\bws:/);
    });

    it('sends HSTS and the rest of the baseline', () => {
      expect(headerValue('Strict-Transport-Security')).toContain('max-age=');
      expect(headerValue('X-Content-Type-Options')).toBe('nosniff');
      expect(headerValue('X-Frame-Options')).toBe('DENY');
    });
  });

  it('never allows framing, in either environment', () => {
    for (const mode of ['development', 'production']) {
      vi.stubEnv('NODE_ENV', mode);
      expect(headerValue('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    }
  });
});

describe('rateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /*
   * These exercise the in-process fallback, which is what runs when Upstash is
   * unconfigured — the case in the test environment and on a fresh clone. The
   * shared sliding-window path is Upstash's own Lua script and is covered by
   * the integration suite against a real Redis; re-implementing an HTTP mock
   * for it here would assert that the mock behaves like the mock.
   */
  it('allows up to the limit, then blocks', async () => {
    const key = `test:${Math.random()}`;
    const options = { limit: 3, windowSeconds: 60 };

    expect((await rateLimit(key, options)).success).toBe(true);
    expect((await rateLimit(key, options)).success).toBe(true);
    const third = await rateLimit(key, options);
    expect(third.success).toBe(true);
    expect(third.remaining).toBe(0);
    expect((await rateLimit(key, options)).success).toBe(false);
  });

  it('resets once the window elapses', async () => {
    const key = `test:${Math.random()}`;
    const options = { limit: 1, windowSeconds: 60 };

    expect((await rateLimit(key, options)).success).toBe(true);
    expect((await rateLimit(key, options)).success).toBe(false);

    vi.advanceTimersByTime(61_000);
    expect((await rateLimit(key, options)).success).toBe(true);
  });

  it('keeps separate buckets independent', async () => {
    const options = { limit: 1, windowSeconds: 60 };
    expect((await rateLimit('bucket-a', options)).success).toBe(true);
    expect((await rateLimit('bucket-b', options)).success).toBe(true);
  });

  it('emits Retry-After only when the request was actually blocked', () => {
    const allowed = rateLimitHeaders({
      success: true,
      limit: 10,
      remaining: 9,
      reset: Date.now() + 30_000,
    });
    const blocked = rateLimitHeaders({
      success: false,
      limit: 10,
      remaining: 0,
      reset: Date.now() + 30_000,
    });

    // A client that sees Retry-After on a 200 backs off for no reason.
    expect(allowed['Retry-After']).toBeUndefined();
    expect(Number(blocked['Retry-After'])).toBeGreaterThan(0);
  });
});

describe('clientIdentifier', () => {
  /*
   * The whole point of this function: `x-forwarded-for` is a header anyone can
   * send, and a limiter that trusts it is bypassed by adding one line to a
   * request. `CF-Connecting-IP` is set by Cloudflare from the TCP peer.
   */
  it('prefers CF-Connecting-IP over a forged x-forwarded-for', () => {
    const request = new Request('https://example.test', {
      headers: {
        'cf-connecting-ip': '203.0.113.5',
        'x-forwarded-for': '10.0.0.1, 203.0.113.9',
      },
    });

    expect(clientIdentifier(request)).toBe('203.0.113.5');
  });

  it('falls back to the first x-forwarded-for entry, never the last', () => {
    // The last entry is whatever the client appended. The first is what the
    // outermost trusted proxy wrote.
    const request = new Request('https://example.test', {
      headers: { 'x-forwarded-for': '198.51.100.7, 10.0.0.1' },
    });

    expect(clientIdentifier(request)).toBe('198.51.100.7');
  });

  it('never returns an empty identifier', () => {
    // An empty key would put every anonymous request in one shared bucket,
    // which is a self-inflicted denial of service.
    expect(clientIdentifier(new Request('https://example.test'))).toBe('unknown');
  });
});

describe('isSameOrigin', () => {
  const SITE = 'http://localhost:3000';

  /** A request as Next hands it over: `url` normalised to the deployment URL. */
  function request(
    method: string,
    headers: Record<string, string>,
    url = `${SITE}/api/cart`,
  ): Request {
    return new Request(url, { method, headers });
  }

  it('lets safe methods through without an Origin', () => {
    expect(isSameOrigin(request('GET', {}))).toBe(true);
    expect(isSameOrigin(request('HEAD', {}))).toBe(true);
  });

  it('accepts a same-origin write', () => {
    expect(isSameOrigin(request('POST', { origin: SITE }))).toBe(true);
  });

  it('rejects a cross-site write', () => {
    expect(isSameOrigin(request('POST', { origin: 'https://evil.example' }))).toBe(false);
  });

  it('rejects a write with no Origin and no Referer', () => {
    // The classic cross-site form post, which sends neither.
    expect(isSameOrigin(request('POST', {}))).toBe(false);
  });

  it('falls back to Referer when Origin is absent', () => {
    expect(isSameOrigin(request('POST', { referer: `${SITE}/cart` }))).toBe(true);
    expect(isSameOrigin(request('POST', { referer: 'https://evil.example/x' }))).toBe(false);
  });

  it('accepts the host the client actually asked for', () => {
    // A preview deployment, or `127.0.0.1` when the config says `localhost`.
    // Next normalises `request.url`, so without the forwarded host this is the
    // case that wrongly 403s a legitimate same-origin request.
    expect(
      isSameOrigin(request('POST', { origin: 'http://127.0.0.1:3000', host: '127.0.0.1:3000' })),
    ).toBe(true);

    expect(
      isSameOrigin(
        request('POST', {
          origin: 'https://preview-abc.vercel.app',
          'x-forwarded-host': 'preview-abc.vercel.app',
          'x-forwarded-proto': 'https',
        }),
      ),
    ).toBe(true);
  });

  it('still rejects a foreign origin even when the host header is present', () => {
    expect(
      isSameOrigin(request('POST', { origin: 'https://evil.example', host: '127.0.0.1:3000' })),
    ).toBe(false);
  });

  it('rejects a malformed Origin', () => {
    expect(isSameOrigin(request('POST', { origin: 'not-a-url' }))).toBe(false);
  });
});
