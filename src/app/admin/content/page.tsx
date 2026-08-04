import type { Metadata } from 'next';

import { StatusPill } from '@/components/admin/data-table';
import { AdminCard, AdminPageHeader } from '@/components/admin/page-header';
import { PERMISSIONS } from '@/constants/permissions';
import { formatDate } from '@/features/admin/query';
import { POST_STATUS_TONE, humaniseEnum } from '@/features/admin/status';
import {
  addMenuItemAction,
  deleteContentBlockAction,
  deleteMenuItemAction,
  savePageAction,
  saveContentBlockAction,
} from '@/server/actions/admin/content';
import { requireAdminPermission } from '@/server/auth/admin';
import { can } from '@/server/auth/session';
import { listContentBlocks, listMenus, listPages } from '@/services/admin/content-admin.service';

export const metadata: Metadata = { title: 'Content' };

const BLOCK_LABELS = {
  ANNOUNCEMENT: 'Announcement bar',
  HOME_BANNER: 'Homepage banner',
  FAQ: 'FAQ',
  FOOTER_LINK: 'Footer link',
} as const;

/**
 * The lightweight CMS: pages, announcements, banners, FAQs, footer links, menus.
 *
 * Four of those are one table with a `type`, because they differ only in where
 * they render. Four near-identical tables would have meant four near-identical
 * screens and four migrations the next time one needed a scheduling window.
 */
