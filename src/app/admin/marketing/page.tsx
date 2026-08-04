import type { Metadata } from 'next';
import Link from 'next/link';

import { StatusPill } from '@/components/admin/data-table';
import { AdminCard, AdminPageHeader } from '@/components/admin/page-header';
import { PERMISSIONS } from '@/constants/permissions';
import { formatDateTime } from '@/features/admin/query';
import { saveIntegrationAction } from '@/server/actions/admin/platform';
import { requireAdminPermission } from '@/server/auth/admin';
import { can } from '@/server/auth/session';
import { allIntegrations } from '@/services/marketing/integrations';
import { merchantFeedHealth } from '@/services/seo/feeds';

export const metadata: Metadata = { title: 'Marketing' };

/**
 * Marketing integrations.
 *
 * Every advertising tag here is a third party watching someone browse intimate
 * products. That is why consent defaults to required, why the switch is off
 * until deliberately turned on, and why the copy says plainly what each one
 * does rather than calling it "improving your experience".
 */
export default async function AdminMarketingPage() {
  const user = await requireAdminPermission(PERMISSIONS.settingsRead);

  const [integrations, feed] = await Promise.all([allIntegrations(), merchantFeedHealth()]);

  const canManage = can(user, PERMISSIONS.marketingManage);
  const enabled = integrations.filter((entry) => entry.stored?.isEnabled).length;

  return (
    <>
      <AdminPageHeader
        title="Marketing"
        description={`${enabled} of ${integrations.length} integrations enabled.`}
        pathname="/admin/marketing"
      />

      <AdminCard title="Google Merchant Center" description="The product feed Google reads">
        <dl className="grid gap-3 sm:grid-cols-4">
          <div>
            <dt className="text-body-xs text-foreground-subtle">Eligible</dt>
            <dd className="text-display-xs font-semibold tabular-nums">{feed.eligible}</dd>
          </div>
          <div>
            <dt className="text-body-xs text-foreground-subtle">No image</dt>
            <dd className="text-display-xs font-semibold tabular-nums text-warning-700">
              {feed.skippedNoImage}
            </dd>
          </div>
          <div>
            <dt className="text-body-xs text-foreground-subtle">No description</dt>
            <dd className="text-display-xs font-semibold tabular-nums text-warning-700">
              {feed.skippedNoDescription}
            </dd>
          </div>
          <div>
            <dt className="text-body-xs text-foreground-subtle">No price</dt>
            <dd className="text-display-xs font-semibold tabular-nums text-warning-700">
              {feed.skippedNoPrice}
            </dd>
          </div>
        </dl>

        <p className="mt-4 text-body-sm text-foreground-muted">
          The feed lives at{' '}
          <Link href="/feeds/merchant.xml" target="_blank" className="text-accent-text underline">
            /feeds/merchant.xml
          </Link>
          . Products missing an image, a price or a description are left out rather than submitted
          incomplete — Merchant Center rejects those anyway, and a feed with a 40% rejection rate
          buries the items that genuinely need fixing.
        </p>

        <p className="mt-2 text-body-xs text-foreground-subtle">
          Every item is submitted with <code className="rounded bg-surface-muted px-1">adult: yes</code>{' '}
          unless a product is explicitly marked otherwise. Getting that wrong risks the whole
          Merchant account, not one listing.
        </p>
      </AdminCard>

      <div className="mt-6 space-y-4">
        {integrations.map((integration) => {
          const stored = integration.stored;
          const isEnabled = stored?.isEnabled ?? false;

          return (
            <AdminCard
              key={integration.provider}
              title={integration.label}
              description={integration.hint}
              actions={
                <StatusPill
                  label={isEnabled ? 'Enabled' : 'Off'}
                  tone={isEnabled ? 'success' : 'neutral'}
                />
              }
            >
              {canManage ? (
                <form action={saveIntegrationAction} className="space-y-3">
                  <input type="hidden" name="provider" value={integration.provider} />

                  <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
                    <div>
                      <label
                        htmlFor={`id-${integration.provider}`}
                        className="mb-1.5 block text-body-sm font-medium"
                      >
                        {integration.idLabel}
                      </label>
                      <input
                        id={`id-${integration.provider}`}
                        name="publicId"
                        defaultValue={stored?.publicId ?? ''}
                        placeholder={integration.idPattern ? String(integration.idPattern.source).replace(/[\^$\\]/g, '') : ''}
                        className="h-10 w-full rounded-lg border border-border bg-surface px-3 font-mono text-body-xs"
                      />
                    </div>

                    <label className="flex h-10 items-center gap-2 text-body-sm">
                      <input
                        type="checkbox"
                        name="isEnabled"
                        defaultChecked={isEnabled}
                        className="size-4 rounded border-border-strong text-accent"
                      />
                      Enabled
                    </label>

                    <button
                      type="submit"
                      className="h-10 rounded-lg bg-accent px-4 text-body-sm font-medium text-white hover:bg-accent-hover"
                    >
                      Save
                    </button>
                  </div>

                  <label className="flex items-start gap-2.5 text-body-sm">
                    <input
                      type="checkbox"
                      name="requiresConsent"
                      value="on"
                      defaultChecked={stored?.requiresConsent ?? integration.consentByDefault}
                      className="mt-0.5 size-4 rounded border-border-strong text-accent"
                    />
                    <span>
                      Wait for consent
                      <span className="block text-body-xs text-foreground-subtle">
                        {integration.consentByDefault
                          ? 'This tag sends browsing data to a third party. Turning this off is a decision to make with legal advice.'
                          : 'This one sets no cookies and identifies nobody, so it can load immediately.'}
                      </span>
                    </span>
                  </label>

                  {stored?.updatedBy ? (
                    <p className="text-body-xs text-foreground-subtle">
                      Last changed by {stored.updatedBy.firstName ?? stored.updatedBy.email} on{' '}
                      {formatDateTime(stored.updatedAt)}
                    </p>
                  ) : null}
                </form>
              ) : (
                <dl className="space-y-2 text-body-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-foreground-muted">{integration.idLabel}</dt>
                    <dd className="font-mono text-body-xs">{stored?.publicId ?? 'Not set'}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-foreground-muted">Consent</dt>
                    <dd>{stored?.requiresConsent === false ? 'Not required' : 'Required'}</dd>
                  </div>
                </dl>
              )}
            </AdminCard>
          );
        })}
      </div>

      <AdminCard title="Where the secrets are" className="mt-6">
        <p className="text-body-sm text-foreground-muted">
          Only public identifiers are stored here — a measurement id or a pixel id is emitted into
          the page for anyone to read, so keeping it in the database is not a leak. API secrets, the
          Merchant Center service account and the Ads developer token stay in the environment, where
          the settings screen cannot show them and a database backup does not carry them.
        </p>
      </AdminCard>
    </>
  );
}
