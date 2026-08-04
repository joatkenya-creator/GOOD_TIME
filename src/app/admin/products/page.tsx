import type { Metadata } from 'next';
import Link from 'next/link';

import { DataTable, StatusPill, TablePagination } from '@/components/admin/data-table';
import { BulkBar, ListToolbar } from '@/components/admin/list-toolbar';
import { AdminPageHeader } from '@/components/admin/page-header';
import { PERMISSIONS } from '@/constants/permissions';
import { type RawSearchParams, buildListHref, formatDate, formatMoney, parseListParams } from '@/features/admin/query';
import { displayProductStatus } from '@/features/admin/status';
import { bulkProductAction } from '@/server/actions/admin/products';
import { requireAdminPermission } from '@/server/auth/admin';
import { can } from '@/server/auth/session';
import {
  type AdminProductRow,
  getProductFormOptions,
  listAdminProducts,
} from '@/services/admin/product-admin.service';

export const metadata: Metadata = { title: 'Products' };

const BASE = '/admin/products';

/**
 * The product list.
 *
 * Filters, sort and page all live in the URL, so a filtered view is a link.
 * Bulk actions post the row checkboxes to a server action — the browser
 * collects the selection, which means there is no client-side state that can
 * disagree with what is visibly ticked.
 */
export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requireAdminPermission(PERMISSIONS.productRead);
  const params = parseListParams(await searchParams, { sort: 'updatedAt', direction: 'desc' });

  const [result, options] = await Promise.all([
    listAdminProducts({
      q: params.q,
      status: params.status,
      categoryId: params.extra.categoryId,
      sort: params.sort,
      direction: params.direction,
      page: params.page,
      pageSize: params.pageSize,
    }),
    getProductFormOptions(),
  ]);

  const canWrite = can(user, PERMISSIONS.productWrite);
  const canBulk = can(user, PERMISSIONS.productBulk);
  const canDelete = can(user, PERMISSIONS.productDelete);

  const columns = [
    {
      key: 'name',
      header: 'Product',
      sortable: true,
      cell: (row: AdminProductRow) => (
        <span className="block">
          <span className="block truncate">{row.name}</span>
          <span className="block truncate text-body-xs font-normal text-foreground-subtle">
            {row.sku ?? row.slug}
            {row.variantCount > 1 ? ` · ${row.variantCount} variants` : ''}
          </span>
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row: AdminProductRow) => {
        const status = displayProductStatus(row.status, row.publishedAt);
        return <StatusPill label={status.label} tone={status.tone} />;
      },
    },
    {
      key: 'stock',
      header: 'Stock',
      align: 'right' as const,
      secondary: true,
      cell: (row: AdminProductRow) => (
        <span
          className={
            row.stock <= 0 ? 'text-danger-700' : row.stock <= 5 ? 'text-warning-700' : undefined
          }
        >
          {row.stock}
        </span>
      ),
    },
    {
      key: 'price',
      header: 'Price',
      sortable: true,
      align: 'right' as const,
      cell: (row: AdminProductRow) =>
        row.minPriceCents === row.maxPriceCents
          ? formatMoney(row.minPriceCents)
          : `${formatMoney(row.minPriceCents)} – ${formatMoney(row.maxPriceCents)}`,
    },
    {
      key: 'sold',
      header: 'Sold',
      sortable: true,
      align: 'right' as const,
      secondary: true,
      cell: (row: AdminProductRow) => row.soldCount,
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      sortable: true,
      secondary: true,
      cell: (row: AdminProductRow) => formatDate(row.updatedAt),
    },
  ];

  return (
    <>
      <AdminPageHeader
        title="Products"
        description={`${result.total} in the catalogue.`}
        pathname={BASE}
        actions={
          canWrite ? (
            <Link
              href="/admin/products/new"
              className="rounded-lg bg-accent px-4 py-2 text-body-sm font-medium text-white hover:bg-accent-hover"
            >
              New product
            </Link>
          ) : null
        }
      />

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <ListToolbar
          basePath={BASE}
          params={params}
          placeholder="Name, SKU or URL…"
          statuses={[
            { value: '', label: 'All' },
            { value: 'ACTIVE', label: 'Published' },
            { value: 'DRAFT', label: 'Drafts' },
            { value: 'scheduled', label: 'Scheduled' },
            { value: 'ARCHIVED', label: 'Archived' },
          ]}
        >
          <div>
            <label htmlFor="category-filter" className="sr-only">
              Category
            </label>
            <select
              id="category-filter"
              name="categoryId"
              defaultValue={params.extra.categoryId ?? ''}
              className="h-10 rounded-lg border border-border bg-surface px-3 text-body-sm"
            >
              <option value="">All categories</option>
              {options.categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.path}
                </option>
              ))}
            </select>
          </div>
        </ListToolbar>

        {/*
          One form wraps the bulk bar and the table, so the checkboxes inside the
          rows are submitted with whichever action button was pressed.
        */}
        <form action={bulkProductAction}>
          <BulkBar
            canBulk={canBulk}
            canDelete={canDelete}
            categories={options.categories}
            actions={[
              { value: 'publish', label: 'Publish' },
              { value: 'draft', label: 'Move to draft' },
              { value: 'feature', label: 'Feature' },
              { value: 'unfeature', label: 'Unfeature' },
              { value: 'archive', label: 'Archive' },
              { value: 'delete', label: 'Delete', danger: true },
            ]}
          />

          <DataTable
            rows={result.items}
            columns={columns}
            getKey={(row) => row.id}
            getHref={(row) => `/admin/products/${row.id}`}
            sort={{ key: params.sort, direction: params.direction }}
            buildSortHref={(key, direction) => buildListHref(BASE, params, { sort: key, direction })}
            selection={canBulk ? { name: 'selected' } : undefined}
            empty={
              <div>
                <p className="text-body font-medium">No products match.</p>
                <p className="mt-1 text-body-sm text-foreground-subtle">
                  {params.q || params.status
                    ? 'Try clearing the filters.'
                    : 'Create the first one to get started.'}
                </p>
              </div>
            }
          />
        </form>

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
