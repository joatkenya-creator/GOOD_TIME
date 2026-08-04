import type { Metadata } from 'next';

import { DataTable, StatusPill, TablePagination } from '@/components/admin/data-table';
import { ListToolbar } from '@/components/admin/list-toolbar';
import { AdminPageHeader } from '@/components/admin/page-header';
import { PERMISSIONS } from '@/constants/permissions';
import {
  type RawSearchParams,
  buildListHref,
  formatDateTime,
  formatMoney,
  parseListParams,
} from '@/features/admin/query';
import { ORDER_STATUS_TONE, PAYMENT_STATUS_TONE, humaniseEnum } from '@/features/admin/status';
import { maskEmail, requireAdminPermission } from '@/server/auth/admin';
import { can } from '@/server/auth/session';
import { type AdminOrderRow, getOrderCounts, listAdminOrders } from '@/services/admin/commerce-admin.service';

export const metadata: Metadata = { title: 'Orders' };

const BASE = '/admin/orders';

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requireAdminPermission(PERMISSIONS.orderRead);
  const params = parseListParams(await searchParams);

  const [result, counts] = await Promise.all([
    listAdminOrders({
      q: params.q,
      status: params.status,
      page: params.page,
      pageSize: params.pageSize,
    }),
    getOrderCounts(),
  ]);

  // Staff without `customer:pii` still need to identify an order; they get a
  // masked address rather than a blank column.
  const seePii = can(user, PERMISSIONS.customerPii);

  const columns = [
    {
      key: 'orderNumber',
      header: 'Order',
      cell: (row: AdminOrderRow) => (
        <span className="block">
          <span className="block">{row.orderNumber}</span>
          <span className="block truncate text-body-xs font-normal text-foreground-subtle">
            {[row.user?.firstName, row.user?.lastName].filter(Boolean).join(' ') ||
              maskEmail(row.email, seePii)}
          </span>
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row: AdminOrderRow) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusPill label={humaniseEnum(row.status)} tone={ORDER_STATUS_TONE[row.status]} />
          {row.riskFlags.length > 0 ? <StatusPill label="Flagged" tone="danger" /> : null}
        </span>
      ),
    },
    {
      key: 'payment',
      header: 'Payment',
      secondary: true,
      cell: (row: AdminOrderRow) => (
        <StatusPill
          label={humaniseEnum(row.paymentStatus)}
          tone={PAYMENT_STATUS_TONE[row.paymentStatus]}
        />
      ),
    },
    {
      key: 'items',
      header: 'Items',
      align: 'right' as const,
      secondary: true,
      cell: (row: AdminOrderRow) => row._count.items,
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right' as const,
      cell: (row: AdminOrderRow) => (
        <span className="font-medium tabular-nums">{formatMoney(row.totalCents)}</span>
      ),
    },
    {
      key: 'placedAt',
      header: 'Placed',
      secondary: true,
      cell: (row: AdminOrderRow) => formatDateTime(row.placedAt ?? row.createdAt),
    },
  ];

  return (
    <>
      <AdminPageHeader
        title="Orders"
        description={`${result.total} orders.`}
        pathname={BASE}
      />

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <ListToolbar
          basePath={BASE}
          params={params}
          placeholder="Order number or email…"
          statuses={[
            { value: '', label: 'All', count: counts.all },
            { value: 'PENDING', label: 'Pending', count: counts.PENDING ?? 0 },
            { value: 'PAID', label: 'Paid', count: counts.PAID ?? 0 },
            { value: 'PROCESSING', label: 'Processing', count: counts.PROCESSING ?? 0 },
            { value: 'SHIPPED', label: 'Shipped', count: counts.SHIPPED ?? 0 },
            { value: 'DELIVERED', label: 'Delivered', count: counts.DELIVERED ?? 0 },
            { value: 'REFUNDED', label: 'Refunded', count: counts.REFUNDED ?? 0 },
          ]}
        />

        <DataTable
          rows={result.items}
          columns={columns}
          getKey={(row) => row.id}
          getHref={(row) => `/admin/orders/${row.orderNumber}`}
          empty={
            <div>
              <p className="text-body font-medium">No orders match.</p>
              <p className="mt-1 text-body-sm text-foreground-subtle">
                {params.q || params.status ? 'Try clearing the filters.' : 'Orders appear here as they are placed.'}
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
