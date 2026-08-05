'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { PERMISSIONS } from '@/constants/permissions';
import { assertAdminPermission, withAdminAction } from '@/server/auth/admin';
import { diff, recordAudit } from '@/services/admin/audit.service';
import {
  type BulkAction,
  assignCategory,
  bulkAdjustPrices,
  bulkUpdateProducts,
  createProduct,
  duplicateProduct,
  getAdminProduct,
  updateProduct,
} from '@/services/admin/product-admin.service';

/**
 * Product server actions.
 *
 * Every one goes through `withAdminAction` or an explicit
 * `assertAdminPermission`, so the permission check and the audit row are
 * structural rather than something each author has to remember. A server
 * action is a public HTTP endpoint with a friendly syntax — the fact that only
 * your own form posts to it is a UI detail, not a security boundary.
 */

const productSchema = z.object({
  name: z.string().trim().min(1, 'A product needs a name').max(200),
  slug: z.string().trim().max(200).optional().default(''),
  subtitle: z.string().trim().max(200).optional(),
  shortDescription: z.string().trim().max(500).optional(),
  description: z.string().trim().max(20_000).optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']),
  publishedAt: z.string().optional(),
  sku: z.string().trim().max(64).optional(),
  barcode: z.string().trim().max(64).optional(),
  brandId: z.string().trim().optional(),
  isFeatured: z.coerce.boolean().optional(),
  isAdultOnly: z.coerce.boolean().optional(),
  categoryIds: z.array(z.string()).optional(),
  collectionIds: z.array(z.string()).optional(),
  seoTitle: z.string().trim().max(200).optional(),
  seoDescription: z.string().trim().max(400).optional(),
  seoCanonical: z.string().trim().max(500).optional(),
  seoNoindex: z.coerce.boolean().optional(),
});

export interface ActionState {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
}

function parseForm(formData: FormData) {
  return productSchema.safeParse({
    name: formData.get('name'),
    slug: formData.get('slug') ?? '',
    subtitle: formData.get('subtitle') ?? undefined,
    shortDescription: formData.get('shortDescription') ?? undefined,
    description: formData.get('description') ?? undefined,
    status: formData.get('status') ?? 'DRAFT',
    publishedAt: formData.get('publishedAt') ?? undefined,
    sku: formData.get('sku') ?? undefined,
    barcode: formData.get('barcode') ?? undefined,
    brandId: formData.get('brandId') ?? undefined,
    isFeatured: formData.get('isFeatured') === 'on',
    isAdultOnly: formData.get('isAdultOnly') === 'on',
    categoryIds: formData.getAll('categoryIds').map(String).filter(Boolean),
    collectionIds: formData.getAll('collectionIds').map(String).filter(Boolean),
    seoTitle: formData.get('seoTitle') ?? undefined,
    seoDescription: formData.get('seoDescription') ?? undefined,
    seoCanonical: formData.get('seoCanonical') ?? undefined,
    seoNoindex: formData.get('seoNoindex') === 'on',
  });
}

function toInput(data: z.infer<typeof productSchema>) {
  return {
    name: data.name,
    slug: data.slug || data.name,
    subtitle: data.subtitle || null,
    shortDescription: data.shortDescription || null,
    description: data.description || null,
    status: data.status,
    // An empty datetime input means "no schedule", which is not the same as
    // "leave it alone" — the editor always sends the field.
    publishedAt: data.publishedAt ? new Date(data.publishedAt) : null,
    sku: data.sku || null,
    barcode: data.barcode || null,
    brandId: data.brandId || null,
    isFeatured: data.isFeatured ?? false,
    isAdultOnly: data.isAdultOnly ?? true,
    categoryIds: data.categoryIds ?? [],
    collectionIds: data.collectionIds ?? [],
    seo: {
      title: data.seoTitle || null,
      description: data.seoDescription || null,
      canonicalUrl: data.seoCanonical || null,
      noindex: data.seoNoindex ?? false,
    },
  };
}

export async function createProductAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Check the highlighted fields.',
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
      ),
    };
  }

  const product = await withAdminAction(
    PERMISSIONS.productWrite,
    () => createProduct(toInput(parsed.data)),
    (result) => ({
      action: 'CREATE' as const,
      entityType: 'Product',
      entityId: result.id,
      changes: { name: { from: null, to: result.name } },
    }),
  );

  revalidatePath('/admin/products');
  redirect(`/admin/products/${product.id}?created=1`);
}

