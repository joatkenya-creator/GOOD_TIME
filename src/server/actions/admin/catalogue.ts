'use server';

import { revalidatePath } from 'next/cache';

import { PERMISSIONS } from '@/constants/permissions';
import { withAdminAction } from '@/server/auth/admin';
import {
  deleteCategory,
  deleteMedia,
  updateMediaAlt,
  upsertCategory,
  upsertCollection,
} from '@/services/admin/catalogue-admin.service';

/** Categories, collections and media actions. All permission-checked and audited. */

export async function saveCategoryAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '') || undefined;

  await withAdminAction(
    PERMISSIONS.categoryWrite,
    () =>
      upsertCategory({
        id,
        name: String(formData.get('name') ?? '').trim(),
        slug: String(formData.get('slug') ?? '').trim(),
        parentId: String(formData.get('parentId') ?? '') || null,
        description: String(formData.get('description') ?? '') || null,
        isActive: formData.get('isActive') === 'on',
        position: Number(formData.get('position') ?? 0) || 0,
      }),
    (result) => ({
      action: id ? ('UPDATE' as const) : ('CREATE' as const),
      entityType: 'Category',
      entityId: result.id,
      changes: { name: { from: null, to: result.name }, path: { from: null, to: result.path } },
    }),
  );

  revalidatePath('/admin/categories');
  // The storefront navigation and every shop listing read this tree.
  revalidatePath('/shop', 'layout');
}

export async function deleteCategoryAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  await withAdminAction(
    PERMISSIONS.categoryWrite,
    () => deleteCategory(id),
    () => ({ action: 'DELETE' as const, entityType: 'Category', entityId: id }),
  );

  revalidatePath('/admin/categories');
  revalidatePath('/shop', 'layout');
}

export async function saveCollectionAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '') || undefined;
  const isAutomatic = formData.get('isAutomatic') === 'on';

  /*
   * Rules are only read when the collection is marked automatic.
   *
   * Keeping a stale rule object on a manual collection would make it silently
   * automatic again the next time someone ticked the box, with criteria they
   * never saw.
   */
  const rules = isAutomatic
    ? {
        ...(formData.get('ruleCategoryId')
          ? { categoryId: String(formData.get('ruleCategoryId')) }
          : {}),
        ...(formData.get('ruleOnSale') === 'on' ? { isOnSale: true } : {}),
        ...(formData.get('ruleNewArrival') === 'on' ? { isNewArrival: true } : {}),
        ...(formData.get('ruleMaxPrice')
          ? { maxPriceCents: Math.round(Number(formData.get('ruleMaxPrice')) * 100) }
          : {}),
      }
    : null;

  const startsAtRaw = String(formData.get('startsAt') ?? '');
  const endsAtRaw = String(formData.get('endsAt') ?? '');

  await withAdminAction(
    PERMISSIONS.collectionWrite,
    () =>
      upsertCollection({
        id,
        title: String(formData.get('title') ?? '').trim(),
        slug: String(formData.get('slug') ?? '').trim(),
        description: String(formData.get('description') ?? '') || null,
        isActive: formData.get('isActive') === 'on',
        position: Number(formData.get('position') ?? 0) || 0,
        startsAt: startsAtRaw ? new Date(startsAtRaw) : null,
        endsAt: endsAtRaw ? new Date(endsAtRaw) : null,
        rules,
      }),
    (result) => ({
      action: id ? ('UPDATE' as const) : ('CREATE' as const),
      entityType: 'Collection',
      entityId: result.id,
      changes: {
        title: { from: null, to: result.title },
        automatic: { from: null, to: Boolean(rules) },
      },
    }),
  );

  revalidatePath('/admin/collections');
}

export async function updateMediaAltAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const alt = String(formData.get('alt') ?? '');
  if (!id) return;

  await withAdminAction(
    PERMISSIONS.mediaWrite,
    () => updateMediaAlt(id, alt),
    () => ({
      action: 'UPDATE' as const,
      entityType: 'Media',
      entityId: id,
      changes: { alt: { from: null, to: alt } },
    }),
  );

  revalidatePath('/admin/media');
}

export async function deleteMediaAction(formData: FormData): Promise<void> {
  const ids = formData.getAll('selected').map(String).filter(Boolean);
  if (ids.length === 0) return;

  await withAdminAction(
    PERMISSIONS.mediaDelete,
    () => deleteMedia(ids),
    (result) => ({
      action: 'DELETE' as const,
      entityType: 'Media',
      entityId: `bulk:${ids.length}`,
      changes: {
        deleted: { from: null, to: result.deleted },
        // Recorded rather than silently skipped, so "I deleted it and it is
        // still there" has an answer.
        skippedBecauseInUse: { from: null, to: result.inUse.length },
      },
    }),
  );

  revalidatePath('/admin/media');
}
