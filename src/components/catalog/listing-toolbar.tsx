'use client';

import { LayoutGrid, List } from 'lucide-react';

import { Select } from '@/components/ui/select';
import { PRODUCT_SORTS, SORT_LABELS } from '@/features/catalog/schemas';
import { useFilterParams } from '@/hooks/use-filter-params';
import { cn } from '@/utils/cn';

export interface ListingToolbarProps {
  total: number;
  shown: number;
}

/**
 * Result count, sort control and grid/list toggle.
 *
 * The count is announced through a live region, because a screen-reader user who
 * ticks a filter otherwise gets no feedback that anything happened — the grid
 * silently changes below them.
 */
export function ListingToolbar({ total, shown }: ListingToolbarProps) {
  const filters = useFilterParams();
  const view = filters.get('view') ?? 'grid';

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
      <p aria-live="polite" className="text-body-sm text-foreground-muted">
        {total === 0 ? (
          'No products match these filters'
        ) : (
          <>
            Showing <span className="font-medium text-foreground">{shown}</span> of{' '}
            <span className="font-medium text-foreground">{total}</span>{' '}
            {total === 1 ? 'product' : 'products'}
          </>
        )}
      </p>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-body-sm text-foreground-muted">
          <span className="hidden sm:inline">Sort</span>
          <span className="sr-only sm:hidden">Sort products by</span>
          <Select
            value={filters.get('sort') ?? 'relevance'}
            onChange={(event) =>
              filters.setValue(
                'sort',
                event.target.value === 'relevance' ? null : event.target.value,
              )
            }
            inputSize="sm"
            className="w-48"
          >
            {PRODUCT_SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {SORT_LABELS[sort]}
              </option>
            ))}
          </Select>
        </label>

        {/* Radio group semantics: exactly one view is active at a time. */}
        <div
          role="radiogroup"
          aria-label="Layout"
          className="hidden items-center gap-0.5 rounded-lg border border-border p-0.5 sm:flex"
        >
          <ViewButton
            active={view === 'grid'}
            label="Grid view"
            onClick={() => filters.setValue('view', null)}
          >
            <LayoutGrid aria-hidden="true" className="size-4" />
          </ViewButton>

          <ViewButton
            active={view === 'list'}
            label="List view"
            onClick={() => filters.setValue('view', 'list')}
          >
            <List aria-hidden="true" className="size-4" />
          </ViewButton>
        </div>
      </div>
    </div>
  );
}

function ViewButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'flex size-9 items-center justify-center rounded-md transition-colors duration-(--duration-fast)',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)',
        active ? 'bg-foreground text-white' : 'text-foreground-muted hover:bg-surface-muted',
      )}
    >
      {children}
    </button>
  );
}
