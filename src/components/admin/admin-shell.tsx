'use client';

import { Bell, ChevronLeft, LogOut, Menu, Moon, Search, Sun, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useCallback, useEffect, useState } from 'react';

import { ADMIN_ICONS } from '@/components/admin/admin-icons';
import { AdminCommandPalette } from '@/components/admin/command-palette';
import type { AdminIconName } from '@/config/admin-nav';
import { cn } from '@/utils/cn';

export interface ShellNavItem {
  label: string;
  href: string;
  hint?: string;
  icon: AdminIconName;
}

export interface ShellSection {
  title: string;
  items: ShellNavItem[];
}

interface AdminShellProps {
  sections: ShellSection[];
  theme: 'light' | 'dark';
  /** Server-read preference, so the sidebar arrives at the right width. */
  sidebarCollapsed: boolean;
  unreadAlerts: number;
  user: { name: string; email: string; roles: string[] };
  children: React.ReactNode;
}

/**
 * The admin chrome: sidebar, top bar, command palette.
 *
 * A client component because the sidebar collapses, the palette opens on a
 * keystroke and the theme toggles — none of which the server can do. It
 * receives an already-filtered menu, so no route the user cannot open is ever
 * serialised into the page.
 *
 * The content area stays a server component: `children` is passed through
 * untouched, so every module page below renders on the server and this file
 * costs one small bundle for the whole admin rather than one per page.
 */
