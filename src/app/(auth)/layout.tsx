import Link from 'next/link';

import { Container } from '@/components/layout/container';
import { siteConfig } from '@/config/site';
import { ROUTES } from '@/constants/routes';

/**
 * Auth shell.
 *
 * Deliberately chrome-free: no navigation, no promotional banners, nothing to
 * click away from the form. Every element on an auth page that is not the form
 * costs conversions.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface-muted">
      <header className="py-8">
        <Container className="flex justify-center">
          <Link
            href={ROUTES.home}
            className="font-display text-2xl tracking-tight text-foreground"
            aria-label={`${siteConfig.name} home`}
          >
            {siteConfig.name}
          </Link>
        </Container>
      </header>

      <main
        id="main"
        className="flex flex-1 items-start justify-center px-(--spacing-gutter) pb-20"
      >
        <div className="w-full max-w-md">{children}</div>
      </main>

      <footer className="pb-10">
        <Container className="text-center text-xs text-foreground-subtle">
          <p>
            &copy; {new Date().getFullYear()} {siteConfig.legalName}
          </p>
        </Container>
      </footer>
    </div>
  );
}
