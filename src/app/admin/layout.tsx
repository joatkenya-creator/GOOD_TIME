import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import { AdminShell } from '@/components/admin/admin-shell';
import { ADMIN_NAV } from '@/config/admin-nav';
import { requireAdminAccess } from '@/server/auth/admin';
import { can } from '@/server/auth/session';
import { countUnreadAlerts } from '@/services/admin/alert.service';

/**
 * Admin shell.
 *
 * The authorisation gate for everything under `/admin`. Guarding in the layout
 * means a page added to this folder is protected by default; the alternative is
 * protected by memory, and memory is where the unguarded page comes from.
 *
 * `requireAdminAccess` only asks "are you staff at all" — each page names the
 * specific permission it needs. Two layers, because one gate at the door makes
 * "can you open the admin" and "can you refund four thousand dollars" the same
 * question.
 */
export const metadata: Metadata = {
  title: { default: 'Admin', template: '%s · Admin · GOOD TIME' },
  // Nothing here is ever indexed, and `nocache` keeps it out of caches that
  // ignore the first directive.
  robots: { index: false, follow: false, nocache: true, noimageindex: true },
};

/** Operational data, read per request. Nothing here may ever be cached. */
export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdminAccess();

  /*
   * The menu is filtered on the server, so a link someone cannot use is never
   * sent to their browser. Hiding it in CSS would still ship the route list —
   * a map of the building to someone who cannot open the doors.
   */
  const sections = ADMIN_NAV.map((section) => ({
    title: section.title,
    items: section.items
      .filter((item) => can(user, item.permission))
      .map(({ label, href, hint, icon }) => ({ label, href, hint, icon })),
  })).filter((section) => section.items.length > 0);

  /*
   * Theme from a cookie, resolved on the server.
   *
   * The usual approach is an inline script that reads localStorage before
   * paint; this needs neither, because the server already knows. No flash, no
   * blocking script, and the toggle is a cookie write plus a refresh.
   */
  const jar = await cookies();
  const theme = jar.get('gt.admin_theme')?.value === 'dark' ? 'dark' : 'light';
  const sidebarCollapsed = jar.get('gt.admin_sidebar')?.value === 'collapsed';

  const unreadAlerts = await countUnreadAlerts(user);

  return (
    <AdminShell
      sections={sections}
      theme={theme}
      sidebarCollapsed={sidebarCollapsed}
      unreadAlerts={unreadAlerts}
      user={{
        name: [user.name].filter(Boolean).join(' ') || user.email,
        email: user.email,
        roles: user.roles,
      }}
    >
      {children}
    </AdminShell>
  );
}
