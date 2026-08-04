import type { Metadata } from 'next';
import Link from 'next/link';

import { StatusPill } from '@/components/admin/data-table';
import { AdminCard, AdminPageHeader } from '@/components/admin/page-header';
import { PERMISSIONS } from '@/constants/permissions';
import { formatRelative } from '@/features/admin/query';
import { markAlertReadAction, markAllReadAction } from '@/server/actions/admin/alerts';
import { requireAdminAccess } from '@/server/auth/admin';
import { listAlerts, syncInventoryAlerts } from '@/services/admin/alert.service';

export const metadata: Metadata = { title: 'Notifications' };

/**
 * The operational inbox.
 *
 * Alerts are addressed by permission, not by person: routing "low stock" to a
 * named manager means it goes unread the week they are on holiday. Everyone
 * sees what their permissions say they can act on.
 */
export default async function AdminAlertsPage() {
  // Only the front door: an alert someone cannot act on is filtered out by the
  // query rather than by a page-level permission.
  const user = await requireAdminAccess();

  // Stock alerts are re-derived here rather than by a background job. This
  // phase does not own the scheduler, and the dedupe key makes it idempotent
  // however often the page is opened.
  if (user.permissions.includes(PERMISSIONS.inventoryRead)) {
    await syncInventoryAlerts();
  }

  const alerts = await listAlerts(user, { limit: 100 });
  const unread = alerts.filter((alert) => !alert.readAt);

  return (
    <>
      <AdminPageHeader
        title="Notifications"
        description={`${unread.length} unread of ${alerts.length}.`}
        pathname="/admin"
        trail={[{ label: 'Notifications' }]}
        actions={
          unread.length > 0 ? (
            <form action={markAllReadAction}>
              <button
                type="submit"
                className="rounded-lg border border-border bg-surface px-3 py-2 text-body-sm font-medium hover:bg-surface-muted"
              >
                Mark all read
              </button>
            </form>
          ) : null
        }
      />

      <AdminCard>
        {alerts.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-body font-medium">Nothing needs attention.</p>
            <p className="mt-1 text-body-sm text-foreground-subtle">
              New orders, low stock and failed payments appear here.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {alerts.map((alert) => (
              <li
                key={alert.id}
                className={`flex items-start gap-3 py-3 first:pt-0 last:pb-0 ${
                  alert.readAt ? 'opacity-60' : ''
                }`}
              >
                <span className="mt-1 shrink-0">
                  <StatusPill
                    label={alert.level}
                    tone={
                      alert.level === 'CRITICAL'
                        ? 'danger'
                        : alert.level === 'WARNING'
                          ? 'warning'
                          : 'info'
                    }
                  />
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-body-sm font-medium">
                    {alert.href ? (
                      <Link href={alert.href} className="hover:text-accent-text">
                        {alert.title}
                      </Link>
                    ) : (
                      alert.title
                    )}
                  </p>
                  {alert.body ? (
                    <p className="text-body-xs text-foreground-muted">{alert.body}</p>
                  ) : null}
                  <p className="text-body-xs text-foreground-subtle">
                    {formatRelative(alert.createdAt)}
                    {alert.readAt
                      ? ` · read by ${alert.readBy?.firstName ?? alert.readBy?.email ?? 'someone'}`
                      : ''}
                  </p>
                </div>

                {!alert.readAt ? (
                  <form action={markAlertReadAction} className="shrink-0">
                    <input type="hidden" name="alertId" value={alert.id} />
                    <button
                      type="submit"
                      className="rounded-lg border border-border px-2.5 py-1 text-body-xs font-medium hover:bg-surface-muted"
                    >
                      Mark read
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </AdminCard>
    </>
  );
}
