'use server';

import { revalidatePath } from 'next/cache';

import { requireAdminAccess } from '@/server/auth/admin';
import { markAlertRead, markAllAlertsRead } from '@/services/admin/alert.service';

/**
 * Alert actions.
 *
 * No specific permission beyond admin access: the service scopes every write to
 * the alerts this user can already see, so naming an id they cannot read simply
 * changes nothing. An id in a form is a guess, not an authorisation.
 */

export async function markAlertReadAction(formData: FormData): Promise<void> {
  const user = await requireAdminAccess();
  const alertId = String(formData.get('alertId') ?? '');
  if (!alertId) return;

  await markAlertRead(user, alertId);

  revalidatePath('/admin/alerts');
  // The unread badge lives in the shell, so the whole admin has to re-render.
  revalidatePath('/admin', 'layout');
}

export async function markAllReadAction(): Promise<void> {
  const user = await requireAdminAccess();
  await markAllAlertsRead(user);

  revalidatePath('/admin/alerts');
  revalidatePath('/admin', 'layout');
}
