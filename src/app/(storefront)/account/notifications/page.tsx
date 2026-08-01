import type { Metadata } from 'next';

import { NotificationPreferences } from '@/components/account/notification-preferences';
import { requireUser } from '@/server/auth/session';
import { getPreferences } from '@/services/account/notification.service';

export const metadata: Metadata = { title: 'Notifications' };

/**
 * The notification centre.
 *
 * Everything we might send, and how. Consent is a legal record as much as a
 * setting, which is why each change is stored per topic rather than as one
 * global marketing flag.
 */
export default async function NotificationsPage() {
  const user = await requireUser();
  const preferences = await getPreferences(user.id);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-h2 font-bold text-foreground">Notifications</h1>
        <p className="mt-1 text-body-sm text-foreground-muted">
          Nothing we send names a product in the subject line, whichever of these you turn on.
        </p>
      </header>

      <NotificationPreferences preferences={preferences} />
    </div>
  );
}
