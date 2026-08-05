'use client';

import {
  Bell,
  Clock,
  CreditCard,
  Gift,
  Heart,
  LayoutDashboard,
  LogOut,
  MapPin,
  Package,
  RotateCcw,
  ShieldCheck,
  User,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ROUTES } from '@/constants/routes';
import { cn } from '@/utils/cn';

/**
 * Account navigation.
 *
 * A horizontal scroller on mobile and a sidebar from `lg` up — one component, so
 * the two never drift apart in what they list.
 *
 * `aria-current="page"` rather than colour alone marks the active item: on the
 * mobile scroller the active chip can be off screen, and a screen reader user
 * needs to know where they are without seeing it.
 */

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const SECTIONS: { heading: string; items: NavItem[] }[] = [
  {
    heading: 'Overview',
    items: [{ href: ROUTES.account.root, label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    heading: 'Shopping',
    items: [
      { href: ROUTES.account.orders, label: 'Orders', icon: Package },
      { href: '/account/returns', label: 'Returns', icon: RotateCcw },
      { href: ROUTES.account.wishlist, label: 'Wishlist', icon: Heart },
      { href: '/account/recently-viewed', label: 'Recently viewed', icon: Clock },
    ],
  },
  {
    heading: 'Account',
    items: [
      { href: '/account/profile', label: 'Profile', icon: User },
      { href: ROUTES.account.addresses, label: 'Addresses', icon: MapPin },
      { href: '/account/payment-methods', label: 'Payment methods', icon: CreditCard },
      { href: '/account/rewards', label: 'Rewards', icon: Gift },
    ],
  },
  {
    heading: 'Settings',
    items: [
      { href: '/account/notifications', label: 'Notifications', icon: Bell },
      { href: '/account/security', label: 'Security', icon: ShieldCheck },
    ],
  },
];

const FLAT = SECTIONS.flatMap((section) => section.items);

export function AccountNav() {
  const pathname = usePathname();

  // Longest match wins, so `/account/orders/GT-1` highlights Orders rather than
  // Dashboard — every path starts with `/account`.
  const active = FLAT.reduce<string | null>((best, item) => {
    if (pathname !== item.href && !pathname.startsWith(`${item.href}/`)) return best;
    return best === null || item.href.length > best.length ? item.href : best;
  }, null);

  return (
    <>
      {/* Mobile: a scroller, so eleven destinations do not become a wall. */}
      <nav aria-label="Account sections" className="-mx-4 border-b border-border px-4 lg:hidden">
        <ul className="flex [scrollbar-width:none] gap-2 overflow-x-auto pb-3 [&::-webkit-scrollbar]:hidden">
          {FLAT.map((item) => (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active === item.href ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 items-center gap-2 rounded-full border px-4 text-body-sm whitespace-nowrap transition-colors',
                  active === item.href
                    ? 'bg-accent-subtle border-accent font-medium text-accent-text'
                    : 'border-border text-foreground-muted hover:border-foreground-subtle',
                )}
              >
                <item.icon aria-hidden="true" className="size-4" />
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <nav aria-label="Account sections" className="hidden lg:block">
        {SECTIONS.map((section) => (
          <div key={section.heading} className="mb-6">
            <h2 className="text-body-xs mb-2 px-3 font-medium tracking-wide text-foreground-subtle uppercase">
              {section.heading}
            </h2>

            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active === item.href ? 'page' : undefined}
                    className={cn(
                      'flex min-h-11 items-center gap-3 rounded-lg px-3 text-body-sm transition-colors',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)',
                      active === item.href
                        ? 'bg-accent-subtle font-medium text-accent-text'
                        : 'text-foreground-muted hover:bg-surface-muted hover:text-foreground',
                    )}
                  >
                    <item.icon aria-hidden="true" className="size-4 shrink-0" />
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <form action="/api/auth/signout" method="post" className="border-t border-border pt-4">
          <button
            type="submit"
            className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-body-sm text-foreground-muted transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
          >
            <LogOut aria-hidden="true" className="size-4 shrink-0" />
            Sign out
          </button>
        </form>
      </nav>
    </>
  );
}
