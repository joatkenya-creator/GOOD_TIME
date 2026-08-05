/**
 * Placeholder Klarna credentials, for scripts that stub the HTTP transport.
 *
 * ## Why this module exists rather than a line in the script
 *
 * `integrations.klarna` is computed when `@/lib/env` is first imported, and the
 * Klarna client refuses to build a request at all when it is false — the check
 * happens *before* `fetch`, deliberately, so an unconfigured deployment reports
 * "Klarna is not configured" instead of retrying three times and blaming Klarna
 * for being down.
 *
 * That is correct in production and inconvenient here: a script that stubs
 * `fetch` never gets the chance, because it fails one layer above. ES module
 * imports are hoisted and run in declaration order, so the assignment cannot
 * live in the script body — by then the service graph has already loaded `env`.
 * A module imported *before* those services is the only place it can go.
 *
 * ## These are not secrets and must never be real
 *
 * Every request they would authenticate is intercepted by the caller's stub. If
 * a request ever escapes to the network with these, it fails with a 401 against
 * the playground and nothing happens — which is the correct blast radius for a
 * mistake in a test harness.
 */

/** Only ever fills a gap. A real `.env` value wins, so nothing is overridden. */
function fallback(key: string, value: string): void {
  if (!process.env[key]) process.env[key] = value;
}

fallback('KLARNA_USERNAME', 'PK00000_test-harness');
fallback('KLARNA_PASSWORD', 'test-harness-password');
fallback('KLARNA_REGION', 'na');
fallback('KLARNA_ENVIRONMENT', 'playground');
// 64 hex characters: the schema requires at least 32.
fallback('KLARNA_WEBHOOK_SECRET', '0'.repeat(64));