export default async function AdminContentPage() {
  const user = await requireAdminPermission(PERMISSIONS.contentRead);

  const [pages, blocks, menus] = await Promise.all([listPages(), listContentBlocks(), listMenus()]);
  const canWrite = can(user, PERMISSIONS.contentWrite);

  const grouped = (Object.keys(BLOCK_LABELS) as (keyof typeof BLOCK_LABELS)[]).map((type) => ({
    type,
    label: BLOCK_LABELS[type],
    items: blocks.filter((block) => block.type === type),
  }));

  return (
    <>
      <AdminPageHeader
        title="Content"
        description="Pages, announcements, banners, FAQs and navigation."
        pathname="/admin/content"
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="space-y-6">
          <AdminCard title="Pages" description={`${pages.length} standalone pages`}>
            {pages.length === 0 ? (
              <p className="py-6 text-center text-body-sm text-foreground-subtle">
                No pages yet. Terms and Privacy are code-managed — see docs/quality.md.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {pages.map((page) => (
                  <li key={page.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate text-body-sm font-medium">{page.title}</p>
                      <p className="truncate text-body-xs text-foreground-subtle">
                        /pages/{page.slug} · updated {formatDate(page.updatedAt)}
                      </p>
                    </div>
                    <StatusPill
                      label={humaniseEnum(page.status)}
                      tone={POST_STATUS_TONE[page.status]}
                    />
                  </li>
                ))}
              </ul>
            )}
          </AdminCard>

          {grouped.map((group) => (
            <AdminCard key={group.type} title={group.label} description={`${group.items.length} items`}>
              {group.items.length === 0 ? (
                <p className="py-4 text-center text-body-sm text-foreground-subtle">None yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {group.items.map((block) => (
                    <li key={block.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="truncate text-body-sm font-medium">{block.title}</p>
                        {block.body ? (
                          <p className="truncate text-body-xs text-foreground-subtle">{block.body}</p>
                        ) : null}
                        {block.startsAt || block.endsAt ? (
                          <p className="text-body-xs text-foreground-subtle">
                            {block.startsAt ? `from ${formatDate(block.startsAt)}` : ''}
                            {block.endsAt ? ` until ${formatDate(block.endsAt)}` : ''}
                          </p>
                        ) : null}
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <StatusPill
                          label={block.isActive ? 'Live' : 'Hidden'}
                          tone={block.isActive ? 'success' : 'neutral'}
                        />
                        {canWrite ? (
                          <form action={deleteContentBlockAction}>
                            <input type="hidden" name="id" value={block.id} />
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
              )}
            </AdminCard>
          ))}

          <AdminCard title="Navigation menus">
            {menus.length === 0 ? (
              <p className="py-4 text-center text-body-sm text-foreground-subtle">
                No menus configured.
              </p>
            ) : (
              <div className="space-y-5">
                {menus.map((menu) => (
                  <div key={menu.id}>
                    <h3 className="mb-2 text-body-sm font-semibold">
                      {menu.name}
                      <span className="ml-2 font-normal text-foreground-subtle">({menu.key})</span>
                    </h3>

                    {menu.items.length === 0 ? (
                      <p className="text-body-xs text-foreground-subtle">Empty.</p>
                    ) : (
                      <ul className="divide-y divide-border">
                        {menu.items.map((item) => (
                          <li
                            key={item.id}
                            className="flex items-center justify-between gap-3 py-2"
                            style={{ paddingLeft: item.parentId ? '1.25rem' : 0 }}
                          >
                            <div className="min-w-0">
                              <p className="truncate text-body-sm">{item.label}</p>
                              <p className="truncate text-body-xs text-foreground-subtle">
                                {item.url}
                                {item.isExternal ? ' · opens in a new tab' : ''}
                              </p>
                            </div>
                            {canWrite ? (
                              <form action={deleteMenuItemAction}>
                                <input type="hidden" name="id" value={item.id} />
                                <button
                                  type="submit"
                                  className="shrink-0 rounded-lg border border-border px-2 py-1 text-body-xs text-foreground-muted hover:bg-danger-50 hover:text-danger-700"
                                >
                                  Remove
                                </button>
                              </form>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}

                    {canWrite ? (
                      <form action={addMenuItemAction} className="mt-3 flex flex-wrap items-end gap-2">
                        <input type="hidden" name="menuId" value={menu.id} />
                        <div className="min-w-0 flex-1">
                          <label htmlFor={`label-${menu.id}`} className="sr-only">
                            Link label for {menu.name}
                          </label>
                          <input
                            id={`label-${menu.id}`}
                            name="label"
                            required
                            placeholder="Label"
                            className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-body-xs"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <label htmlFor={`url-${menu.id}`} className="sr-only">
                            URL for {menu.name}
                          </label>
                          <input
                            id={`url-${menu.id}`}
                            name="url"
                            required
                            placeholder="/shop"
                            className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-body-xs"
                          />
                        </div>
                        <button
                          type="submit"
                          className="h-9 rounded-lg border border-border px-3 text-body-xs font-medium hover:bg-surface-muted"
                        >
                          Add
                        </button>
                      </form>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </AdminCard>
        </div>

        {canWrite ? (
          <aside className="space-y-6">
            <AdminCard title="New content block">
              <form action={saveContentBlockAction} className="space-y-3">
                <div>
                  <label htmlFor="block-type" className="mb-1.5 block text-body-sm font-medium">
                    Type
                  </label>
                  <select
                    id="block-type"
                    name="type"
                    className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-body-sm"
                  >
                    {Object.entries(BLOCK_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="block-title" className="mb-1.5 block text-body-sm font-medium">
                    Title
                  </label>
                  <input
                    id="block-title"
                    name="title"
                    required
                    className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-body-sm"
                  />
                </div>

                <div>
                  <label htmlFor="block-body" className="mb-1.5 block text-body-sm font-medium">
                    Body
                  </label>
                  <textarea
                    id="block-body"
                    name="body"
                    rows={3}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-body-sm"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="block-link" className="mb-1.5 block text-body-xs font-medium">
                      Link URL
                    </label>
                    <input
                      id="block-link"
                      name="linkUrl"
                      className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-body-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="block-link-label" className="mb-1.5 block text-body-xs font-medium">
                      Link text
                    </label>
                    <input
                      id="block-link-label"
                      name="linkLabel"
                      className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-body-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="block-starts" className="mb-1.5 block text-body-xs font-medium">
                      Starts
                    </label>
                    <input
                      id="block-starts"
                      name="startsAt"
                      type="datetime-local"
                      className="h-9 w-full rounded-lg border border-border bg-surface px-1.5 text-body-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="block-ends" className="mb-1.5 block text-body-xs font-medium">
                      Ends
                    </label>
                    <input
                      id="block-ends"
                      name="endsAt"
                      type="datetime-local"
                      className="h-9 w-full rounded-lg border border-border bg-surface px-1.5 text-body-xs"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="block-group" className="mb-1.5 block text-body-xs font-medium">
                    Group
                  </label>
                  <input
                    id="block-group"
                    name="group"
                    placeholder="FAQ section, or banner slot"
                    className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-body-xs"
                  />
                </div>

                <label className="flex items-center gap-2.5 text-body-sm">
                  <input
                    type="checkbox"
                    name="isActive"
                    defaultChecked
                    className="size-4 rounded border-border-strong text-accent"
                  />
                  Live
                </label>

                <button
                  type="submit"
                  className="w-full rounded-lg bg-accent px-4 py-2.5 text-body-sm font-medium text-white hover:bg-accent-hover"
                >
                  Add block
                </button>
              </form>
            </AdminCard>

            <AdminCard title="New page">
              <form action={savePageAction} className="space-y-3">
                <div>
                  <label htmlFor="page-title" className="mb-1.5 block text-body-sm font-medium">
                    Title
                  </label>
                  <input
                    id="page-title"
                    name="title"
                    required
                    className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-body-sm"
                  />
                </div>

                <div>
                  <label htmlFor="page-slug" className="mb-1.5 block text-body-sm font-medium">
                    URL segment
                  </label>
                  <input
                    id="page-slug"
                    name="slug"
                    required
                    className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-body-sm"
                  />
                </div>

                <div>
                  <label htmlFor="page-content" className="mb-1.5 block text-body-sm font-medium">
                    Content
                  </label>
                  <textarea
                    id="page-content"
                    name="content"
                    rows={6}
                    required
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-body-xs"
                  />
                </div>

                <div>
                  <label htmlFor="page-status" className="mb-1.5 block text-body-sm font-medium">
                    Status
                  </label>
                  <select
                    id="page-status"
                    name="status"
                    className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-body-sm"
                  >
                    <option value="DRAFT">Draft</option>
                    <option value="PUBLISHED">Published</option>
                  </select>
                  <p className="mt-1 text-body-xs text-foreground-subtle">
                    Publishing needs the publish permission, which is separate from writing.
                  </p>
                </div>

                <button
                  type="submit"
                  className="w-full rounded-lg bg-accent px-4 py-2.5 text-body-sm font-medium text-white hover:bg-accent-hover"
                >
                  Create page
                </button>
              </form>
            </AdminCard>
          </aside>
        ) : null}
      </div>
    </>
  );
}
