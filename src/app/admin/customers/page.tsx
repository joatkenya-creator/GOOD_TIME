import type { Metadata } from 'next';

import { DataTable, StatusPill, TablePagination } from '@/components/admin/data-table';
import { ListToolbar } from '@/components/admin/list-toolbar';
import { AdminPageHeader } from '@/components/admin/page-header';
import { PERMISSIONS } from '@/constants/permissions';
import {
  type RawSearchParams,
  buildListHref,
  formatDate,
  formatMoney,
  parseListParams,
} from '@/features/admin/query';
import { humaniseEnum } from '@/features/admin/status';
import { maskEmail, requireAdminPermission } from '@/server/auth/admin';
import { can } from '@/server/auth/session';
import {
  type AdminCustomerRow,
  listCustomerTags,
  listCustomers,
} from '@/services/admin/commerce-admin.service';

export const metadata: Metadata = { title: 'Customers' };

const BASE = '/admin/customers';

export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requireAdminPermission(PERMISSIONS.customerRead);
  const params = parseListParams(await searchParams);

  const [result, tags] = await Promise.all([
    listCustomers({
      q: params.q,
      status: params.status,
      tag: params.extra.tag,
      page: params.page,
      pageSize: params.pageSize,
    }),
    listCustomerTags(),
  ]);

  const seePii = can(user, PERMISSIONS.customerPii);

  const columns = [
    {
      key: 'name',
      header: 'Customer',
      cell: (row: AdminCustomerRow) => (
        <span className="block">
          <span className="block truncate">
            {[row.firstName, row.lastName].filter(Boolean).join(' ') || 'No name'}
          </span>
          <span className="text-body-xs block truncate font-normal text-foreground-subtle">
            {maskEmail(row.email, seePii)}
          </span>
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row: AdminCustomerRow) => (
        <StatusPill
          label={humaniseEnum(row.status)}
          tone={
            row.status === 'ACTIVE' ? 'success' : row.status === 'SUSPENDED' ? 'danger' : 'neutral'
          }
        />
      ),
    },
    {
      key: 'orders',
      header: 'Orders',
      align: 'right' as const,
      secondary: true,
      cell: (row: AdminCustomerRow) => row._count.orders,
    },
    {
      key: 'ltv',
      header: 'Lifetime value',
      align: 'right' as const,
      cell: (row: AdminCustomerRow) => (
        <span className="font-medium tabular-nums">{formatMoney(row.lifetimeValueCents)}</span>
      ),
    },
    {
      key: 'tier',
      header: 'Tier',
      secondary: true,
      cell: (row: AdminCustomerRow) =>
        row.rewardAccount ? (
          <StatusPill label={humaniseEnum(row.rewardAccount.tier)} tone="accent" />
        ) : (
          <span className="text-foreground-subtle">—</span>
        ),
    },
    {
      key: 'tags',
      header: 'Tags',
      secondary: true,
      cell: (row: AdminCustomerRow) =>
        row.adminTags.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {row.adminTags.slice(0, 3).map((tag) => (
              <StatusPill key={tag} label={tag} tone="neutral" />
            ))}
          </span>
        ) : (
          <span className="text-foreground-subtle">—</span>
        ),
    },
    {
      key: 'joined',
      header: 'Joined',
      secondary: true,
      cell: (row: AdminCustomerRow) => formatDate(row.createdAt),
    },
  ];

  return (
    <>
      <AdminPageHeader
        title="Customers"
        description={
          seePii
            ? `${result.total} accounts.`
            : `${result.total} accounts. Email and phone are masked — that needs the customer PII permission.`
        }
        pathname={BASE}
      />

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <ListToolbar
          basePath={BASE}
          params={params}
          placeholder="Name or email…"
          statuses={[
            { value: '', label: 'All' },
            { value: 'ACTIVE', label: 'Active' },
            { value: 'SUSPENDED', label: 'Suspended' },
          ]}
        >
          {tags.length > 0 ? (
            <div>
              <label htmlFor="tag-filter" className="sr-only">
                Tag
              </label>
              <select
                id="tag-filter"
                name="tag"
                defaultValue={params.extra.tag ?? ''}
                className="h-10 rounded-lg border border-border bg-surface px-3 text-body-sm"
              >
                <option value="">All tags</option>
                {tags.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </ListToolbar>

        <DataTable
          rows={result.items}
          columns={columns}
          getKey={(row) => row.id}
          getHref={(row) => `/admin/customers/${row.id}`}
          empty={
            <div>
              <p className="text-body font-medium">No customers match.</p>
              <p className="mt-1 text-body-sm text-foreground-subtle">
                Accounts appear here as people register.
              </p>
            </div>
          }
        />

        <TablePagination
          page={result.page}
          totalPages={result.totalPages}
          total={result.total}
          buildHref={(page) => buildListHref(BASE, params, { page })}
        />
      </div>
    </>
  );
}
