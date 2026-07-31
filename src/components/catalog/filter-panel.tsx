'use client';

import { SlidersHorizontal, X } from 'lucide-react';
import { useState } from 'react';

import { AccordionItem } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Drawer } from '@/components/ui/drawer';
import { Radio, RadioGroup } from '@/components/ui/radio';
import { useFilterParams } from '@/hooks/use-filter-params';
import { cn } from '@/utils/cn';
import { formatPrice } from '@/utils/format';

export interface FilterGroup {
  /** Query-string key and facet namespace — `color`, `material`, `brand`. */
  key: string;
  label: string;
  options: { value: string; label: string; count: number }[];
}

export interface FilterPanelProps {
  groups: FilterGroup[];
  priceBounds: { minCents: number; maxCents: number };
  /** Total matching the current filter, shown on the mobile apply button. */
  resultCount: number;
}

/**
 * Faceted filter panel.
 *
 * A sidebar on desktop and a drawer on mobile — the same component, rendered
 * twice, because duplicating the filter markup is how the two versions drift.
 *
 * Every option shows its count *within the current selection*, so an option
 * reading "(0)" is genuinely unavailable in combination with what is already
 * ticked. That is what stops customers filtering themselves into an empty page,
 * which is the single biggest abandonment cause on a faceted listing.
 */
export function FilterPanel({ groups, priceBounds, resultCount }: FilterPanelProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const filters = useFilterParams();

  const body = <FilterBody groups={groups} priceBounds={priceBounds} filters={filters} />;

  return (
    <>
      {/* Mobile trigger */}
      <Button
        variant="outline"
        onClick={() => setDrawerOpen(true)}
        className="lg:hidden"
        aria-expanded={drawerOpen}
      >
        <SlidersHorizontal aria-hidden="true" />
        Filters
        {filters.activeFilterCount > 0 ? (
          <Badge variant="solid" size="sm">
            {filters.activeFilterCount}
          </Badge>
        ) : null}
      </Button>

      {/* Desktop sidebar */}
      <aside aria-label="Product filters" className="hidden lg:block">
        <div className="flex items-center justify-between pb-4">
          <h2 className="text-eyebrow text-foreground uppercase">Filter</h2>
          {filters.activeFilterCount > 0 ? (
            <button
              type="button"
              onClick={filters.clearFilters}
              className="text-xs font-medium text-accent-text underline underline-offset-2 hover:text-brand-800"
            >
              Clear all
            </button>
          ) : null}
        </div>
        {body}
      </aside>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Filters"
        side="left"
        footer={
          <div className="flex gap-3">
            <Button variant="outline" fullWidth onClick={filters.clearFilters}>
              Clear all
            </Button>
            <Button fullWidth onClick={() => setDrawerOpen(false)}>
              Show {resultCount} {resultCount === 1 ? 'result' : 'results'}
            </Button>
          </div>
        }
      >
        {body}
      </Drawer>
    </>
  );
}

