import type { Metadata } from 'next';

import { AddressManager } from '@/components/account/address-manager';
import { requireUser } from '@/server/auth/session';
import { listAddresses } from '@/services/account/address.service';

export const metadata: Metadata = { title: 'Addresses' };

/**
 * The address book.
 *
 * A server component that hands the list to one client island. Nothing here
 * needs to hydrate except the add/edit modal and the row actions.
 */
export default async function AddressesPage() {
  const user = await requireUser();
  const addresses = await listAddresses(user.id);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-h2 font-bold text-foreground">Addresses</h1>
        <p className="mt-1 text-body-sm text-foreground-muted">
          Everything ships in plain, unbranded packaging, whichever address you use.
        </p>
      </header>

      <AddressManager addresses={addresses} />
    </div>
  );
}
