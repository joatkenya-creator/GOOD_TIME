import type { Metadata } from 'next';

import { StatusPill } from '@/components/admin/data-table';
import { AdminCard, AdminPageHeader } from '@/components/admin/page-header';
import { PERMISSIONS } from '@/constants/permissions';
import { formatDate } from '@/features/admin/query';
import { saveCollectionAction } from '@/server/actions/admin/catalogue';
import { requireAdminPermission } from '@/server/auth/admin';
import { can } from '@/server/auth/session';
import {
  isAutomatic,
  listCategoryTree,
  listCollections,
} from '@/services/admin/catalogue-admin.service';

export const metadata: Metadata = { title: 'Collections' };

/**
 * Collections: manual and rule-driven, plus scheduling.
 *
 * A collection with rules is automatic; one without is hand-picked. That is one
 * nullable column rather than a type enum beside a rules column, because two
 * fields that can contradict each other eventually do.
 */
export default async function AdminCollectionsPage() {
  const user = await requireAdminPermission(PERMISSIONS.productRead);
  const [collections, categories] = await Promise.all([listCollections(), listCategoryTree()]);
  const canWrite = can(user, PERMISSIONS.collectionWrite);

  return (
    <>
      <AdminPageHeader
        title="Collections"
        description="Curated groupings, hand-picked or driven by rules."
        pathname="/admin/collections"
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <AdminCard title={`${collections.length} collections`}>
          {collections.length === 0 ? (
            <p className="py-8 text-center text-body-sm text-foreground-subtle">
              No collections yet.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {collections.map((collection) => {
                return (
                  <li key={collection.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-body-sm font-medium">
                        {collection.title}
                      </p>

                      <StatusPill
                        label={isAutomatic(collection) ? 'Automatic' : 'Manual'}
                        tone={isAutomatic(collection) ? 'info' : 'neutral'}
                      />

                      <StatusPill
                        label={
                          { live: 'Live', scheduled: 'Scheduled', ended: 'Ended', hidden: 'Hidden' }[
                            collection.state
                          ]
                        }
                        tone={
                          (
                            {
                              live: 'success',
                              scheduled: 'info',
                              ended: 'neutral',
                              hidden: 'neutral',
                            } as const
                          )[collection.state]
                        }
                      />
                    </div>

                    <p className="mt-0.5 truncate text-body-xs text-foreground-subtle">
                      /{collection.slug} ·{' '}
                      {isAutomatic(collection)
                        ? 'membership resolved on read'
                        : `${collection._count.products} products`}
                      {collection.startsAt ? ` · from ${formatDate(collection.startsAt)}` : ''}
                      {collection.endsAt ? ` until ${formatDate(collection.endsAt)}` : ''}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </AdminCard>

        {canWrite ? (
          <AdminCard title="New collection">
            <form action={saveCollectionAction} className="space-y-4">
              <div>
                <label htmlFor="col-title" className="mb-1.5 block text-body-sm font-medium">
                  Title
                </label>
                <input
                  id="col-title"
                  name="title"
                  required
                  maxLength={160}
                  className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-body-sm"
                />
              </div>

              <div>
                <label htmlFor="col-slug" className="mb-1.5 block text-body-sm font-medium">
                  URL segment
                </label>
                <input
                  id="col-slug"
                  name="slug"
                  required
                  maxLength={160}
                  className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-body-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="col-starts" className="mb-1.5 block text-body-sm font-medium">
                    Starts
                  </label>
                  <input
                    id="col-starts"
                    name="startsAt"
                    type="datetime-local"
                    className="h-10 w-full rounded-lg border border-border bg-surface px-2 text-body-xs"
                  />
                </div>
                <div>
                  <label htmlFor="col-ends" className="mb-1.5 block text-body-sm font-medium">
                    Ends
                  </label>
                  <input
                    id="col-ends"
                    name="endsAt"
                    type="datetime-local"
                    className="h-10 w-full rounded-lg border border-border bg-surface px-2 text-body-xs"
                  />
                </div>
              </div>

              <fieldset className="rounded-lg border border-border p-3">
                <legend className="px-1 text-body-xs font-medium">Automatic membership</legend>

                <label className="flex items-center gap-2.5 text-body-sm">
                  <input
                    type="checkbox"
                    name="isAutomatic"
                    className="size-4 rounded border-border-strong text-accent"
                  />
                  Pick products by rule
                </label>

                <p className="mt-1.5 mb-3 text-body-xs text-foreground-subtle">
                  Rules are evaluated when the page is read, so a product leaving a sale drops out
                  immediately.
                </p>

                <label htmlFor="rule-category" className="mb-1 block text-body-xs">
                  In category
                </label>
                <select
                  id="rule-category"
                  name="ruleCategoryId"
                  defaultValue=""
                  className="mb-2.5 h-9 w-full rounded-lg border border-border bg-surface px-2 text-body-xs"
                >
                  <option value="">Any</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.path}
                    </option>
                  ))}
                </select>

                <label className="flex items-center gap-2 text-body-xs">
                  <input
                    type="checkbox"
                    name="ruleOnSale"
                    className="size-3.5 rounded border-border-strong text-accent"
                  />
                  On sale
                </label>

                <label className="mt-1.5 flex items-center gap-2 text-body-xs">
                  <input
                    type="checkbox"
                    name="ruleNewArrival"
                    className="size-3.5 rounded border-border-strong text-accent"
                  />
                  New arrival
                </label>

                <label htmlFor="rule-max" className="mt-2.5 mb-1 block text-body-xs">
                  Under ($)
                </label>
                <input
                  id="rule-max"
                  name="ruleMaxPrice"
                  type="number"
                  step="0.01"
                  className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-body-xs"
                />
              </fieldset>

              <label className="flex items-center gap-2.5 text-body-sm">
                <input
                  type="checkbox"
                  name="isActive"
                  defaultChecked
                  className="size-4 rounded border-border-strong text-accent"
                />
                Visible on the storefront
              </label>

              <button
                type="submit"
                className="w-full rounded-lg bg-accent px-4 py-2.5 text-body-sm font-medium text-white hover:bg-accent-hover"
              >
                Create collection
              </button>
            </form>
          </AdminCard>
        ) : null}
      </div>
    </>
  );
}
