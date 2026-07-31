/**
 * No-op stand-in for `server-only` under Vitest.
 *
 * The real package ships a browser build that throws on import, which is exactly
 * what it is for — but the jsdom test environment resolves to that build and so
 * no server module can be unit tested at all. Stubbing it lets the pure functions
 * inside a service be tested directly; the real guard still applies to every
 * build the browser actually receives.
 */
export {};
