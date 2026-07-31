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
      'https://js.stripe.com',
    ],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': [
      "'self'",
      'data:',
      'blob:',
      'https://res.cloudinary.com',
      'https://www.google-analytics.com',
      'https://c.clarity.ms',
      // Payment Element renders card-brand and wallet marks from Stripe's CDN.
      'https://*.stripe.com',
    ],
    'font-src': ["'self'", 'data:'],
    'connect-src': [
      "'self'",
      // Fast Refresh talks to the dev server over a websocket.
      ...(isDevelopment ? ['ws:', 'wss:'] : []),
      'https://www.google-analytics.com',
      'https://analytics.google.com',
      'https://*.clarity.ms',
      'https://api.stripe.com',
      // Stripe.js posts fraud signals here. Without it the Payment Element still
      // renders, but Radar loses the device fingerprint it scores on — a silent
      // downgrade that only shows up as a worse fraud rate months later.
      'https://m.stripe.network',
      'https://maps.googleapis.com',
    ],
    'frame-src': [
      "'self'",
      'https://js.stripe.com',
      'https://hooks.stripe.com',
      // The hidden iframe Stripe uses for fraud detection and for 3DS challenges.
      'https://m.stripe.network',
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
  ];
}
