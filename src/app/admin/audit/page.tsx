import type { Metadata } from 'next';

import { StatusPill, TablePagination } from '@/components/admin/data-table';
import { ListToolbar } from '@/components/admin/list-toolbar';
import { AdminCard, AdminPageHeader } from '@/components/admin/page-header';
import { PERMISSIONS } from '@/constants/permissions';
import type { AuditAction } from '@/generated/prisma/enums';
import {
  type RawSearchParams,
  buildListHref,
  formatDateTime,
  parseListParams,
} from '@/features/admin/query';
import { requireAdminPermission } from '@/server/auth/admin';
import { describeChanges, listAudit } from '@/services/admin/audit.service';

export const metadata: Metadata = { title: 'Audit log' };

const BASE = '/admin/audit';

const ACTION_TONE: Record<string, 'success' | 'info' | 'danger' | 'neutral' | 'warning'> = {
  CREATE: 'success',
  UPDATE: 'info',
  DELETE: 'danger',
  LOGIN: 'neutral',
  LOGOUT: 'neutral',
  EXPORT: 'warning',
  IMPORT: 'warning',
};

/**
 * The audit log.
 *
 * Every admin mutation writes one row, through `withAdminAction`. Not for
 * compliance theatre — for the Monday morning when a price is wrong, a customer
 * was refunded twice, or four hundred products were archived, and the only
 * useful question is who did it and what it looked like before.
 */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requireAdminPermission(PERMISSIONS.auditRead);
  const params = parseListParams(await searchParams, { pageSize: 50 });

  const result = await listAudit({
    entityType: params.extra.entityType || undefined,
    action: (params.status || undefined) as AuditAction | undefined,
    page: params.page,
    pageSize: params.pageSize,
  });

  return (
    <>
      <AdminPageHeader
        title="Audit log"
        description="Every change made in the admin, with who made it."
        pathname={BASE}
      />

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <ListToolbar
          basePath={BASE}
          params={params}
          placeholder="Search is by entity below…"
          statuses={[
            { value: '', label: 'All' },
            { value: 'CREATE', label: 'Created' },
            { value: 'UPDATE', label: 'Updated' },
            { value: 'DELETE', label: 'Deleted' },
            { value: 'EXPORT', label: 'Exported' },
          ]}
        >
          <div>
            <label htmlFor="entity-filter" className="sr-only">
              Entity type
            </label>
            <select
              id="entity-filter"
              name="entityType"
              defaultValue={params.extra.entityType ?? ''}
              className="h-10 rounded-lg border border-border bg-surface px-3 text-body-sm"
            >
              <option value="">All records</option>
              {['Product', 'Order', 'User', 'Role', 'UserRole', 'Inventory', 'Category', 'Collection', 'Media', 'Page', 'Post', 'Redirect', 'Setting', 'Report'].map(
                (entity) => (
                  <option key={entity} value={entity}>
                    {entity}
                  </option>
                ),
              )}
            </select>
          </div>
        </ListToolbar>

        {result.items.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <p className="text-body font-medium">Nothing recorded yet.</p>
            <p className="mt-1 text-body-sm text-foreground-subtle">
              Entries appear as soon as anyone changes something.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {result.items.map((entry) => {
              const changes = describeChanges(entry.changes);

              return (
                <li key={entry.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-body-sm">
                        <span className="font-medium">
                          {entry.actor
                            ? ([entry.actor.firstName, entry.actor.lastName]
                                .filter(Boolean)
                                .join(' ') || entry.actor.email)
                            : 'System'}
                        </span>{' '}
                        <span className="text-foreground-muted">
                          {entry.action.toLowerCase()}d {entry.entityType}
                        </span>{' '}
                        <span className="font-mono text-body-xs text-foreground-subtle">
                          {entry.entityId}
                        </span>
                      </p>

                      {changes.length > 0 ? (
                        <ul className="mt-1 space-y-0.5">
                          {changes.slice(0, 6).map((change) => (
                            <li key={change} className="text-body-xs text-foreground-subtle">
                              {change}
                            </li>
                          ))}
                          {changes.length > 6 ? (
                            <li className="text-body-xs text-foreground-subtle">
                              …and {changes.length - 6} more
                            </li>
                          ) : null}
                        </ul>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <StatusPill
                        label={entry.action}
                        tone={ACTION_TONE[entry.action] ?? 'neutral'}
                      />
                      <span className="text-body-xs text-foreground-subtle">
                        {formatDateTime(entry.createdAt)}
                      </span>
                    </div>
                  </div>

                  {entry.ipAddress ? (
                    <p className="mt-1 font-mono text-body-xs text-foreground-subtle">
                      {entry.ipAddress}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        <TablePagination
          page={result.page}
          totalPages={result.totalPages}
          total={result.total}
          buildHref={(page) => buildListHref(BASE, params, { page })}
        />
      </div>

      <AdminCard title="What is not in here" className="mt-6">
        <p className="text-body-sm text-foreground-muted">
          Secrets. Passwords, tokens, gift-card codes and card data are stripped before a row is
          written — an audit table is the one place nobody thinks to check for them, which makes it
          the worst place to keep them.
        </p>
        <p className="mt-2 text-body-sm text-foreground-muted">
          Customer sign-ins are recorded separately, on each customer&rsquo;s own security page, because
          they belong to the customer rather than to the store.
        </p>
      </AdminCard>
    </>
  );
}
