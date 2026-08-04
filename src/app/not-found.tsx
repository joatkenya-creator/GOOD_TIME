import Link from 'next/link';

import { Container } from '@/components/layout/container';
import { Button } from '@/components/ui/button';
import { ROUTES } from '@/constants/routes';
import { applyRedirect } from '@/services/seo/redirects';

/**
 * 404. Also the destination for `/` in phase 1 — the storefront pages are
 * deliberately not built yet.
 */
export default async function NotFound() {
  /*
   * The redirect table is consulted before the 404 is rendered.
   *
   * A slug that changed keeps its inbound links and its ranking only if
   * something forwards it, and this is the one place that knows the request
   * did not resolve. `applyRedirect` throws to unwind when it finds a match,
   * so nothing below runs in that case.
   */
  await applyRedirect();

  return (
    <Container
      as="main"
      width="narrow"
      className="flex min-h-dvh flex-col items-center justify-center py-24 text-center"
    >
      <p className="text-eyebrow text-accent uppercase">404</p>
      <h1 className="mt-4 text-display-lg text-foreground">We can&apos;t find that page</h1>
      <p className="mt-4 text-base leading-relaxed text-foreground-muted">
        The link may be broken, or the page may have moved.
      </p>

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button asChild>
          <Link href={ROUTES.shop}>Browse the shop</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href={ROUTES.auth.signIn}>Sign in</Link>
        </Button>
      </div>
    </Container>
  );
}
