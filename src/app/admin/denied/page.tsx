import type { Metadata } from 'next';
import Link from 'next/link';

import { AdminCard, AdminPageHeader } from '@/components/admin/page-header';
import { ADMIN_NAV } from '@/config/admin-nav';
import { requireAdminAccess } from '@/server/auth/admin';
import { can } from '@/server/auth/session';

export const metadata: Metadata = { title: 'Not permitted' };

/**
 * Where a refused staff member lands.
 *
 * This page requires nothing beyond being staff, which is the entire point:
 * the previous behaviour sent them to `/admin`, and the dashboard needs
 * `analytics:read`. Customer support and content editors do not hold it, so
 * every page they were refused bounced them to a page that refused them
 * again — a redirect loop the browser eventually gave up on, with no
 * explanation at any point.
 *
 * A destination that cannot itself refuse anyone is the only kind that is safe
 * to redirect to.
 */
export default async function AdminDeniedPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const user = await requireAdminAccess();
  const { from } = await searchParams;

  // What they *can* open, so the page is a way forward rather than a dead end.
  const available = ADMIN_NAV.flatMap((section) =>
    section.items.filter((item) => can(user, item.permission)),
  );

  return (
    <>
      <AdminPageHeader
        title="You do not have access to that"
        description={
          from
            ? `${from} needs a permission your role does not include.`
            : 'That page needs a permission your role does not include.'
        }
        pathname="/admin"
        trail={[{ label: 'Not permitted' }]}
      />

      <AdminCard title="What you can open">
        {available.length === 0 ? (
          <p className="text-body-sm text-foreground-muted">
            Your role grants no admin screens. Ask an administrator to review it.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {available.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block rounded-lg border border-border px-4 py-3 hover:bg-surface-muted"
                >
                  <span className="block text-body-sm font-medium">{item.label}</span>
                  {item.hint ? (
                    <span className="text-body-xs block text-foreground-subtle">{item.hint}</span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}

        <p className="text-body-xs mt-4 text-foreground-subtle">
          Permissions are set per role under Staff &amp; roles. If you need this screen, that is
          where someone with the role permission can grant it.
        </p>
      </AdminCard>
    </>
  );
}
