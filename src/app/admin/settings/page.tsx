import type { Metadata } from 'next';

import { StatusPill } from '@/components/admin/data-table';
import { AdminCard, AdminPageHeader } from '@/components/admin/page-header';
import { PERMISSIONS } from '@/constants/permissions';
import { siteConfig } from '@/config/site';
import { saveSettingsAction } from '@/server/actions/admin/content';
import { requireAdminPermission } from '@/server/auth/admin';
import { can } from '@/server/auth/session';
import { getSettingsMap } from '@/services/admin/content-admin.service';

export const metadata: Metadata = { title: 'Settings' };

/**
 * Store settings.
 *
 * Two kinds of configuration, kept visibly apart:
 *
 *   **Editable** — things a merchant changes without a deploy: free-shipping
 *     threshold, support hours, feature flags. They live in the `settings`
 *     table.
 *   **Environment** — connection strings, API keys, anything secret. Shown
 *     read-only, as connected or not, and never editable here. The settings
 *     table is readable by every process with a database connection and shows
 *     up in every backup; a secret in it is a secret in all of those.
 */
const GROUPS = [
  {
    group: 'store',
    title: 'Store',
    description: 'Trading rules a merchant changes without a deploy.',
    fields: [
      {
        key: 'store.freeShippingThresholdCents',
        label: 'Free shipping over ($)',
        type: 'number',
        hint: 'Entered in dollars, stored in cents everywhere else.',
      },
      { key: 'store.lowStockThreshold', label: 'Default low-stock threshold', type: 'number' },
      { key: 'store.orderPrefix', label: 'Order number prefix', type: 'text' },
      { key: 'store.supportEmail', label: 'Support email', type: 'email' },
      { key: 'store.supportHours', label: 'Support hours', type: 'text' },
    ],
  },
  {
    group: 'checkout',
    title: 'Checkout and tax',
    description: 'Applied at checkout. Changing these changes what customers pay.',
    fields: [
      {
        key: 'checkout.taxProvider',
        label: 'Tax provider',
        type: 'text',
        hint: 'taxjar or estimated',
      },
      { key: 'checkout.reservationMinutes', label: 'Stock reservation (minutes)', type: 'number' },
      { key: 'checkout.guestCheckout', label: 'Allow guest checkout (on/off)', type: 'text' },
    ],
  },
  {
    group: 'features',
    title: 'Feature flags',
    description: 'On or off. Read at request time, so no deploy is needed.',
    fields: [
      { key: 'feature.reviews', label: 'Product reviews (on/off)', type: 'text' },
      { key: 'feature.wishlist', label: 'Wishlist (on/off)', type: 'text' },
      { key: 'feature.loyalty', label: 'Loyalty programme (on/off)', type: 'text' },
      { key: 'feature.giftCards', label: 'Gift cards at checkout (on/off)', type: 'text' },
    ],
  },
] as const;

export default async function AdminSettingsPage() {
  const user = await requireAdminPermission(PERMISSIONS.settingsRead);
  const settings = await getSettingsMap();
  const canWrite = can(user, PERMISSIONS.settingsWrite);

  const integrations = [
    {
      label: 'Payments (Klarna)',
      env: 'KLARNA_USERNAME',
      set: Boolean(process.env.KLARNA_USERNAME),
    },
    { label: 'Email (Resend)', env: 'RESEND_API_KEY', set: Boolean(process.env.RESEND_API_KEY) },
    { label: 'Tax (TaxJar)', env: 'TAXJAR_API_KEY', set: Boolean(process.env.TAXJAR_API_KEY) },
    {
      label: 'Media (Cloudinary)',
      env: 'CLOUDINARY_API_KEY',
      set: Boolean(process.env.CLOUDINARY_API_KEY),
    },
    { label: 'Database', env: 'DATABASE_URL', set: Boolean(process.env.DATABASE_URL) },
  ];

  return (
    <>
      <AdminPageHeader
        title="Settings"
        description={`${siteConfig.legalName} · ${siteConfig.currency} · ${siteConfig.country}`}
        pathname="/admin/settings"
      />

      <div className="space-y-6">
        {GROUPS.map((group) => (
          <AdminCard key={group.group} title={group.title} description={group.description}>
            <form action={saveSettingsAction} className="space-y-4">
              <input type="hidden" name="group" value={group.group} />

              <div className="grid gap-4 sm:grid-cols-2">
                {group.fields.map((field) => (
                  <div key={field.key}>
                    <label htmlFor={field.key} className="mb-1.5 block text-body-sm font-medium">
                      {field.label}
                    </label>
                    <input
                      id={field.key}
                      // The action only writes keys with this prefix — an
                      // allow-list, so a stray hidden field cannot write itself
                      // into the settings table.
                      name={`setting.${field.key}`}
                      type={field.type}
                      defaultValue={String(settings[field.key] ?? '')}
                      disabled={!canWrite}
                      className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-body-sm disabled:opacity-60"
                    />
                    {'hint' in field && field.hint ? (
                      <p className="text-body-xs mt-1 text-foreground-subtle">{field.hint}</p>
                    ) : null}
                  </div>
                ))}
              </div>

              {canWrite ? (
                <button
                  type="submit"
                  className="rounded-lg bg-accent px-4 py-2.5 text-body-sm font-medium text-white hover:bg-accent-hover"
                >
                  Save {group.title.toLowerCase()}
                </button>
              ) : (
                <p className="text-body-xs text-foreground-subtle">
                  Read-only. Changing settings needs the settings permission.
                </p>
              )}
            </form>
          </AdminCard>
        ))}

        <AdminCard title="Integrations" description="Configured in the environment, never here.">
          <dl className="space-y-3 text-body-sm">
            {integrations.map((integration) => (
              <div key={integration.env} className="flex items-center justify-between gap-3">
                <dt>
                  {integration.label}
                  <span className="text-body-xs block font-mono text-foreground-subtle">
                    {integration.env}
                  </span>
                </dt>
                <dd>
                  <StatusPill
                    label={integration.set ? 'Connected' : 'Not configured'}
                    tone={integration.set ? 'success' : 'warning'}
                  />
                </dd>
              </div>
            ))}
          </dl>

          <p className="text-body-xs mt-4 text-foreground-subtle">
            Only whether a key is present is shown, never the key. The settings table is readable by
            every process holding a database connection and appears in every backup — a secret in it
            is a secret in all of those.
          </p>
        </AdminCard>

        <AdminCard title="Legal pages">
          <p className="text-body-sm text-foreground-muted">
            Terms and Privacy are managed in code, in{' '}
            <code className="text-body-xs rounded bg-surface-muted px-1">
              src/features/legal/documents.ts
            </code>
            , because they describe what the system actually does and are checked against it. Both
            are still drafts pending legal review — see docs/quality.md.
          </p>
        </AdminCard>
      </div>
    </>
  );
}
