import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';

import { ADMIN_ROLES } from '@/constants/permissions';
import {
  ADMIN_PREFIXES,
  GUEST_ONLY_PREFIXES,
  PROTECTED_PREFIXES,
  ROUTES,
} from '@/constants/routes';
import { authConfig } from '@/lib/auth/config';

/**
 * Edge middleware — the first authorisation gate.
 *
 * This runs before any React code, so an unauthenticated request to `/admin`
 * never reaches a server component. It reads the session JWT only: the edge
 * runtime has no database, and a per-request query here would add latency to
 * every navigation on the site.
 *
 * Treat it as a fast filter, not the last line of defence. Pages and route
 * handlers re-check with `requireAdmin` / `assertPermission`, which read the
 * authoritative claim set.
 *
 * ## Why this is `middleware.ts` and not Next 16's `proxy.ts`
 *
 * Do not "modernise" this back. Next 16 renamed the convention to `proxy.ts`
 * and made the **Node** runtime its default, and a Node proxy cannot be
 * expressed as an edge one — `export const config = { runtime: 'edge' }` is
 * rejected outright with "Proxy does not support Edge runtime".
 *
 * The OpenNext Cloudflare adapter requires an edge middleware and exits with
 * "Node.js middleware is not currently supported" when it finds a Node proxy
 * instead. A Cloudflare Worker *is* the edge runtime, so there is nowhere for a
 * Node proxy to run.
 *
 * The legacy `middleware.ts` filename still compiles to an edge entry in
 * `middleware-manifest.json`, which is exactly what the adapter looks for. So
 * the filename is load-bearing until the adapter supports Node proxies.
 *
 * Nothing here wants Node anyway: no database, no filesystem, no `node:`
 * builtin. That constraint predates the rename and is the reason this file is
 * fast.
 */
const { auth: withAuth } = NextAuth(authConfig);

function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export default withAuth((request) => {
  const { pathname, search } = request.nextUrl;
  const session = request.auth;
  const isAuthenticated = Boolean(session?.user);

  // Signed-in visitors have no business on the sign-in or register pages.
  //
  // Unless they arrived with a `callbackUrl`, which only a server-side guard
  // sets. This runs on the edge, where the JWT is all there is: a session
  // revoked from another device still presents a perfectly valid cookie here.
  // Bouncing that visitor back to `/account` puts them in a loop against the
  // guard that just rejected them — page redirects to sign-in, edge redirects
  // to account, forever. The `callbackUrl` is the signal that the database has
  // already said no, and the edge should not overrule it.
  const rejectedByGuard = request.nextUrl.searchParams.has('callbackUrl');
  if (isAuthenticated && !rejectedByGuard && matchesPrefix(pathname, GUEST_ONLY_PREFIXES)) {
    return NextResponse.redirect(new URL(ROUTES.account.root, request.url));
  }

  if (matchesPrefix(pathname, ADMIN_PREFIXES)) {
    /*
     * An API answers in its own language.
     *
     * Redirecting `/api/admin/*` to a sign-in page hands an HTML document to
     * something expecting JSON — the caller sees a parse error rather than
     * "you are not signed in", which is the least useful way to say no. Pages
     * get the redirect; APIs get a status code.
     */
    const isApi = pathname.startsWith('/api/');

    if (!isAuthenticated) {
      return isApi
        ? NextResponse.json(
            { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Sign in required.' } },
            { status: 401 },
          )
        : redirectToSignIn(request.url, pathname + search);
    }

    const roles = session?.user?.roles ?? [];
    if (!roles.some((role) => ADMIN_ROLES.includes(role))) {
      return isApi
        ? NextResponse.json(
            { ok: false, error: { code: 'FORBIDDEN', message: 'Not permitted.' } },
            { status: 403 },
          )
        : // 404 rather than 403 for pages: do not confirm the admin exists.
          NextResponse.rewrite(new URL('/not-found', request.url));
    }

    return NextResponse.next();
  }

  if (matchesPrefix(pathname, PROTECTED_PREFIXES) && !isAuthenticated) {
    return redirectToSignIn(request.url, pathname + search);
  }

  /*
   * Forward the pathname so a `not-found` boundary can read it.
   *
   * A React Server Component has no way to learn which URL was requested —
   * `headers()` carries what the client sent, and the client sends a Host, not
   * a path. The redirect table is consulted on the 404 path, and it needs to
   * know what was asked for.
   *
   * Done here because the proxy has already parsed the URL, so it costs one
   * header rather than a second parse on every request.
   */
  const forwarded = new Headers(request.headers);
  forwarded.set('x-pathname', pathname);

  return NextResponse.next({ request: { headers: forwarded } });
});

function redirectToSignIn(base: string, callbackUrl: string): NextResponse {
  const url = new URL(ROUTES.auth.signIn, base);
  url.searchParams.set('callbackUrl', callbackUrl);
  return NextResponse.redirect(url);
}

export const config = {
  /**
   * Skip static assets and image optimisation entirely — running this on every
   * `.woff2` request is pure latency.
   *
   * `/api/auth/*` is excluded for a different reason: this middleware *is* an
   * Auth.js instance, built from the edge config, whose `providers` array is
   * empty. Letting it run over Auth.js's own endpoints means that instance
   * answers `/api/auth/session` instead of the route handler — and a provider-
   * less instance 404s, so `SessionProvider` gets an HTML error page and
   * reports `ClientFetchError: Unexpected token '<'`. The auth API gates
   * itself; nothing here needs to see it.
   */
  matcher: [
    '/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|avif|ico|woff2?)$).*)',
  ],
};
