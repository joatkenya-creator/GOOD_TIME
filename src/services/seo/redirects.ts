import 'server-only';

import { headers } from 'next/headers';
import { permanentRedirect, redirect } from 'next/navigation';

import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

/**
 * Serving the redirect table.
 *
 * ## Why this runs on the 404 path
 *
 * A redirect only matters when a URL does not resolve. Checking the table in
 * middleware would add a database round trip to *every* request on the site —
 * including the 99.9% that hit a real page — and the edge runtime has no
 * database connection to do it with anyway.
 *
 * Checking it at the moment a page is about to 404 costs nothing on the happy
 * path and happens exactly when the answer is needed. The trade is that a
 * redirect is served after Next has resolved the route rather than before,
 * which is a few milliseconds on a request that was going to be a 404.
 *
 * ## 308 and 307, not 301 and 302
 *
 * A Server Component cannot emit an arbitrary status; `permanentRedirect` sends
 * 308 and `redirect` sends 307. That is not a compromise:
 *
 *   - Google's documentation states 308 is treated exactly as 301, and 307 as
 *     302, for indexing and signal consolidation.
 *   - 308 and 307 additionally preserve the request method, where 301 and 302
 *     historically allowed browsers to rewrite POST to GET.
 *
 * The admin still speaks in 301/302 because that is the vocabulary merchants
 * and SEO tools use. The mapping is documented rather than hidden.
 */

/**
 * Looks up the requested path and redirects if the table has an answer.
 *
 * Never returns when a redirect exists — `redirect()` throws to unwind. When
 * there is no match it returns normally and the caller renders its 404.
 */
export async function applyRedirect(): Promise<void> {
  let pathname = '';

  try {
    const list = await headers();
    // Set by `proxy.ts` on every request. A Server Component has no other way
    // to learn which URL was asked for.
    pathname = list.get('x-pathname') ?? '';
  } catch {
    // `headers()` throws outside a request scope — during static generation,
    // for instance, where there is no URL to redirect anyway.
    return;
  }

  if (!pathname.startsWith('/')) return;

  await redirectFor(pathname);
}

/**
 * The lookup itself, separated so a route handler can call it with a path it
 * already knows rather than sniffing headers.
 */
export async function redirectFor(pathname: string): Promise<void> {
  // Normalised the same way the admin normalises on save, so `/old/` and
  // `/old` are the same rule rather than two.
  const normalised =
    pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;

  const match = await prisma.redirect
    .findFirst({
      where: { source: normalised, isActive: true },
      select: { id: true, destination: true, statusCode: true },
    })
    .catch((error: unknown) => {
      // A redirect lookup must never turn a 404 into a 500.
      logger.warn('redirect.lookup_failed', { pathname, reason: String(error) });
      return null;
    });

  if (!match) return;

  /*
   * The hit counter is what makes a dead redirect retirable on evidence.
   *
   * Fire-and-forget: the customer is being sent somewhere and should not wait
   * for a statistics write, and a failed counter must not break the redirect.
   */
  void prisma.redirect
    .update({
      where: { id: match.id },
      data: { hits: { increment: 1 }, lastHitAt: new Date() },
    })
    .catch(() => undefined);

  if (match.statusCode === 302) {
    redirect(match.destination);
  }

  permanentRedirect(match.destination);
}
