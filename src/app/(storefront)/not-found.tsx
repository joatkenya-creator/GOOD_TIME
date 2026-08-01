import Link from 'next/link';

import { Container } from '@/components/layout/container';
import { Button } from '@/components/ui/button';
import { ROUTES } from '@/constants/routes';

/**
 * 404 inside the storefront.
 *
 * A near-copy of the app-level `not-found`, differing in one thing that matters:
 * it renders a `<section>`, not a `<main>`. The storefront layout already owns
 * the `<main id="main">` landmark and the skip-link target, so the root version
 * nests a second one inside it — two `<main>` elements and two `id="main"` on the
 * same page, which breaks the skip link and confuses landmark navigation.
 *
 * Keeping the header and footer is the other half of the point: a 404 reached
 * from inside the shop should still be somewhere you can shop from.
 */
export default function StorefrontNotFound() {
  return (
    <Container
      as="section"
      width="narrow"
      className="flex flex-col items-center justify-center py-24 text-center"
    >
      <p className="text-eyebrow text-accent uppercase">404</p>
      <h1 className="mt-4 text-display-lg text-foreground">We can&apos;t find that page</h1>
      <p className="mt-4 text-base leading-relaxed text-foreground-muted">
        The link may be broken, or the page may have moved. If you followed a link from an email,
        it may have expired.
      </p>

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button asChild>
          <Link href={ROUTES.shop}>Browse the shop</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href={ROUTES.account.orders}>Your orders</Link>
        </Button>
      </div>
    </Container>
  );
}