export function AdminShell({
  sections,
  theme,
  sidebarCollapsed,
  unreadAlerts,
  user,
  children,
}: AdminShellProps) {
  const pathname = usePathname();
  const router = useRouter();

  const [collapsed, setCollapsed] = useState(sidebarCollapsed);
  const [paletteOpen, setPaletteOpen] = useState(false);

  /*
   * The mobile drawer is keyed by pathname rather than closed in an effect.
   *
   * Changing a component's `key` remounts it, so navigating gives a fresh
   * drawer in its default closed state. The effect version set state during
   * commit, which is a second render on every navigation.
   */
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const mobileOpen = openedFor === pathname;

  const toggleCollapsed = useCallback(() => {
    setCollapsed((previous) => {
      const next = !previous;
      // Written where the server can read it back on the next request.
      document.cookie = `gt.admin_sidebar=${next ? 'collapsed' : 'expanded'}; path=/; max-age=31536000; samesite=lax`;
      return next;
    });
  }, []);

  /*
   * Keyboard shortcuts.
   *
   * Registered once, here, rather than per page — a shortcut that only works on
   * some screens is worse than none, because it trains a habit that then fails.
   * Ignored while typing, or ⌘K would be unusable inside a search field.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable === true;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }

      if (typing) return;

      // "/" to search, the convention everywhere from Gmail to GitHub.
      if (event.key === '/') {
        event.preventDefault();
        setPaletteOpen(true);
      }

      if (event.key === '[') toggleCollapsed();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleCollapsed]);

  /*
   * Theme, written as a cookie and re-rendered on the server.
   *
   * The server already reads this cookie in the layout, so there is no flash
   * and no blocking script in `<head>` — the page arrives in the right theme.
   * A year of `max-age` because a staff preference should outlive a session.
   */
  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.cookie = `gt.admin_theme=${next}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  const allItems = sections.flatMap((section) => section.items);

  return (
    <div data-admin-theme={theme} className="min-h-dvh bg-surface-muted text-foreground">
      <div className="flex min-h-dvh">
        {/* --- Sidebar ---------------------------------------------------- */}
        <Sidebar
          sections={sections}
          collapsed={collapsed}
          mobileOpen={mobileOpen}
          pathname={pathname}
          onClose={() => setOpenedFor(null)}
          onToggleCollapsed={toggleCollapsed}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          {/* --- Top bar -------------------------------------------------- */}
          <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-surface px-4 sm:px-6">
            <button
              type="button"
              onClick={() => setOpenedFor(pathname)}
              className="-ml-1 rounded-lg p-2 text-foreground-muted hover:bg-surface-muted hover:text-foreground lg:hidden"
              aria-label="Open navigation"
            >
              <Menu className="size-5" aria-hidden="true" />
            </button>

            {/*
              A button, not an input. It opens the palette, and a real input
              here would mean two search affordances that behave differently.
            */}
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="flex h-10 flex-1 items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 text-left text-body-sm text-foreground-subtle transition-colors hover:border-border-strong sm:max-w-md"
            >
              <Search className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate">Search products, orders, customers…</span>
              <kbd className="ml-auto hidden shrink-0 rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[11px] text-foreground-subtle sm:block">
                ⌘K
              </kbd>
            </button>

            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={toggleTheme}
                className="rounded-lg p-2 text-foreground-muted transition-colors hover:bg-surface-muted hover:text-foreground"
                aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              >
                {theme === 'dark' ? (
                  <Sun className="size-5" aria-hidden="true" />
                ) : (
                  <Moon className="size-5" aria-hidden="true" />
                )}
              </button>

              <Link
                href="/admin/alerts"
                className="relative rounded-lg p-2 text-foreground-muted transition-colors hover:bg-surface-muted hover:text-foreground"
                aria-label={
                  unreadAlerts > 0 ? `Notifications, ${unreadAlerts} unread` : 'Notifications'
                }
              >
                <Bell className="size-5" aria-hidden="true" />
                {unreadAlerts > 0 ? (
                  <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-white">
                    {unreadAlerts > 9 ? '9+' : unreadAlerts}
                  </span>
                ) : null}
              </Link>

              <UserMenu user={user} />
            </div>
          </header>

          {/*
            One `<main>` for the whole admin, with the landmark and the skip-link
            target. Pages render sections inside it — a page that opens its own
            `<main>` would give the document two, which breaks the skip link and
            landmark navigation. The storefront learned this the hard way.
          */}
          <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
            {children}
          </main>
        </div>
      </div>

      {/*
        The `key` is what resets the palette.

        Each open gets a new key, so React remounts it with fresh state — no
        effect clearing the query, and no chance of reopening onto a stale
        highlight and navigating somewhere unintended on a habitual Enter.
      */}
      <AdminCommandPalette
        key={paletteOpen ? pathname : 'closed'}
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        navItems={allItems}
      />
    </div>
  );
}

function Sidebar({
  sections,
  collapsed,
  mobileOpen,
  pathname,
  onClose,
  onToggleCollapsed,
}: {
  sections: ShellSection[];
  collapsed: boolean;
  mobileOpen: boolean;
  pathname: string;
  onClose: () => void;
  onToggleCollapsed: () => void;
}) {
  return (
    <>
      {/* Scrim. Clicking away is how everyone expects a drawer to close. */}
      {mobileOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-ink-900/50 lg:hidden"
          onClick={onClose}
          aria-label="Close navigation"
        />
      ) : null}

      <nav
        aria-label="Admin"
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r border-border bg-surface transition-[width,transform] duration-200',
          'lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0',
          collapsed ? 'w-[4.5rem]' : 'w-64',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 shrink-0 items-center gap-2 border-b border-border px-4">
          <Link href="/admin" className="flex min-w-0 items-center gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-sm font-bold text-white">
              GT
            </span>
            {!collapsed ? (
              <span className="truncate text-body-sm font-semibold tracking-tight">
                GOOD TIME
                <span className="block text-[11px] font-normal text-foreground-subtle">Admin</span>
              </span>
            ) : null}
          </Link>

          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg p-2 text-foreground-muted hover:bg-surface-muted lg:hidden"
            aria-label="Close navigation"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4">
          {sections.map((section) => (
            <div key={section.title} className="mb-6 last:mb-0">
              {!collapsed ? (
                <h2 className="px-3 pb-2 text-[11px] font-semibold tracking-wider text-foreground-subtle uppercase">
                  {section.title}
                </h2>
              ) : (
                // The heading still exists for a screen reader when collapsed —
                // otherwise the menu becomes one long undifferentiated list.
                <h2 className="sr-only">{section.title}</h2>
              )}

              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = ADMIN_ICONS[item.icon];
                  const active =
                    item.href === '/admin'
                      ? pathname === '/admin'
                      : pathname === item.href || pathname.startsWith(`${item.href}/`);

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        title={collapsed ? item.label : undefined}
                        className={cn(
                          'flex items-center gap-3 rounded-lg px-3 py-2 text-body-sm font-medium transition-colors',
                          collapsed && 'justify-center px-0',
                          active
                            ? 'bg-accent-soft text-accent-text'
                            : 'text-foreground-muted hover:bg-surface-muted hover:text-foreground',
                        )}
                      >
                        <Icon className="size-[18px] shrink-0" aria-hidden="true" />
                        {!collapsed ? <span className="truncate">{item.label}</span> : null}
                        {collapsed ? <span className="sr-only">{item.label}</span> : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        <div className="hidden shrink-0 border-t border-border p-3 lg:block">
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-body-sm text-foreground-muted transition-colors hover:bg-surface-muted hover:text-foreground"
            aria-expanded={!collapsed}
          >
            <ChevronLeft
              className={cn('size-[18px] shrink-0 transition-transform', collapsed && 'rotate-180')}
              aria-hidden="true"
            />
            {!collapsed ? <span>Collapse</span> : <span className="sr-only">Expand sidebar</span>}
          </button>
        </div>
      </nav>
    </>
  );
}

function UserMenu({ user }: { user: { name: string; email: string; roles: string[] } }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    // Capture phase, so a click on the trigger toggles rather than
    // close-then-reopen.
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);

  const initials =
    user.name
      .split(' ')
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'GT';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((previous) => !previous);
        }}
        className="ml-1 grid size-9 place-items-center rounded-full bg-surface-inverse text-xs font-semibold text-foreground-inverse"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {initials}
        <span className="sr-only">Account menu</span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-60 rounded-xl border border-border bg-surface p-1.5 shadow-lg"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="border-b border-border px-3 py-2">
            <p className="truncate text-body-sm font-medium">{user.name}</p>
            <p className="truncate text-body-xs text-foreground-subtle">{user.email}</p>
            <p className="mt-1.5 text-body-xs text-foreground-subtle">
              {user.roles.map((role) => role.replace(/_/g, ' ').toLowerCase()).join(', ')}
            </p>
          </div>

          <Link
            href="/account"
            role="menuitem"
            className="block rounded-lg px-3 py-2 text-body-sm text-foreground-muted hover:bg-surface-muted hover:text-foreground"
          >
            Your storefront account
          </Link>

          <button
            type="button"
            role="menuitem"
            onClick={() => signOut({ callbackUrl: '/' })}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-body-sm text-foreground-muted hover:bg-surface-muted hover:text-foreground"
          >
            <LogOut className="size-4" aria-hidden="true" />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
