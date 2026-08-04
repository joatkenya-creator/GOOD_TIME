'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { PERMISSIONS } from '@/constants/permissions';
import { withAdminAction } from '@/server/auth/admin';
import { adjustStock, setLowStockThreshold } from '@/services/admin/inventory-admin.service';

const adjustSchema = z.object({
  variantId: z.string().min(1),
  delta: z.coerce.number().int().refine((value) => value !== 0, 'Enter a change other than zero'),
  reason: z.enum([
    'RECEIVED',
    'SOLD',
    'RETURNED',
    'DAMAGED',
    'LOST',
    'RECOUNT',
    'CORRECTION',
    'TRANSFER',
  ]),
  note: z.string().trim().max(500).optional(),
});

/**
 * The inline adjustment from the inventory table.
 *
 * Routes through `adjustStock`, which writes the ledger row and the count in
 * one transaction — there is deliberately no path that changes a quantity
 * without recording why.
 */
export async function adjustStockAction(formData: FormData): Promise<void> {
  const parsed = adjustSchema.safeParse({
    variantId: formData.get('variantId'),
    delta: formData.get('delta'),
    reason: formData.get('reason'),
    note: formData.get('note') ?? undefined,
  });

  // A malformed inline form is a no-op rather than a crash: this action is
  // fired from a table row, and throwing would replace the whole page with an
  // error boundary over a typo in one field.
  if (!parsed.success) return;

  await withAdminAction(
    PERMISSIONS.inventoryAdjust,
    (actor) =>
      adjustStock({
        variantId: parsed.data.variantId,
        delta: parsed.data.delta,
        reason: parsed.data.reason,
        note: parsed.data.note ?? null,
        actorId: actor.id,
      }),
    (result) => ({
      action: 'UPDATE' as const,
      entityType: 'Inventory',
      entityId: parsed.data.variantId,
      changes: {
        delta: { from: null, to: parsed.data.delta },
        reason: { from: null, to: parsed.data.reason },
        quantityAfter: { from: null, to: result.quantityAfter },
      },
    }),
  );

  revalidatePath('/admin/inventory');
  revalidatePath('/admin');
}

export async function setThresholdAction(formData: FormData): Promise<void> {
  const variantId = String(formData.get('variantId') ?? '');
  const threshold = Number(formData.get('threshold') ?? 0);
  if (!variantId || Number.isNaN(threshold)) return;

  await withAdminAction(
    PERMISSIONS.inventoryAdjust,
    () => setLowStockThreshold(variantId, threshold),
    () => ({
      action: 'UPDATE' as const,
      entityType: 'Inventory',
      entityId: variantId,
      changes: { lowStockThreshold: { from: null, to: threshold } },
    }),
  );

  revalidatePath('/admin/inventory');
}
