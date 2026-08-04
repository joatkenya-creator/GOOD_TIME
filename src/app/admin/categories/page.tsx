import type { Metadata } from 'next';

import { StatusPill } from '@/components/admin/data-table';
import { AdminCard, AdminPageHeader } from '@/components/admin/page-header';
import { PERMISSIONS } from '@/constants/permissions';
import { deleteCategoryAction, saveCategoryAction } from '@/server/actions/admin/catalogue';
import { requireAdminPermission } from '@/server/auth/admin';
import { can } from '@/server/auth/session';
import { listCategoryTree } from '@/services/admin/catalogue-admin.service';

export const metadata: Metadata = { title: 'Categories' };

/**
 * The category tree.
 *
 * Rendered flat and indented by `depth` rather than as nested lists. The rows
 * are already in depth-first order because they are sorted by materialised
 * path, so the tree needs no recursion — and a flat list keeps every row one
 * tab stop apart instead of burying deep categories inside nested groups.
 */
export default async function AdminCategoriesPage() {
  const user = await requireAdminPermission(PERMISSIONS.productRead);
  const categories = await listCategoryTree();
  const canWrite = can(user, PERMISSIONS.categoryWrite);

  return (
    <>
      <AdminPageHeader
        title="Categories"
        description={`${categories.length} categories. Order and nesting drive the shop navigation.`}
        pathname="/admin/categories"
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <AdminCard title="The tree">
          {categories.length === 0 ? (
            <p className="py-8 text-center text-body-sm text-foreground-subtle">
              No categories yet.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {categories.map((category) => (
                <li
                  key={category.id}
                  className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                  style={{ paddingLeft: `${category.depth * 1.25}rem` }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-body-sm font-medium">
                      {category.name}
                      {!category.isActive ? <StatusPill label="Hidden" tone="neutral" /> : null}
                    </p>
                    <p className="truncate text-body-xs text-foreground-subtle">
                      {category.path} · {category._count.products} products
                      {category._count.children > 0
                        ? ` · ${category._count.children} sub-categories`
                        : ''}
                    </p>
                  </div>

                  {canWrite ? (
                    <form action={deleteCategoryAction}>
                      <input type="hidden" name="id" value={category.id} />
                      <button
                        type="submit"
                        className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-body-xs text-foreground-muted hover:bg-danger-50 hover:text-danger-700"
                      >
                        Delete
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </AdminCard>

        {canWrite ? (
          <AdminCard title="Add a category" description="Nesting is set by the parent.">
            <form action={saveCategoryAction} className="space-y-4">
              <div>
                <label htmlFor="cat-name" className="mb-1.5 block text-body-sm font-medium">
                  Name
                </label>
                <input
                  id="cat-name"
                  name="name"
                  required
                  maxLength={120}
                  className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-body-sm"
                />
              </div>

              <div>
                <label htmlFor="cat-slug" className="mb-1.5 block text-body-sm font-medium">
                  URL segment
                </label>
                <input
                  id="cat-slug"
                  name="slug"
                  required
                  maxLength={120}
                  className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-body-sm"
                />
                <p className="mt-1 text-body-xs text-foreground-subtle">
                  The full path is built from the parent, so this is just the last part.
                </p>
              </div>

              <div>
                <label htmlFor="cat-parent" className="mb-1.5 block text-body-sm font-medium">
                  Parent
                </label>
                <select
                  id="cat-parent"
                  name="parentId"
                  defaultValue=""
                  className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-body-sm"
                >
                  <option value="">Top level</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.path}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="cat-position" className="mb-1.5 block text-body-sm font-medium">
                  Position
                </label>
                <input
                  id="cat-position"
                  name="position"
                  type="number"
                  defaultValue={0}
                  className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-body-sm"
                />
              </div>

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
                Add category
              </button>
            </form>
          </AdminCard>
        ) : null}
      </div>
    </>
  );
}
