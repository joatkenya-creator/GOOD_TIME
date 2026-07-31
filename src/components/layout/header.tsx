import { Heart, User } from 'lucide-react';
import Link from 'next/link';

import { MiniCart } from '@/components/cart/mini-cart';
import { AnnouncementBar } from '@/components/navigation/announcement-bar';
import { MegaMenu } from '@/components/navigation/mega-menu';
import { MobileNav } from '@/components/navigation/mobile-nav';
import { SearchBar } from '@/components/navigation/search-bar';
import { Container } from '@/components/layout/container';
import { siteConfig } from '@/config/site';
import { ROUTES } from '@/constants/routes';
import { cn } from '@/utils/cn';

/**
 * Site header.
 *
 * A server component: only the announcement bar, mega menu, search and mobile
 * drawer hydrate. The logo, utility links and layout ship as plain HTML.
 *
 * `sticky` rather than `fixed`, so the page never needs a compensating top
 * padding that drifts out of sync with the header's real height.
 *
 * `cartCount` is read in the layout and passed in rather than fetched here, so
 * this stays a presentational component and the bag badge is still correct in the
 * first paint — a count that pops in after hydration reads as a bug and moves the
 * layout.
 */
export function Header({ cartCount = 0 }: { cartCount?: number }) {
  return (
    <header className="sticky top-0 z-(--z-header) bg-surface/85 backdrop-blur-md">
      <AnnouncementBar />

      <div className="border-b border-border">
        <Container className="flex h-16 items-center gap-3 sm:h-18 sm:gap-5">
          <MobileNav />

          <Link
            href={ROUTES.home}
            className="shrink-0 rounded-md font-display text-xl tracking-tight text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--color-ring) sm:text-2xl"
          >
            {siteConfig.name}
            <span className="sr-only"> — home</span>
          </Link>

          <MegaMenu />

          <SearchBar className="ml-auto hidden max-w-sm flex-1 md:block" />

          <div className="ml-auto flex items-center gap-0.5 md:ml-0">
            <UtilityLink href={ROUTES.account.wishlist} label="Wishlist" className="hidden sm:flex">
              <Heart aria-hidden="true" className="size-5" />
            </UtilityLink>

            <UtilityLink href={ROUTES.account.root} label="Account">
              <User aria-hidden="true" className="size-5" />
            </UtilityLink>

            <MiniCart initialCount={cartCount} />
          </div>
        </Container>
      </div>
    </header>
  );
}

function UtilityLink({
  href,
  label,
  badge,
  className,
  children,
}: {
  href: string;
  label: string;
  /** Item count. Rendered only when non-zero — an empty "0" adds noise. */
  badge?: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={cn(
        'relative flex size-11 items-center justify-center rounded-full text-foreground',
        'transition-colors duration-(--duration-fast) ease-(--ease-brand) hover:bg-surface-muted hover:text-accent-text',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)',
        className,
      )}
    >
      {children}
      {badge ? (
        <span className="absolute top-1.5 right-1 flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[0.625rem] font-semibold text-white">
          {badge}
          <span className="sr-only"> items</span>
        </span>
      ) : null}
    </Link>
  );
}
