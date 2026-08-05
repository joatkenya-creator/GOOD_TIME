import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AdminCard, AdminPageHeader } from '@/components/admin/page-header';
import { ProductEditor } from '@/components/admin/product-editor';
import { PERMISSIONS } from '@/constants/permissions';
import { formatDateTime } from '@/features/admin/query';
import {
  archiveProductAction,
  duplicateProductAction,
  updateProductAction,
} from '@/server/actions/admin/products';
import { requireAdminPermission } from '@/server/auth/admin';
import { can } from '@/server/auth/session';
import { describeChanges, listAudit } from '@/services/admin/audit.service';
import { getAdminProduct, getProductFormOptions } from '@/services/admin/product-admin.service';

export const metadata: Metadata = { title: 'Edit product' };

/** `datetime-local` wants `YYYY-MM-DDTHH:mm` in local time, not an ISO string. */
function toLocalInput(date: Date | null): string {
  if (!date) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAdminPermission(PERMISSIONS.productRead);
  const { id } = await params;

  const [product, options] = await Promise.all([getAdminProduct(id), getProductFormOptions()]);
  if (!product) notFound();

  // The editor's own history. Scoped to this product, so it answers "what
  // happened to *this*" rather than sending someone to filter the global log.
  const history = can(user, PERMISSIONS.auditRead)
    ? await listAudit({ entityType: 'Product', entityId: id, pageSize: 10 })
    : null;

  const canWrite = can(user, PERMISSIONS.productWrite);
  const canDelete = can(user, PERMISSIONS.productDelete);

  return (
    <>
      <AdminPageHeader
        title={product.name}
        description={`Last updated ${formatDateTime(product.updatedAt)}.`}
        pathname="/admin/products"
        trail={[{ label: product.name }]}
        actions={
          <>
            {canWrite ? (
              <form action={duplicateProductAction}>
                <input type="hidden" name="id" value={product.id} />
                <button
                  type="submit"
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-body-sm font-medium hover:bg-surface-muted"
                >
                  Duplicate
                </button>
              </form>
            ) : null}

            {canDelete && product.status !== 'ARCHIVED' ? (
              <form action={archiveProductAction}>
                <input type="hidden" name="id" value={product.id} />
                <button
                  type="submit"
                  className="rounded-lg border border-danger-700/30 px-3 py-2 text-body-sm font-medium text-danger-700 hover:bg-danger-50"
                >
                  Archive
                </button>
              </form>
            ) : null}
          </>
        }
      />

      <ProductEditor
        action={updateProductAction}
        categories={options.categories}
        collections={options.collections.map((collection) => ({
          id: collection.id,
          name: collection.title,
        }))}
        brands={options.brands}
        variants={product.variants.map((variant) => ({
          id: variant.id,
          sku: variant.sku,
          name: variant.name,
          priceCents: variant.priceCents,
          stock: Math.max(
            0,
            (variant.inventory?.quantity ?? 0) - (variant.inventory?.reserved ?? 0),
          ),
        }))}
        media={product.media.map((row) => ({
          id: row.media.id,
          url: row.media.url,
          alt: row.media.alt,
        }))}
        values={{
          id: product.id,
          name: product.name,
          slug: product.slug,
          subtitle: product.subtitle ?? '',
          shortDescription: product.shortDescription ?? '',
          description: product.description ?? '',
          status: product.status,
          publishedAt: toLocalInput(product.publishedAt),
          sku: product.sku ?? '',
          barcode: product.barcode ?? '',
          brandId: product.brandId ?? '',
          isFeatured: product.isFeatured,
          isAdultOnly: product.isAdultOnly,
          categoryIds: product.categories.map((row) => row.categoryId),
          collectionIds: product.collections.map((row) => row.collectionId),
          seoTitle: product.seo?.title ?? '',
          seoDescription: product.seo?.description ?? '',
          seoCanonical: product.seo?.canonicalUrl ?? '',
          seoNoindex: product.seo?.noindex ?? false,
        }}
      />

      {history && history.items.length > 0 ? (
        <AdminCard title="History" description="Every change to this product" className="mt-6">
          <ul className="divide-y divide-border">
            {history.items.map((entry) => {
              const changes = describeChanges(entry.changes);
              return (
                <li key={entry.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="text-body-sm">
                    <span className="font-medium">
                      {entry.actor?.firstName ?? entry.actor?.email ?? 'System'}
                    </span>{' '}
                    <span className="text-foreground-muted">{entry.action.toLowerCase()}d it</span>
                    <span className="text-foreground-subtle">
                      {' '}
                      · {formatDateTime(entry.createdAt)}
                    </span>
                  </p>
                  {changes.length > 0 ? (
                    <ul className="mt-1 space-y-0.5">
                      {changes.map((change) => (
                        <li key={change} className="text-body-xs text-foreground-subtle">
                          {change}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </AdminCard>
      ) : null}
    </>
  );
}
