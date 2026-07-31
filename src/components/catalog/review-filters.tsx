'use client';

import { Chip } from '@/components/ui/chip';
import { Select } from '@/components/ui/select';
import { useFilterParams } from '@/hooks/use-filter-params';
import type { RatingSummary } from '@/services/review.service';

const SORT_OPTIONS = [
  { value: 'helpful', label: 'Most helpful' },
  { value: 'newest', label: 'Newest first' },
  { value: 'highest', label: 'Highest rated' },
  { value: 'lowest', label: 'Lowest rated' },
] as const;

/**
 * Review sort and filter controls.
 *
 * Driven through the URL like the product filters, so a link to
 * `?rating=1#reviews` is shareable — which is exactly what a customer
 * investigating the negative reviews wants to do.
 *
 * Default sort is "most helpful" rather than "newest": the review that answered
 * other people's question is the one most likely to answer this visitor's.
 */
export function ReviewFilters({ summary }: { summary: RatingSummary }) {
  const filters = useFilterParams();
  const activeRating = filters.get('rating');
  const withPhotos = filters.get('withPhotos') === 'true';

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
      <div className="flex flex-wrap items-center gap-2">
        <Chip
          label="All"
          selected={!activeRating && !withPhotos}
          onSelect={() => {
            filters.setValue('rating', null);
            filters.setValue('withPhotos', null);
          }}
        />

        {summary.distribution
          .filter((row) => row.count > 0)
          .map((row) => (
            <Chip
              key={row.stars}
              label={`${row.stars} star`}
              count={row.count}
              selected={activeRating === String(row.stars)}
              onSelect={() =>
                filters.setValue(
                  'rating',
                  activeRating === String(row.stars) ? null : String(row.stars),
                )
              }
            />
          ))}

        {summary.withPhotosCount > 0 ? (
          <Chip
            label="With photos"
            count={summary.withPhotosCount}
            selected={withPhotos}
            onSelect={() => filters.setValue('withPhotos', withPhotos ? null : 'true')}
          />
        ) : null}
      </div>

      <label className="flex items-center gap-2 text-body-sm text-foreground-muted">
        <span className="sr-only">Sort reviews by</span>
        <Select
          value={filters.get('sort') ?? 'helpful'}
          onChange={(event) => filters.setValue('sort', event.target.value)}
          inputSize="sm"
          className="w-44"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </label>
    </div>
  );
}
