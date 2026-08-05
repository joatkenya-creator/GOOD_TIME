/**
 * Security headers applied to every response by `next.config.ts`.
 *
 * Imported by the Next config, so this module must stay free of app imports —
 * no `env`, no React, nothing that pulls in the module graph at config load.
 */

interface HeaderEntry {
  key: string;
  value: string;
}

/**
 * Content Security Policy.
 *
 * `'unsafe-inline'` on script-src is required by Next's inline bootstrap and by
 * GA4/Clarity's snippet loaders. Tightening this to a nonce is tracked in
 * docs/architecture.md; it needs the analytics scripts moved behind a proxy route.
 *
 * Two directives are production-only, and shipping them in development breaks it:
 *
 *   - `upgrade-insecure-requests` rewrites every `http://` request as `https://`.
 *     On `http://localhost:3000` that upgrades same-origin fetches to a port
 *     nothing listens on, and every one of them fails with "Failed to fetch".
 *   - websockets: `connect-src` must allow `ws:` or Fast Refresh cannot connect.
 */
function contentSecurityPolicy(isDevelopment: boolean, upgradeInsecure: boolean): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      "'unsafe-inline'",
      // Turbopack's dev runtime evaluates modules; production bundles never do.
      ...(isDevelopment ? ["'unsafe-eval'"] : []),
      'https://www.googletagmanager.com',
      'https://www.google-analytics.com',
      'https://www.clarity.ms',
      // Klarna's widget loader and the in-widget experience.
      'https://x.klarnacdn.net',
      'https://*.klarna.com',
      'https://*.klarnaservices.com',
      // Turnstile's challenge script.
      'https://challenges.cloudflare.com',
      // Cloudflare Web Analytics: cookieless, first-party beacon.
      'https://static.cloudflareinsights.com',
    ],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': [
      "'self'",
      'data:',
      'blob:',
      'https://res.cloudinary.com',
      'https://www.google-analytics.com',
      'https://c.clarity.ms',
      // Klarna renders its own brand marks and merchant assets.
      'https://x.klarnacdn.net',
      'https://*.klarna.com',
    ],
    'font-src': ["'self'", 'data:'],
    'connect-src': [
      "'self'",
      // Fast Refresh talks to the dev server over a websocket.
      ...(isDevelopment ? ['ws:', 'wss:'] : []),
      'https://www.google-analytics.com',
      'https://analytics.google.com',
      'https://*.clarity.ms',
      // Klarna's widget talks to its own API and posts the device signals it
      // underwrites on. Without these the widget renders and then fails to
      // authorise, which looks like a decline rather than a CSP problem.
      'https://*.klarna.com',
      'https://*.klarnaservices.com',
      'https://*.klarnaevt.com',
      'https://maps.googleapis.com',
      // Cloudflare Web Analytics beacon.
      'https://cloudflareinsights.com',
      // Sentry's browser client posts envelopes to the ingest host in the DSN.
      'https://*.ingest.sentry.io',
      'https://*.ingest.us.sentry.io',
    ],
    'frame-src': [
      "'self'",
      // Every field a customer types a payment detail into lives in one of
      // these iframes. Removing them does not tighten anything — it breaks
      // checkout entirely.
      'https://*.klarna.com',
      'https://*.klarnaservices.com',
      'https://x.klarnacdn.net',
      // Turnstile's interactive challenge.
      'https://challenges.cloudflare.com',
    ],
    'frame-ancestors': ["'none'"],
    'form-action': ["'self'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
    ...(upgradeInsecure ? { 'upgrade-insecure-requests': [] } : {}),
  };

  return Object.entries(directives)
    .map(([directive, values]) => (values.length ? `${directive} ${values.join(' ')}` : directive))
    .join('; ');
}

export function securityHeaders(): HeaderEntry[] {
  // Read directly from the environment: this module is imported by `next.config.ts`
  // and must not pull in the app's module graph.
  const isDevelopment = process.env.NODE_ENV !== 'production';

  /**
   * HSTS and `upgrade-insecure-requests` are gated on the site actually being
   * served over HTTPS, not merely on `NODE_ENV`.
   *
   * `next start` is production mode over plain `http://localhost`, and both
   * directives break it: WebKit honours `upgrade-insecure-requests` on localhost
   * (Chromium exempts it), rewrites every asset URL to `https://`, and loads
   * nothing — the page renders with no CSS or JS at all. Verified in WebKit:
   * every request failed with `SSL connect error`.
   */
  const isHttps = (process.env.NEXT_PUBLIC_SITE_URL ?? '').startsWith('https://');

  return [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(isDevelopment, isHttps) },
    // HSTS is meaningless over http and would pin localhost to https for months
    // if a browser ever did honour it. HTTPS deployments only.
    ...(!isHttps
      ? []
      : [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ]),
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'X-DNS-Prefetch-Control', value: 'on' },
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
    },
    // Discreet-shipping category: never leak the referrer to third parties.
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    /*
     * `credentialless` rather than `require-corp`.
     *
     * `require-corp` would demand a CORP header from Klarna's and Cloudinary's
     * assets, which they do not send, and the whole checkout would fail to
     * load. `credentialless` gets most of the isolation by stripping
     * credentials from cross-origin loads instead of refusing them.
     */
    { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
    /*
     * Cloudflare will not compress a response it cannot see the type of, and it
     * will not cache one whose variance it cannot reason about. Being explicit
     * here is what makes the Brotli and cache rules in docs/cloudflare.md
     * actually apply rather than silently no-op.
     */
    { key: 'Vary', value: 'Accept-Encoding' },
  ];
}
