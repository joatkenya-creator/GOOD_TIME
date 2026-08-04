import Link from 'next/link';

import { cn } from '@/utils/cn';

/**
 * The admin's table.
 *
 * Server-rendered, because the data is already on the server and shipping a
 * grid library to re-fetch and re-sort it in the browser buys nothing but a
 * bundle. Sorting and filtering are URL state, which means a filtered view is
 * a link someone can send to a colleague — a client-side grid's state is not.
 *
 * Deliberately not virtualised. Virtualisation solves ten thousand rows in one
 * DOM; pagination solves it by not putting them there, keeps the page
 * linkable, keeps Ctrl+F working, and needs no library. If a screen ever
 * genuinely needs ten thousand rows at once, that screen can have a windowed
 * variant — none of the fifteen here does.
 */
export interface Column<T> {
  /** Stable key, also the `?sort=` token when `sortable`. */
  key: string;
  header: string;
  /** Renders the cell. Kept as a function so a column can span fields. */
  cell: (row: T) => React.ReactNode;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  /** Hidden below `sm`. Use for anything that is not the row's identity. */
  secondary?: boolean;
  width?: string;
}

export function DataTable<T>({
  rows,
  columns,
  getKey,
  getHref,
  empty,
  sort,
  buildSortHref,
  selection,
}: {
  rows: T[];
  columns: Column<T>[];
  getKey: (row: T) => string;
  /** Makes the whole row navigable. */
  getHref?: (row: T) => string;
  empty: React.ReactNode;
  sort?: { key: string; direction: 'asc' | 'desc' };
  buildSortHref?: (key: string, direction: 'asc' | 'desc') => string;
  /** Ids of selected rows plus the checkbox name, for bulk actions. */
  selection?: { name: string; selected?: Set<string> };
}) {
  if (rows.length === 0) {
    return <div className="px-5 py-16 text-center">{empty}</div>;
  }

  return (
    /*
      `relative` is load-bearing, not decoration.

      `sr-only` is `position: absolute`, so the hidden labels on the inline
      row forms anchor to the nearest positioned ancestor. Without one they
      anchor to the document and sit at the table's full scrolled width —
      extending the page by 281px past the viewport even though the table
      itself scrolls correctly inside this container.
    */
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[40rem] border-collapse text-left">
        <thead>
          <tr className="border-b border-border">
            {selection ? (
              <th scope="col" className="w-10 px-4 py-3">
                <span className="sr-only">Select</span>
              </th>
            ) : null}

            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                style={column.width ? { width: column.width } : undefined}
                className={cn(
                  'px-4 py-3 text-body-xs font-semibold tracking-wide text-foreground-subtle uppercase',
                  column.align === 'right' && 'text-right',
                  column.align === 'center' && 'text-center',
                  column.secondary && 'hidden sm:table-cell',
                )}
                // Announces the current sort to a screen reader, which is the
                // only way a non-visual user knows the order changed.
                aria-sort={
                  sort?.key === column.key
                    ? sort.direction === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : column.sortable
                      ? 'none'
                      : undefined
                }
              >
                {column.sortable && buildSortHref ? (
                  <Link
                    href={buildSortHref(
                      column.key,
                      sort?.key === column.key && sort.direction === 'asc' ? 'desc' : 'asc',
                    )}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    {column.header}
                    <span aria-hidden="true" className="text-[10px]">
                      {sort?.key === column.key ? (sort.direction === 'asc' ? '▲' : '▼') : '↕'}
                    </span>
                  </Link>
                ) : (
                  column.header
                )}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => {
            const key = getKey(row);
            const href = getHref?.(row);

            return (
              <tr
                key={key}
                className="border-b border-border last:border-0 hover:bg-surface-muted/60"
              >
                {selection ? (
                  <td className="px-4 py-3 align-middle">
                    <input
                      type="checkbox"
                      name={selection.name}
                      value={key}
                      defaultChecked={selection.selected?.has(key)}
                      className="size-4 rounded border-border-strong text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
                      aria-label={`Select ${key}`}
                    />
                  </td>
                ) : null}

                {columns.map((column, index) => (
                  <td
                    key={column.key}
                    className={cn(
                      'px-4 py-3 align-middle text-body-sm',
                      column.align === 'right' && 'text-right',
                      column.align === 'center' && 'text-center',
                      column.secondary && 'hidden sm:table-cell',
                    )}
                  >
                    {/*
                      Only the first cell links. A stretched overlay across the
                      whole row would swallow the checkbox and every inline
                      action in it — and a row of six links is six tab stops
                      that all go to the same place.
                    */}
                    {index === 0 && href ? (
                      <Link href={href} className="font-medium text-foreground hover:text-accent-text">
                        {column.cell(row)}
                      </Link>
                    ) : (
                      column.cell(row)
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Coloured status pill. One vocabulary across every module. */
export function StatusPill({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';
}) {
  const tones = {
    neutral: 'bg-surface-muted text-foreground-muted',
    success: 'bg-success-50 text-success-700',
    warning: 'bg-warning-50 text-warning-700',
    danger: 'bg-danger-50 text-danger-700',
    info: 'bg-info-50 text-info-700',
    accent: 'bg-accent-soft text-accent-text',
  } as const;

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-body-xs font-medium whitespace-nowrap',
        tones[tone],
      )}
    >
      {label}
    </span>
  );
}

/**
 * Pagination, as links.
 *
 * Links rather than buttons so page 3 is a URL: bookmarkable, shareable, and
 * still working when the browser goes back.
 */
export function TablePagination({
  page,
  totalPages,
  total,
  buildHref,
}: {
  page: number;
  totalPages: number;
  total: number;
  buildHref: (page: number) => string;
}) {
  if (totalPages <= 1) {
    return (
      <p className="border-t border-border px-5 py-3 text-body-xs text-foreground-subtle">
        {total} {total === 1 ? 'result' : 'results'}
      </p>
    );
  }

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3"
    >
      <p className="text-body-xs text-foreground-subtle">
        Page {page} of {totalPages} · {total} results
      </p>

      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link
            href={buildHref(page - 1)}
            rel="prev"
            className="rounded-lg border border-border px-3 py-1.5 text-body-xs font-medium hover:bg-surface-muted"
          >
            Previous
          </Link>
        ) : (
          /*
            Unavailable, not invisible.

            This carried `opacity-50`, which computes to 1.98:1 — text nobody
            can read, on a control whose whole job is to say "there is nothing
            before this page". The border and the muted colour already
            communicate the state; the opacity only removed the words.
          */
          <span
            aria-disabled="true"
            className="rounded-lg border border-border px-3 py-1.5 text-body-xs text-foreground-subtle"
          >
            Previous
          </span>
        )}

        {page < totalPages ? (
          <Link
            href={buildHref(page + 1)}
            rel="next"
            className="rounded-lg border border-border px-3 py-1.5 text-body-xs font-medium hover:bg-surface-muted"
          >
            Next
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className="rounded-lg border border-border px-3 py-1.5 text-body-xs text-foreground-subtle"
          >
            Next
          </span>
        )}
      </div>
    </nav>
  );
}
