import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { escapeJsonLd, normalizeText, safeRedirectPath, safeUrl } from '@/lib/security/sanitize';
import { rateLimit } from '@/lib/security/rate-limit';
import { securityHeaders } from '@/lib/security/headers';

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

  describe('in production', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'production');
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

  it('allows up to the limit, then blocks', () => {
    const key = `test:${Math.random()}`;
    const options = { limit: 3, windowSeconds: 60 };

    expect(rateLimit(key, options).success).toBe(true);
    expect(rateLimit(key, options).success).toBe(true);
    const third = rateLimit(key, options);
    expect(third.success).toBe(true);
    expect(third.remaining).toBe(0);
    expect(rateLimit(key, options).success).toBe(false);
  });

  it('resets once the window elapses', () => {
    const key = `test:${Math.random()}`;
    const options = { limit: 1, windowSeconds: 60 };

    expect(rateLimit(key, options).success).toBe(true);
    expect(rateLimit(key, options).success).toBe(false);

    vi.advanceTimersByTime(61_000);
    expect(rateLimit(key, options).success).toBe(true);
  });

  it('keeps separate buckets independent', () => {
    const options = { limit: 1, windowSeconds: 60 };
    expect(rateLimit('bucket-a', options).success).toBe(true);
    expect(rateLimit('bucket-b', options).success).toBe(true);
  });
});
