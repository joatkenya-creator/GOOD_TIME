import type { Metadata } from 'next';

import { StatusPill } from '@/components/admin/data-table';
import { AdminCard, AdminPageHeader } from '@/components/admin/page-header';
import { StatCard } from '@/components/admin/stat-card';
import { PERMISSIONS } from '@/constants/permissions';
import {
  deleteSynonymAction,
  reindexAction,
  saveSynonymAction,
} from '@/server/actions/admin/platform';
import { requireAdminPermission } from '@/server/auth/admin';
import { can } from '@/server/auth/session';
import { listSynonyms, searchAnalytics, searchIndexStats } from '@/services/admin/platform.service';
import { searchEngine } from '@/services/search/engine';

export const metadata: Metadata = { title: 'Search' };

/**
 * Search analytics and tuning.
 *
 * The zero-result list is the commercially valuable half of this screen: every
 * entry is demand the catalogue cannot serve, named by a customer in their own
 * words. A synonym fixes the ones that are vocabulary mismatches; the rest are
 * a buying list.
 */
export default async function AdminSearchPage() {
  const user = await requireAdminPermission(PERMISSIONS.analyticsRead);

  const [analytics, synonyms, index] = await Promise.all([
    searchAnalytics(30),
    listSynonyms(),
    searchIndexStats(),
  ]);

  const canManage = can(user, PERMISSIONS.searchManage);

  return (
    <>
      <AdminPageHeader
        title="Search"
        description={`${searchEngine().name} engine · ${index.documents.toLocaleString()} documents indexed`}
        pathname="/admin/search"
        actions={
          canManage ? (
            <form action={reindexAction}>
              <button
                type="submit"
                className="rounded-lg border border-border bg-surface px-3 py-2 text-body-sm font-medium hover:bg-surface-muted"
              >
                Rebuild index
              </button>
            </form>
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Searches, 30 days"
          value={analytics.totalSearches.toLocaleString()}
          changePercent={null}
        />
        <StatCard
          label="Found nothing"
          value={`${analytics.zeroResultRate}%`}
          hint="Share of searches with no results"
          changePercent={null}
          invertTrend
        />
        <StatCard
          label="Average results"
          value={String(analytics.averageResults)}
          changePercent={null}
        />
        <StatCard
          label="Not indexed"
          value={String(index.missing)}
          hint="Live products search cannot find"
          changePercent={null}
          invertTrend
        />
      </div>

      {index.missing > 0 || index.stale > 0 ? (
        <div
          role="status"
          className="mt-4 rounded-xl border border-warning-700/30 bg-warning-50 p-4 text-body-sm text-warning-700"
        >
          {index.missing > 0
            ? `${index.missing} live products have no search document, so nobody can find them. `
            : ''}
          {index.stale > 0
            ? `${index.stale} documents belong to products that are no longer live. `
            : ''}
          Rebuilding the index fixes both.
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <AdminCard title="Found nothing" description="Demand the catalogue cannot serve">
          {analytics.noResults.length === 0 ? (
            <p className="py-6 text-center text-body-sm text-foreground-subtle">
              Every search returned something.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {analytics.noResults.map((row) => (
                <li
                  key={row.term}
                  className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                >
                  <span className="truncate text-body-sm">{row.term}</span>
                  <span className="shrink-0 text-body-xs tabular-nums text-foreground-subtle">
                    {row.searches} searches
                  </span>
                </li>
              ))}
            </ul>
          )}
        </AdminCard>

        <AdminCard title="Most searched">
          {analytics.popular.length === 0 ? (
            <p className="py-6 text-center text-body-sm text-foreground-subtle">
              No searches recorded yet.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {analytics.popular.slice(0, 20).map((row) => (
                <li
                  key={row.term}
                  className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                >
                  <span className="truncate text-body-sm">{row.term}</span>
                  <span className="shrink-0 text-body-xs tabular-nums text-foreground-subtle">
                    {row.searches} searches · {row.averageResults} results
                  </span>
                </li>
              ))}
            </ul>
          )}
        </AdminCard>
      </div>

      <AdminCard
        title="Synonyms"
        description="Customer vocabulary mapped onto the catalogue"
        className="mt-6"
      >
        {synonyms.length > 0 ? (
          <ul className="mb-4 divide-y divide-border">
            {synonyms.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 py-2 first:pt-0">
                <div className="min-w-0">
                  <p className="truncate text-body-sm">
                    <span className="font-medium">{row.term}</span>
                    <span className="text-foreground-subtle">
                      {row.isOneWay ? ' becomes ' : ' matches '}
                    </span>
                    {row.synonyms.join(', ')}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusPill label={row.isOneWay ? 'One-way' : 'Two-way'} tone="neutral" />
                  {canManage ? (
                    <form action={deleteSynonymAction}>
                      <input type="hidden" name="id" value={row.id} />
                      <button
                        type="submit"
                        className="rounded-lg border border-border px-2 py-1 text-body-xs text-foreground-muted hover:bg-danger-50 hover:text-danger-700"
                      >
                        Delete
                      </button>
                    </form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        {canManage ? (
          <form action={saveSynonymAction} className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <label htmlFor="term" className="mb-1 block text-body-xs font-medium">
                Term
              </label>
              <input
                id="term"
                name="term"
                required
                placeholder="bullet"
                className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-body-xs"
              />
            </div>
            <div className="min-w-0 flex-[2]">
              <label htmlFor="synonyms" className="mb-1 block text-body-xs font-medium">
                Also matches
              </label>
              <input
                id="synonyms"
                name="synonyms"
                required
                placeholder="mini vibrator, lipstick vibe"
                className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-body-xs"
              />
            </div>
            <label className="flex h-9 items-center gap-1.5 text-body-xs">
              <input
                type="checkbox"
                name="isOneWay"
                className="size-3.5 rounded border-border-strong text-accent"
              />
              One-way
            </label>
            <button
              type="submit"
              className="h-9 rounded-lg bg-accent px-3 text-body-xs font-medium text-white hover:bg-accent-hover"
            >
              Add
            </button>
          </form>
        ) : null}

        <p className="mt-3 text-body-xs text-foreground-subtle">
          One-way means a search for &ldquo;vibrator&rdquo; also finds bullets, without a search for
          &ldquo;bullet&rdquo; returning every vibrator in the catalogue.
        </p>
      </AdminCard>
    </>
  );
}
