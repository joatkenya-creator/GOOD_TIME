import Link from 'next/link';

import { type ListParams, buildListHref } from '@/features/admin/query';
import { cn } from '@/utils/cn';

/**
 * Search and status filters for a list screen.
 *
 * A plain GET form. No JavaScript, no debounce, no client state: submitting
 * puts the query in the URL, which is where list state belongs — a filtered
 * view should be a link you can send someone. It also means the screen works
 * before hydration and keeps working if it never happens.
 */
export function ListToolbar({
  basePath,
  params,
  statuses,
  placeholder = 'Search…',
  children,
}: {
  basePath: string;
  params: ListParams;
  /** Empty `value` means "all". */
  statuses?: { value: string; label: string; count?: number }[];
  placeholder?: string;
  /** Extra filters, rendered inside the same form so one submit applies all. */
  children?: React.ReactNode;
}) {
  return (
    <div className="border-b border-border">
      {statuses && statuses.length > 0 ? (
        <div className="flex flex-wrap gap-1 px-4 pt-3">
          {statuses.map((status) => {
            const active = params.status === status.value;
            return (
              <Link
                key={status.value || 'all'}
                href={buildListHref(basePath, params, { status: status.value })}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-body-sm font-medium transition-colors',
                  active
                    ? 'bg-accent-soft text-accent-text'
                    : 'text-foreground-muted hover:bg-surface-muted hover:text-foreground',
                )}
              >
                {status.label}
                {status.count !== undefined ? (
                  <span className="text-body-xs ml-1.5 text-foreground-subtle">{status.count}</span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ) : null}

      <form method="get" action={basePath} className="flex flex-wrap items-end gap-2 p-4">
        <div className="min-w-0 flex-1 sm:max-w-xs">
          <label htmlFor="list-search" className="sr-only">
            Search
          </label>
          <input
            id="list-search"
            type="search"
            name="q"
            defaultValue={params.q}
            placeholder={placeholder}
            className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-body-sm outline-none focus-visible:border-accent"
          />
        </div>

        {children}

        {/*
          The current status and sort ride along as hidden fields. A GET form
          only submits its own inputs, so without these, searching would
          silently reset the filter the person just chose.
        */}
        {params.status ? <input type="hidden" name="status" value={params.status} /> : null}
        {params.sort ? <input type="hidden" name="sort" value={params.sort} /> : null}
        {params.direction ? (
          <input type="hidden" name="direction" value={params.direction} />
        ) : null}

        <button
          type="submit"
          className="h-10 rounded-lg bg-accent px-4 text-body-sm font-medium text-white hover:bg-accent-hover"
        >
          Apply
        </button>

        {params.q || params.status || Object.keys(params.extra).length > 0 ? (
          <Link
            href={basePath}
            className="h-10 rounded-lg border border-border px-4 text-body-sm leading-10 font-medium hover:bg-surface-muted"
          >
            Clear
          </Link>
        ) : null}
      </form>
    </div>
  );
}

/**
 * The bulk action bar.
 *
 * Sits inside the same `<form>` as the row checkboxes, so the browser collects
 * the selection — no client state tracking which rows are ticked, no chance of
 * the visible selection and the submitted one disagreeing.
 *
 * Destructive actions carry `formNoValidate={false}` and a confirmation, because
 * "delete 400 products" and "publish 400 products" sit two pixels apart.
 */
export function BulkBar({
  actions,
  categories,
  canBulk,
  canDelete,
}: {
  actions: { value: string; label: string; danger?: boolean }[];
  categories?: { id: string; name: string; path: string }[];
  canBulk: boolean;
  canDelete: boolean;
}) {
  if (!canBulk) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-muted px-4 py-3">
      <p className="text-body-xs text-foreground-subtle">Tick rows, then apply:</p>

      {actions
        .filter((action) => (action.danger ? canDelete : true))
        .map((action) => (
          <button
            key={action.value}
            type="submit"
            name="action"
            value={action.value}
            className={cn(
              'text-body-xs rounded-lg border px-3 py-1.5 font-medium',
              action.danger
                ? 'border-danger-700/30 text-danger-700 hover:bg-danger-50'
                : 'border-border bg-surface hover:bg-surface-muted',
            )}
          >
            {action.label}
          </button>
        ))}

      {categories && categories.length > 0 ? (
        <span className="flex items-center gap-1.5">
          <label htmlFor="bulk-category" className="sr-only">
            Category to assign
          </label>
          <select
            id="bulk-category"
            name="categoryId"
            defaultValue=""
            className="text-body-xs h-8 rounded-lg border border-border bg-surface px-2"
          >
            <option value="">Assign category…</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.path}
              </option>
            ))}
          </select>
          <button
            type="submit"
            name="action"
            value="category"
            className="text-body-xs rounded-lg border border-border bg-surface px-3 py-1.5 font-medium hover:bg-surface-muted"
          >
            Assign
          </button>
        </span>
      ) : null}

      <span className="flex items-center gap-1.5">
        <label htmlFor="bulk-price" className="sr-only">
          Price change
        </label>
        <select
          name="priceMode"
          defaultValue="percent"
          aria-label="Price change type"
          className="text-body-xs h-8 rounded-lg border border-border bg-surface px-2"
        >
          <option value="percent">%</option>
          <option value="fixed">$</option>
        </select>
        <input
          id="bulk-price"
          type="number"
          name="priceAmount"
          step="0.01"
          placeholder="0"
          className="text-body-xs h-8 w-20 rounded-lg border border-border bg-surface px-2"
        />
        <button
          type="submit"
          name="action"
          value="price"
          className="text-body-xs rounded-lg border border-border bg-surface px-3 py-1.5 font-medium hover:bg-surface-muted"
        >
          Adjust prices
        </button>
      </span>
    </div>
  );
}