function FilterBody({
  groups,
  priceBounds,
  filters,
}: {
  groups: FilterGroup[];
  priceBounds: { minCents: number; maxCents: number };
  filters: ReturnType<typeof useFilterParams>;
}) {
  const availability = [
    { key: 'inStockOnly', label: 'In stock only' },
    { key: 'onSaleOnly', label: 'On sale' },
    { key: 'newOnly', label: 'New arrivals' },
  ];

  return (
    <div className={cn('border-t border-border', filters.isPending && 'opacity-60')}>
      <AccordionItem question="Availability" group="filters" open>
        <ul className="space-y-2.5">
          {availability.map((entry) => (
            <li key={entry.key}>
              <label className="flex cursor-pointer items-center gap-2.5 text-body-sm text-foreground-muted">
                <Checkbox
                  checked={filters.get(entry.key) === 'true'}
                  onChange={(event) =>
                    filters.setValue(entry.key, event.target.checked ? 'true' : null)
                  }
                />
                {entry.label}
              </label>
            </li>
          ))}
        </ul>
      </AccordionItem>

      <AccordionItem question="Price" group="filters">
        <PriceFilter bounds={priceBounds} filters={filters} />
      </AccordionItem>

      <AccordionItem question="Rating" group="filters">
        <RadioGroup legend="Minimum rating" hideLegend>
          {[4, 3, 2].map((stars) => (
            <label
              key={stars}
              className="flex cursor-pointer items-center gap-2.5 text-body-sm text-foreground-muted"
            >
              <Radio
                name="minRating"
                checked={filters.get('minRating') === String(stars)}
                onChange={() => filters.setValue('minRating', String(stars))}
              />
              {stars} stars &amp; up
            </label>
          ))}

          <label className="flex cursor-pointer items-center gap-2.5 text-body-sm text-foreground-muted">
            <Radio
              name="minRating"
              checked={!filters.get('minRating')}
              onChange={() => filters.setValue('minRating', null)}
            />
            Any rating
          </label>
        </RadioGroup>
      </AccordionItem>

      {groups
        .filter((group) => group.options.length > 0)
        .map((group) => (
          <AccordionItem key={group.key} question={group.label} group="filters">
            <ul className="space-y-2.5">
              {group.options.map((option) => {
                const checked = filters.has(group.key, option.value);
                // Never disable a ticked option — the customer must always be able
                // to untick their way back out of a narrow selection.
                const unavailable = option.count === 0 && !checked;

                return (
                  <li key={option.value}>
                    <label
                      className={cn(
                        'flex items-center justify-between gap-3 text-body-sm',
                        unavailable
                          ? 'cursor-not-allowed text-foreground-subtle'
                          : 'cursor-pointer text-foreground-muted',
                      )}
                    >
                      <span className="flex items-center gap-2.5">
                        <Checkbox
                          checked={checked}
                          disabled={unavailable}
                          onChange={() => filters.toggleValue(group.key, option.value)}
                        />
                        {option.label}
                      </span>
                      <span className="text-xs text-foreground-subtle">{option.count}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </AccordionItem>
        ))}
    </div>
  );
}

/**
 * Price range as two number inputs rather than a drag slider.
 *
 * A slider is harder to operate precisely, impossible with a keyboard without
 * extra work, and cannot be typed into. Two inputs are also the pattern most
 * shoppers already understand from every other retailer.
 */
function PriceFilter({
  bounds,
  filters,
}: {
  bounds: { minCents: number; maxCents: number };
  filters: ReturnType<typeof useFilterParams>;
}) {
  const toDollars = (cents: string | null) =>
    cents ? String(Math.round(Number(cents) / 100)) : '';

  return (
    <div className="space-y-3">
      <p className="text-xs text-foreground-subtle">
        {formatPrice(bounds.minCents)} – {formatPrice(bounds.maxCents)} across this selection
      </p>

      <div className="flex items-center gap-2">
        <label className="flex-1">
          <span className="sr-only">Minimum price in dollars</span>
          <input
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="Min"
            defaultValue={toDollars(filters.get('minPriceCents'))}
            onBlur={(event) =>
              filters.setValue(
                'minPriceCents',
                event.target.value ? String(Number(event.target.value) * 100) : null,
              )
            }
            className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-body-sm focus:border-accent focus:ring-4 focus:ring-brand-100 focus:outline-none"
          />
        </label>

        <span aria-hidden="true" className="text-foreground-subtle">
          –
        </span>

        <label className="flex-1">
          <span className="sr-only">Maximum price in dollars</span>
          <input
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="Max"
            defaultValue={toDollars(filters.get('maxPriceCents'))}
            onBlur={(event) =>
              filters.setValue(
                'maxPriceCents',
                event.target.value ? String(Number(event.target.value) * 100) : null,
              )
            }
            className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-body-sm focus:border-accent focus:ring-4 focus:ring-brand-100 focus:outline-none"
          />
        </label>
      </div>
    </div>
  );
}

/** Applied-filter chips, so what is active is visible without opening the panel. */
export function ActiveFilters({
  labels,
}: {
  labels: { key: string; value: string; label: string }[];
}) {
  const filters = useFilterParams();
  if (!labels.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-foreground-subtle">Filtering by</span>

      {labels.map((entry) => (
        <span
          key={`${entry.key}:${entry.value}`}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-foreground"
        >
          {entry.label}
          {/*
           * `size-6` (24px) rather than a 16px icon hit area: WCAG 2.5.8 sets
           * 24x24 CSS pixels as the minimum target size, and this is a standalone
           * control, not inline text — so the exemption does not apply. The icon
           * stays 12px; only the pressable area grows.
           */}
          <button
            type="button"
            onClick={() => filters.toggleValue(entry.key, entry.value)}
            aria-label={`Remove ${entry.label} filter`}
            className="-mr-1.5 flex size-6 shrink-0 items-center justify-center rounded-full text-foreground-subtle transition-colors hover:bg-ink-100 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--color-ring)"
          >
            <X aria-hidden="true" className="size-3" />
          </button>
        </span>
      ))}

      <button
        type="button"
        onClick={filters.clearFilters}
        className="inline-flex min-h-6 items-center rounded-sm px-1 text-xs font-medium text-accent-text underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--color-ring)"
      >
        Clear all
      </button>
    </div>
  );
}
