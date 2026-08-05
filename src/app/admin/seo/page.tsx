import type { Metadata } from 'next';
import Link from 'next/link';

import { StatusPill } from '@/components/admin/data-table';
import { AdminCard, AdminPageHeader } from '@/components/admin/page-header';
import { PERMISSIONS } from '@/constants/permissions';
import { formatDate } from '@/features/admin/query';
import { deleteRedirectAction, saveRedirectAction } from '@/server/actions/admin/content';
import { requireAdminPermission } from '@/server/auth/admin';
import { listRedirects } from '@/services/admin/content-admin.service';

export const metadata: Metadata = { title: 'SEO' };

/**
 * SEO: redirects and the sitemap.
 *
 * Per-record metadata is edited where the record is — a product's meta title
 * belongs on the product editor, next to the name it defaults to. A separate
 * "SEO" screen listing every product's tags is a screen nobody keeps current.
 * What genuinely has no other home is here.
 */
export default async function AdminSeoPage() {
  await requireAdminPermission(PERMISSIONS.seoWrite);
  const redirects = await listRedirects();

  const active = redirects.filter((redirect) => redirect.isActive).length;

  return (
    <>
      <AdminPageHeader
        title="SEO"
        description="Redirects and indexing. Per-record metadata lives on each record's own editor."
        pathname="/admin/seo"
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="space-y-6">
          <AdminCard title="Redirects" description={`${active} active of ${redirects.length}`}>
            {redirects.length === 0 ? (
              <p className="py-8 text-center text-body-sm text-foreground-subtle">
                No redirects. Add one whenever you change a slug — the old URL keeps its inbound
                links and its ranking only if something forwards it.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] text-left text-body-sm">
                  <thead>
                    <tr className="text-body-xs border-b border-border tracking-wide text-foreground-subtle uppercase">
                      <th scope="col" className="py-2 pr-3">
                        From
                      </th>
                      <th scope="col" className="py-2 pr-3">
                        To
                      </th>
                      <th scope="col" className="py-2 pr-3">
                        Type
                      </th>
                      <th scope="col" className="py-2 pr-3 text-right">
                        Hits
                      </th>
                      <th scope="col" className="py-2 text-right">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {redirects.map((redirect) => (
                      <tr key={redirect.id} className="border-b border-border last:border-0">
                        <td className="text-body-xs py-2.5 pr-3 font-mono">{redirect.source}</td>
                        <td className="text-body-xs py-2.5 pr-3 font-mono text-foreground-muted">
                          {redirect.destination}
                        </td>
                        <td className="py-2.5 pr-3">
                          <StatusPill
                            label={redirect.statusCode === 301 ? '301' : '302'}
                            tone={redirect.statusCode === 301 ? 'info' : 'neutral'}
                          />
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">
                          {redirect.hits}
                          {redirect.lastHitAt ? (
                            <span className="text-body-xs block text-foreground-subtle">
                              {formatDate(redirect.lastHitAt)}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2.5 text-right">
                          <form action={deleteRedirectAction}>
                            <input type="hidden" name="id" value={redirect.id} />
                            <button
                              type="submit"
                              className="text-body-xs rounded-lg border border-border px-2 py-1 text-foreground-muted hover:bg-danger-50 hover:text-danger-700"
                            >
                              Delete
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </AdminCard>

          <AdminCard title="Sitemap and robots">
            <dl className="space-y-3 text-body-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-foreground-muted">Sitemap</dt>
                <dd>
                  <Link
                    href="/sitemap.xml"
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent-text underline"
                  >
                    /sitemap.xml
                  </Link>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-foreground-muted">Robots</dt>
                <dd>
                  <Link
                    href="/robots.txt"
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent-text underline"
                  >
                    /robots.txt
                  </Link>
                </dd>
              </div>
            </dl>

            <p className="text-body-xs mt-4 text-foreground-subtle">
              The sitemap is generated from live categories, products and legal pages on request —
              there is nothing to regenerate. Every URL it publishes is fetched by{' '}
              <code className="rounded bg-surface-muted px-1">npm run verify:quality</code>, because
              a sitemap listing 404s costs crawl budget and reads as a low-quality site.
            </p>
          </AdminCard>
        </div>

        <AdminCard title="New redirect">
          <form action={saveRedirectAction} className="space-y-3">
            <div>
              <label htmlFor="redirect-source" className="mb-1.5 block text-body-sm font-medium">
                From
              </label>
              <input
                id="redirect-source"
                name="source"
                required
                placeholder="/old-path"
                className="text-body-xs h-10 w-full rounded-lg border border-border bg-surface px-3 font-mono"
              />
            </div>

            <div>
              <label
                htmlFor="redirect-destination"
                className="mb-1.5 block text-body-sm font-medium"
              >
                To
              </label>
              <input
                id="redirect-destination"
                name="destination"
                required
                placeholder="/shop/new-path"
                className="text-body-xs h-10 w-full rounded-lg border border-border bg-surface px-3 font-mono"
              />
            </div>

            <div>
              <label htmlFor="redirect-code" className="mb-1.5 block text-body-sm font-medium">
                Type
              </label>
              <select
                id="redirect-code"
                name="statusCode"
                className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-body-sm"
              >
                <option value="301">Permanent (308)</option>
                <option value="302">Temporary (307)</option>
              </select>
              <p className="text-body-xs mt-1 text-foreground-subtle">
                Permanent redirects are cached by browsers for months — use temporary if you might
                change your mind. Served as 308 and 307, which Google treats identically to 301 and
                302 and which additionally preserve the request method.
              </p>
            </div>

            <div>
              <label htmlFor="redirect-note" className="mb-1.5 block text-body-sm font-medium">
                Note
              </label>
              <input
                id="redirect-note"
                name="note"
                placeholder="Why this exists"
                className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-body-sm"
              />
            </div>

            <button
              type="submit"
              className="w-full rounded-lg bg-accent px-4 py-2.5 text-body-sm font-medium text-white hover:bg-accent-hover"
            >
              Add redirect
            </button>

            <p className="text-body-xs text-foreground-subtle">
              Chains are refused at save: if the destination already redirects somewhere, point this
              one straight at the final URL instead.
            </p>
          </form>
        </AdminCard>
      </div>
    </>
  );
}
