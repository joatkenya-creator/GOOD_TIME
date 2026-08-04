import type { Metadata } from 'next';
import Link from 'next/link';

import { TablePagination } from '@/components/admin/data-table';
import { ListToolbar } from '@/components/admin/list-toolbar';
import { AdminPageHeader } from '@/components/admin/page-header';
import { PERMISSIONS } from '@/constants/permissions';
import { type RawSearchParams, buildListHref, parseListParams } from '@/features/admin/query';
import { deleteMediaAction, updateMediaAltAction } from '@/server/actions/admin/catalogue';
import { requireAdminPermission } from '@/server/auth/admin';
import { can } from '@/server/auth/session';
import { listMedia, listMediaFolders } from '@/services/admin/catalogue-admin.service';

export const metadata: Metadata = { title: 'Media' };

const BASE = '/admin/media';

/**
 * The media library.
 *
 * A grid rather than a table: the whole point of this screen is recognising an
 * image, and a filename in a row does not help anyone do that.
 *
 * Alt text is edited inline, per asset, because it is the field most likely to
 * be missing and least likely to be fixed if it needs a second screen. Every
 * image on the storefront is a product someone might be buying without being
 * able to see it.
 */
export default async function AdminMediaPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requireAdminPermission(PERMISSIONS.mediaRead);
  const params = parseListParams(await searchParams, { pageSize: 40 });

  const [result, folders] = await Promise.all([
    listMedia({
      q: params.q,
      folder: params.extra.folder,
      type: params.status,
      page: params.page,
      pageSize: params.pageSize,
    }),
    listMediaFolders(),
  ]);

  const canWrite = can(user, PERMISSIONS.mediaWrite);
  const canDelete = can(user, PERMISSIONS.mediaDelete);
  const missingAlt = result.items.filter((asset) => !asset.alt).length;

  return (
    <>
      <AdminPageHeader
        title="Media"
        description={`${result.total} assets.${missingAlt > 0 ? ` ${missingAlt} on this page have no alt text.` : ''}`}
        pathname={BASE}
        actions={
          canWrite ? (
            <Link
              href="/admin/media/upload"
              className="rounded-lg bg-accent px-4 py-2 text-body-sm font-medium text-white hover:bg-accent-hover"
            >
              Upload
            </Link>
          ) : null
        }
      />

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <ListToolbar
          basePath={BASE}
          params={params}
          placeholder="Alt text or file name…"
          statuses={[
            { value: '', label: 'All' },
            { value: 'IMAGE', label: 'Images' },
            { value: 'VIDEO', label: 'Video' },
            { value: 'DOCUMENT', label: 'Documents' },
          ]}
        >
          {folders.length > 0 ? (
            <div>
              <label htmlFor="folder-filter" className="sr-only">
                Folder
              </label>
              <select
                id="folder-filter"
                name="folder"
                defaultValue={params.extra.folder ?? ''}
                className="h-10 rounded-lg border border-border bg-surface px-3 text-body-sm"
              >
                <option value="">All folders</option>
                {folders.map((folder) => (
                  <option key={folder.folder} value={folder.folder}>
                    {folder.folder} ({folder.count})
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </ListToolbar>

        {result.items.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <p className="text-body font-medium">No media yet.</p>
            <p className="mt-1 text-body-sm text-foreground-subtle">
              Images uploaded here can be attached to products, categories and posts.
            </p>
          </div>
        ) : (
          <form action={deleteMediaAction}>
            {canDelete ? (
              <div className="flex items-center gap-3 border-b border-border bg-surface-muted px-4 py-3">
                <p className="text-body-xs text-foreground-subtle">
                  Tick assets, then delete. Anything still attached to a product is skipped.
                </p>
                <button
                  type="submit"
                  className="ml-auto rounded-lg border border-danger-700/30 px-3 py-1.5 text-body-xs font-medium text-danger-700 hover:bg-danger-50"
                >
                  Delete selected
                </button>
              </div>
            ) : null}

            <ul className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {result.items.map((asset) => (
                <li key={asset.id} className="overflow-hidden rounded-lg border border-border">
                  <div className="relative">
                    {canDelete ? (
                      <label className="absolute top-2 left-2 z-10 flex size-6 items-center justify-center rounded bg-surface/90">
                        <input
                          type="checkbox"
                          name="selected"
                          value={asset.id}
                          className="size-4 rounded border-border-strong text-accent"
                        />
                        <span className="sr-only">Select {asset.alt ?? asset.publicId}</span>
                      </label>
                    ) : null}

                    {asset.type === 'IMAGE' ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={asset.url}
                        alt={asset.alt ?? ''}
                        className="aspect-square w-full bg-surface-muted object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="grid aspect-square w-full place-items-center bg-surface-muted text-body-xs text-foreground-subtle">
                        {asset.format?.toUpperCase() ?? asset.type}
                      </div>
                    )}
                  </div>

                  <div className="p-2.5">
                    {canWrite ? (
                      <>
                        <label htmlFor={`alt-${asset.id}`} className="sr-only">
                          Alt text for {asset.publicId}
                        </label>
                        {/*
                          Its own form, nested outside the delete form's submit
                          path — HTML forms cannot nest, so this uses the
                          `form` attribute pattern via a sibling element.
                        */}
                        <input
                          id={`alt-${asset.id}`}
                          form={`alt-form-${asset.id}`}
                          name="alt"
                          defaultValue={asset.alt ?? ''}
                          placeholder="Describe this image"
                          className={`h-8 w-full rounded border px-2 text-body-xs ${
                            asset.alt ? 'border-border' : 'border-warning-700/40 bg-warning-50'
                          }`}
                        />
                      </>
                    ) : (
                      <p className="truncate text-body-xs text-foreground-subtle">
                        {asset.alt ?? 'No alt text'}
                      </p>
                    )}

                    <p className="mt-1.5 truncate text-body-xs text-foreground-subtle">
                      {asset.width && asset.height ? `${asset.width}×${asset.height}` : asset.type}
                      {asset._count.productMedia > 0
                        ? ` · used ${asset._count.productMedia}×`
                        : ' · unused'}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </form>
        )}

        {/*
          The alt-text forms live outside the delete form, because HTML forbids
          nesting one form inside another — the inputs reference them by id.
        */}
        {canWrite
          ? result.items.map((asset) => (
              <form
                key={`alt-form-${asset.id}`}
                id={`alt-form-${asset.id}`}
                action={updateMediaAltAction}
                className="hidden"
              >
                <input type="hidden" name="id" value={asset.id} />
              </form>
            ))
          : null}

        <TablePagination
          page={result.page}
          totalPages={result.totalPages}
          total={result.total}
          buildHref={(page) => buildListHref(BASE, params, { page })}
        />
      </div>
    </>
  );
}
