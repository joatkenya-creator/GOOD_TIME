import type { Metadata } from 'next';
import Link from 'next/link';

import { DataTable, StatusPill, TablePagination } from '@/components/admin/data-table';
import { ListToolbar } from '@/components/admin/list-toolbar';
import { AdminCard, AdminPageHeader } from '@/components/admin/page-header';
import { PERMISSIONS } from '@/constants/permissions';
import {
  type RawSearchParams,
  buildListHref,
  formatRelative,
  parseListParams,
} from '@/features/admin/query';
import { adjustStockAction } from '@/server/actions/admin/inventory';
import { requireAdminPermission } from '@/server/auth/admin';
import { can } from '@/server/auth/session';
import {
  ADJUSTMENT_REASONS,
  type InventoryRow,
  getInventoryCounts,
  listInventory,
  listRecentAdjustments,
} from '@/services/admin/inventory-admin.service';

export const metadata: Metadata = { title: 'Inventory' };

const BASE = '/admin/inventory';

export default async function AdminInventoryPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requireAdminPermission(PERMISSIONS.inventoryRead);
  const params = parseListParams(await searchParams, { sort: 'quantity', direction: 'asc' });

  const [result, counts, recent] = await Promise.all([
    listInventory({
      q: params.q,
      status: params.status,
      page: params.page,
      pageSize: params.pageSize,
    }),
    getInventoryCounts(),
    listRecentAdjustments(12),
  ]);

  const canAdjust = can(user, PERMISSIONS.inventoryAdjust);

  const columns = [
    {
      key: 'variant',
      header: 'Variant',
      cell: (row: InventoryRow) => (
        <span className="block">
          <span className="block truncate">{row.variant.product.name}</span>
          <span className="text-body-xs block truncate font-normal text-foreground-subtle">
            {row.variant.name} · {row.variant.sku}
          </span>
        </span>
      ),
    },
    {
      key: 'onHand',
      header: 'On hand',
      align: 'right' as const,
      cell: (row: InventoryRow) => <span className="tabular-nums">{row.quantity}</span>,
    },
    {
      key: 'reserved',
      header: 'Reserved',
      align: 'right' as const,
      secondary: true,
      cell: (row: InventoryRow) => (
        <span className="text-foreground-subtle tabular-nums">{row.reserved}</span>
      ),
    },
    {
      key: 'available',
      header: 'Available',
      align: 'right' as const,
      cell: (row: InventoryRow) => (
        <span
          className={
            row.available <= 0
              ? 'font-medium text-danger-700 tabular-nums'
              : row.available <= row.lowStockThreshold
                ? 'font-medium text-warning-700 tabular-nums'
                : 'tabular-nums'
          }
        >
          {row.available}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row: InventoryRow) =>
        row.available <= 0 ? (
          <StatusPill label="Out of stock" tone="danger" />
        ) : row.available <= row.lowStockThreshold ? (
          <StatusPill label="Low" tone="warning" />
        ) : (
          <StatusPill label="In stock" tone="success" />
        ),
    },
    {
      key: 'adjust',
      header: 'Adjust',
      align: 'right' as const,
      cell: (row: InventoryRow) =>
        canAdjust ? (
          /*
            The adjustment form is inline, per row, and still goes through the
            same ledger-writing service as everything else. A quick correction
            should not require opening a second screen — but it must not be a
            silent edit either, so a reason is required.
          */
          <form action={adjustStockAction} className="flex items-center justify-end gap-1.5">
            <input type="hidden" name="variantId" value={row.variant.id} />
            <label htmlFor={`delta-${row.id}`} className="sr-only">
              Change for {row.variant.sku}
            </label>
            <input
              id={`delta-${row.id}`}
              type="number"
              name="delta"
              step={1}
              placeholder="±0"
              required
              className="text-body-xs h-8 w-16 rounded-lg border border-border bg-surface px-2 tabular-nums"
            />
            <label htmlFor={`reason-${row.id}`} className="sr-only">
              Reason for {row.variant.sku}
            </label>
            <select
              id={`reason-${row.id}`}
              name="reason"
              required
              defaultValue="RECEIVED"
              className="text-body-xs h-8 rounded-lg border border-border bg-surface px-1.5"
            >
              {ADJUSTMENT_REASONS.map((reason) => (
                <option key={reason.value} value={reason.value}>
                  {reason.label}
                </option>
              ))}
            </select>
            {/*
              "Adjust", not "Apply".

              The filter bar above this table already has an Apply button, so
              every row sharing that name gives a screen-reader user a column of
              identical announcements with nothing to tell them apart — and the
              row buttons outnumber the filter one by however many variants are
              on screen. The `aria-label` names the SKU for the same reason.
            */}
            <button
              type="submit"
              aria-label={`Adjust stock for ${row.variant.sku}`}
              className="text-body-xs h-8 rounded-lg border border-border bg-surface px-2.5 font-medium hover:bg-surface-muted"
            >
              Adjust
            </button>
          </form>
        ) : (
          <span className="text-body-xs text-foreground-subtle">View only</span>
        ),
    },
  ];

  return (
    <>
      <AdminPageHeader
        title="Inventory"
        description="Every change is recorded with a reason and the person who made it."
        pathname={BASE}
      />

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <ListToolbar
          basePath={BASE}
          params={params}
          placeholder="SKU, variant or product…"
          statuses={[
            { value: '', label: 'All', count: counts.total },
            { value: 'out', label: 'Out of stock', count: counts.out },
            { value: 'low', label: 'Low', count: counts.low },
            { value: 'ok', label: 'In stock', count: counts.ok },
          ]}
        />

        <DataTable
          rows={result.items}
          columns={columns}
          getKey={(row) => row.id}
          empty={
            <div>
              <p className="text-body font-medium">Nothing to show.</p>
              <p className="mt-1 text-body-sm text-foreground-subtle">
                Inventory rows appear once a product has variants.
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

      <AdminCard title="Recent adjustments" description="The stock ledger" className="mt-6">
        {recent.length === 0 ? (
          <p className="py-6 text-center text-body-sm text-foreground-subtle">
            No adjustments recorded yet.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {recent.map((entry) => (
              <li
                key={entry.id}
                className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-body-sm">
                    <span className="font-medium">{entry.variant.product.name}</span>
                    <span className="text-foreground-subtle"> · {entry.variant.sku}</span>
                  </p>
                  <p className="text-body-xs truncate text-foreground-subtle">
                    {entry.reason.toLowerCase().replace(/_/g, ' ')}
                    {entry.note ? ` — ${entry.note}` : ''} ·{' '}
                    {entry.actor?.firstName ?? entry.actor?.email ?? 'System'} ·{' '}
                    {formatRelative(entry.createdAt)}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-body-sm font-medium tabular-nums ${
                    entry.delta > 0 ? 'text-success-700' : 'text-danger-700'
                  }`}
                >
                  {entry.delta > 0 ? '+' : ''}
                  {entry.delta}
                  <span className="text-body-xs ml-1.5 font-normal text-foreground-subtle">
                    → {entry.quantityAfter}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </AdminCard>

      <p className="text-body-xs mt-4 text-foreground-subtle">
        Locations are recorded on every adjustment but there is one warehouse today. Multi-warehouse
        allocation is a later phase — see{' '}
        <Link href="/admin/settings" className="text-accent-text underline">
          settings
        </Link>
        .
      </p>
    </>
  );
}
