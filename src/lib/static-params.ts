/**
 * `generateStaticParams` for database-backed routes.
 *
 * CI and Cloudflare Workers Builds both build without `DATABASE_URL` — see the
 * build step in `.github/workflows/deploy.yml`, which passes no database
 * credentials at all. Every slug query is then an ECONNREFUSED that fails the
 * entire build, which is a strange way for a catalogue page to say "no data".
 *
 * With no database reachable, prerender nothing. These routes all leave
 * `dynamicParams` at its default of `true`, so each page is generated on first
 * request and cached from there — the same output, paid for on the first hit
 * instead of at build.
 *
 * Give the build a `DATABASE_URL` and prerendering happens exactly as before.
 * This is a fallback, not a change of strategy.
 */
export async function prerenderParams<T>(load: () => Promise<T[]>): Promise<T[]> {
  if (!process.env.DATABASE_URL) return [];

  return load();
}
