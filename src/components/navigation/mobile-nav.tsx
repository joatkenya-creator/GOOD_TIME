'use client';

import { Menu } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { SearchBar } from '@/components/navigation/search-bar';
import { AccordionItem } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { accountNav, primaryNav } from '@/config/navigation';
import { ROUTES } from '@/constants/routes';

/**
 * Mobile navigation.
 *
 * The same `primaryNav` tree as the desktop mega menu, re-projected into nested
 * accordions — one source of truth, two presentations.
 *
 * Closes on route change, which sounds obvious but is the defect users notice
 * most: tapping a link and finding the drawer still covering the page.
 */
export function MobileNav() {
  const pathname = usePathname();

  /**
   * The drawer stores the route it was opened on rather than a boolean, so
   * "open" is derived: navigating anywhere closes it automatically. Syncing a
   * boolean to `pathname` through an effect would cause a cascading render, and
   * would briefly leave the drawer covering the page it just navigated to.
   */
  const [openedPath, setOpenedPath] = useState<string | null>(null);
  const open = openedPath === pathname;

  const close = () => setOpenedPath(null);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpenedPath(pathname)}
        aria-label="Open menu"
        aria-expanded={open}
        className="lg:hidden"
      >
        <Menu />
      </Button>

      <Drawer open={open} onClose={close} title="Menu" side="left">
        <SearchBar size="lg" className="mb-6" />

        <nav aria-label="Mobile">
          <div className="border-t border-border">
            {primaryNav.map((item) =>
              item.columns?.length ? (
                <AccordionItem key={item.label} question={item.label} group="mobile-nav">
                  <div className="space-y-5">
                    {item.columns.map((column) => (
                      <div key={column.title}>
                        <p className="text-eyebrow text-foreground-subtle uppercase">
                          {column.title}
                        </p>
                        <ul className="mt-2.5 space-y-0.5">
                          {column.items.map((entry) => (
                            <li key={entry.href}>
                              <Link
                                href={entry.href}
                                className="flex items-center gap-2 rounded-md py-2 text-body-sm text-foreground-muted hover:text-accent-text"
                              >
                                {entry.label}
                                {entry.tag ? (
                                  <Badge variant="danger" size="sm">
                                    {entry.tag}
                                  </Badge>
                                ) : null}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}

                    <Link
                      href={item.href}
                      className="inline-flex text-body-sm font-medium text-accent-text underline underline-offset-4"
                    >
                      View all {item.label.toLowerCase()}
                    </Link>
                  </div>
                </AccordionItem>
              ) : (
                <Link
                  key={item.label}
                  href={item.href}
                  className="flex items-center gap-2 border-b border-border py-5 text-base font-medium text-foreground hover:text-accent-text"
                >
                  {item.label}
                  {item.tag ? (
                    <Badge variant="accent" size="sm">
                      {item.tag}
                    </Badge>
                  ) : null}
                </Link>
              ),
            )}
          </div>

          <div className="mt-8">
            <p className="text-eyebrow text-foreground-subtle uppercase">Your account</p>
            <ul className="mt-3 space-y-0.5">
              {accountNav.map((entry) => (
                <li key={entry.href}>
                  <Link
                    href={entry.href}
                    className="block rounded-md py-2 text-body-sm text-foreground-muted hover:text-accent-text"
                  >
                    {entry.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </nav>

        <Button asChild fullWidth size="lg" className="mt-8">
          <Link href={ROUTES.auth.signIn}>Sign in</Link>
        </Button>
      </Drawer>
    </>
  );
}
