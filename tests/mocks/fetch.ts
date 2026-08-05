import { vi } from 'vitest';

/**
 * A `fetch` stub that routes by URL pattern.
 *
 * ## Why the transport boundary and not the module boundary
 *
 * Mocking `@/lib/integrations/klarna` would verify that a mock returns what the
 * mock was told to return. Mocking `fetch` leaves the real request builder, the
 * real auth header, the real retry policy, the real error mapping and every
 * database write in the path — only the bytes on the wire are canned. That is
 * the difference between a test that catches a broken idempotency key and one
 * that does not.
 *
 * ## Unmatched requests fail loudly
 *
 * A stub that returns a default 200 for anything unrecognised hides the exact
 * bug worth catching: code reaching a service nobody expected it to reach. An
 * unmatched URL throws, and the message names the URL.
 */

export interface RouteHandler {
  (request: {
    url: string;
    method: string;
    body: unknown;
    headers: Headers;
  }): Response | Promise<Response>;
}

export interface FetchCall {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

export interface FetchMock {
  /** Every intercepted call, in order. Assert on idempotency keys here. */
  calls: FetchCall[];
  /** Registers or replaces a route. Later registrations win. */
  on(pattern: string | RegExp, handler: RouteHandler): FetchMock;
  /** Convenience: respond with JSON and a status. */
  json(
    pattern: string | RegExp,
    body: unknown,
    status?: number,
    headers?: Record<string, string>,
  ): FetchMock;
  /** Convenience: fail `times` times, then fall through to the next handler. */
  failTimes(pattern: string | RegExp, times: number, status?: number): FetchMock;
  restore(): void;
}

export function mockFetch(): FetchMock {
  const routes: { pattern: string | RegExp; handler: RouteHandler }[] = [];
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;

  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers as HeadersInit);

    let body: unknown;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }

    calls.push({ url, method, body, headers: Object.fromEntries(headers) });

    // Last registered wins, so a test can override a shared setup route.
    for (let index = routes.length - 1; index >= 0; index -= 1) {
      const route = routes[index]!;
      const matches =
        typeof route.pattern === 'string' ? url.includes(route.pattern) : route.pattern.test(url);

      if (matches) return route.handler({ url, method, body, headers });
    }

    throw new Error(
      `Unmocked ${method} ${url}. Register it with mockFetch().on(), or the code under test is calling something it should not.`,
    );
  };

  globalThis.fetch = vi.fn(impl) as unknown as typeof fetch;

  const mock: FetchMock = {
    calls,

    on(pattern, handler) {
      routes.push({ pattern, handler });
      return mock;
    },

    json(pattern, body, status = 200, headers = {}) {
      return mock.on(
        pattern,
        () =>
          new Response(body === undefined ? null : JSON.stringify(body), {
            status,
            headers: { 'content-type': 'application/json', ...headers },
          }),
      );
    },

    failTimes(pattern, times, status = 503) {
      let remaining = times;

      return mock.on(pattern, ({ url, method, body, headers }) => {
        if (remaining > 0) {
          remaining -= 1;
          return new Response(JSON.stringify({ error_code: 'SERVER_ERROR', error_messages: [] }), {
            status,
            headers: { 'content-type': 'application/json' },
          });
        }

        // Exhausted: hand the call to whatever was registered before this.
        for (let index = routes.length - 2; index >= 0; index -= 1) {
          const route = routes[index]!;
          const matches =
            typeof route.pattern === 'string'
              ? url.includes(route.pattern)
              : route.pattern.test(url);

          if (matches) return route.handler({ url, method, body, headers });
        }

        throw new Error(`failTimes exhausted with no fallback route for ${url}`);
      });
    },

    restore() {
      globalThis.fetch = original;
    },
  };

  return mock;
}
