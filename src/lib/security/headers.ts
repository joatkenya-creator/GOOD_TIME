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
function contentSecurityPolicy(isDevelopment: boolean): string {
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
    ],
    'frame-src': ["'self'", 'https://js.stripe.com', 'https://hooks.stripe.com'],
    'frame-ancestors': ["'none'"],
    'form-action': ["'self'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
    ...(isDevelopment ? {} : { 'upgrade-insecure-requests': [] }),
  };

  return Object.entries(directives)
    .map(([directive, values]) => (values.length ? `${directive} ${values.join(' ')}` : directive))
    .join('; ');
}

export function securityHeaders(): HeaderEntry[] {
  // Read directly from the environment: this module is imported by `next.config.ts`
  // and must not pull in the app's module graph.
  const isDevelopment = process.env.NODE_ENV !== 'production';

  return [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(isDevelopment) },
    // HSTS is meaningless over http and would pin localhost to https for months
    // if a browser ever did honour it. Production only.
    ...(isDevelopment
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