export async function updateProductAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = String(formData.get('id') ?? '');
  if (!id) return { ok: false, message: 'Missing product.' };

  const parsed = parseForm(formData);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Check the highlighted fields.',
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
      ),
    };
  }

  await assertAdminPermission(PERMISSIONS.productWrite);

  // Read before writing, so the audit row carries a real diff rather than just
  // "someone saved this".
  const before = await getAdminProduct(id);

  const input = toInput(parsed.data);
  const updated = await withAdminAction(
    PERMISSIONS.productWrite,
    () => updateProduct(id, input),
    (result) => ({
      action: 'UPDATE' as const,
      entityType: 'Product',
      entityId: result.id,
      changes: diff(
        {
          name: before?.name,
          status: before?.status,
          sku: before?.sku,
          publishedAt: before?.publishedAt,
          isFeatured: before?.isFeatured,
        },
        {
          name: result.name,
          status: result.status,
          sku: result.sku,
          publishedAt: result.publishedAt,
          isFeatured: result.isFeatured,
        },
      ),
    }),
  );

  revalidatePath('/admin/products');
  revalidatePath(`/admin/products/${updated.id}`);
  // The storefront caches by slug, so a rename has to clear both.
  revalidatePath(`/shop/${updated.slug}`);

  return { ok: true, message: 'Product saved.' };
}

export async function duplicateProductAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const copy = await withAdminAction(
    PERMISSIONS.productWrite,
    () => duplicateProduct(id),
    (result) => ({
      action: 'CREATE' as const,
      entityType: 'Product',
      entityId: result.id,
      changes: { duplicatedFrom: { from: null, to: id } },
    }),
  );

  revalidatePath('/admin/products');
  redirect(`/admin/products/${copy.id}`);
}

/**
 * Bulk actions from the list screen.
 *
 * `delete` needs its own, stronger permission: archiving four hundred products
 * is recoverable in one click, deleting them is not.
 */
export async function bulkProductAction(formData: FormData): Promise<void> {
  const action = String(formData.get('action') ?? '') as BulkAction | 'price' | 'category';
  const ids = formData.getAll('selected').map(String).filter(Boolean);

  if (ids.length === 0) return;

  if (action === 'price') {
    const mode = formData.get('priceMode') === 'fixed' ? 'fixed' : 'percent';
    const raw = Number(formData.get('priceAmount') ?? 0);
    // Fixed amounts are entered in dollars and stored in cents, like everywhere
    // else in this codebase.
    const amount = mode === 'fixed' ? Math.round(raw * 100) : raw;

    const count = await withAdminAction(
      PERMISSIONS.productBulk,
      () => bulkAdjustPrices(ids, { mode, amount }),
      (result) => ({
        action: 'UPDATE' as const,
        entityType: 'Product',
        entityId: `bulk:${ids.length}`,
        changes: { priceAdjustment: { from: null, to: `${mode} ${amount} on ${result} variants` } },
      }),
    );

    revalidatePath('/admin/products');
    void count;
    return;
  }

  if (action === 'category') {
    const categoryId = String(formData.get('categoryId') ?? '');
    if (!categoryId) return;

    await withAdminAction(
      PERMISSIONS.productBulk,
      () => assignCategory(ids, categoryId),
      (result) => ({
        action: 'UPDATE' as const,
        entityType: 'Product',
        entityId: `bulk:${ids.length}`,
        changes: { categoryAssigned: { from: null, to: `${categoryId} on ${result} products` } },
      }),
    );

    revalidatePath('/admin/products');
    return;
  }

  const permission = action === 'delete' ? PERMISSIONS.productDelete : PERMISSIONS.productBulk;

  await withAdminAction(
    permission,
    () => bulkUpdateProducts(ids, action),
    (result) => ({
      action: action === 'delete' ? ('DELETE' as const) : ('UPDATE' as const),
      entityType: 'Product',
      entityId: `bulk:${ids.length}`,
      changes: { bulkAction: { from: null, to: `${action} affected ${result}` } },
    }),
  );

  revalidatePath('/admin/products');
}

/** Single-row archive, from the editor rather than the list. */
export async function archiveProductAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  await withAdminAction(
    PERMISSIONS.productDelete,
    () => bulkUpdateProducts([id], 'archive'),
    () => ({
      action: 'UPDATE' as const,
      entityType: 'Product',
      entityId: id,
      changes: { status: { from: null, to: 'ARCHIVED' } },
    }),
  );

  revalidatePath('/admin/products');
  redirect('/admin/products?archived=1');
}

/** Used by the audit trail on the editor's history tab. */
export async function recordProductView(productId: string): Promise<void> {
  await recordAudit({ action: 'UPDATE', entityType: 'Product', entityId: productId });
}
