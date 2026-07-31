import Link from 'next/link';

import { ActiveFilters, FilterPanel, type FilterGroup } from '@/components/catalog/filter-panel';
import { ListingToolbar } from '@/components/catalog/listing-toolbar';
import { ProductGrid } from '@/components/catalog/product-grid';
import { Breadcrumbs } from '@/components/navigation/breadcrumbs';
import { Container } from '@/components/layout/container';
import { JsonLd } from '@/components/common/json-ld';
import { Pagination } from '@/components/ui/pagination';
import { facetLabel } from '@/features/catalog/facets';
import { filterToSearchParams, type ProductFilter } from '@/features/catalog/schemas';
import { breadcrumbSchema, type BreadcrumbEntry } from '@/lib/seo/json-ld';
import type { FacetCount, ProductListResult } from '@/services/product.service';

export interface ListingViewProps {
  title: string;
  description?: string | null;
  heroHeadline?: string | null;
  heroBody?: string | null;
  trail: BreadcrumbEntry[];
  filter: ProductFilter;
  result: ProductListResult;
  facets: FacetCount[];
  priceBounds: { minCents: number; maxCents: number };
  /** Immediate child categories, rendered as internal links. */
  childLinks?: { name: string; href: string; count?: number }[];
  relatedLinks?: { name: string; href: string }[];
  basePath: string;
}

/**
 * Product listing.
 *
 * Shared by the shop root, every category page and every collection page —
 * because they are the same page with a different `where` clause, and
 * maintaining three copies is how they drift apart.
 *
 * A server component throughout. The filter panel, toolbar and card actions are
 * the only client islands, so a 24-product page ships three small bundles rather
 * than hydrating the whole grid.
 */
export function ListingView({
  title,
  description,
  heroHeadline,
  heroBody,
  trail,
  filter,
  result,
  facets,
  priceBounds,
  childLinks,
  relatedLinks,
  basePath,
}: ListingViewProps) {
  const groups = buildFilterGroups(facets);
  const applied = appliedFilterLabels(filter);

  // Pagination hrefs preserve every filter, so page 2 of a filtered listing is a
  // real, linkable, crawlable URL.
  const buildHref = (page: number) => {
    const params = filterToSearchParams({ ...filter, page });
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  return (
    <>
      <JsonLd schema={breadcrumbSchema(trail)} />

      <Container className="py-8 lg:py-12">
        <Breadcrumbs trail={trail} className="mb-8" />

        <header className="max-w-3xl">
          <h1 className="text-display-lg text-foreground">{heroHeadline ?? title}</h1>
          {heroBody || description ? (
            <p className="mt-4 text-body-lg leading-relaxed text-foreground-muted">
              {heroBody ?? description}
            </p>
          ) : null}
        </header>

        {/* Child-category links: the main internal-linking path to deep pages. */}
        {childLinks?.length ? (
          <nav aria-label="Subcategories" className="mt-8">
            <ul className="flex flex-wrap gap-2">
              {childLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-body-sm text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
                  >
                    {link.name}
                    {link.count !== undefined ? (
                      <span className="text-xs text-foreground-subtle">{link.count}</span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        <div className="mt-10 grid gap-10 lg:grid-cols-[16rem_1fr] lg:gap-12">
          <FilterPanel groups={groups} priceBounds={priceBounds} resultCount={result.total} />

          <div className="min-w-0">
            <ListingToolbar total={result.total} shown={result.items.length} />

            {applied.length ? <ActiveFilters labels={applied} /> : null}

            <ProductGrid
              products={result.items}
              layout={filter.view}
              className={applied.length ? 'mt-6' : 'mt-8'}
            />

            <Pagination
              page={result.page}
              totalPages={result.totalPages}
              buildHref={buildHref}
              className="mt-14"
            />
          </div>
        </div>

        {relatedLinks?.length ? (
          <nav aria-label="Related categories" className="mt-20 border-t border-border pt-8">
            <h2 className="text-eyebrow text-foreground uppercase">Related categories</h2>
            <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
              {relatedLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="inline-flex min-h-6 items-center rounded-sm text-body-sm text-foreground-muted underline-offset-4 hover:text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </Container>
    </>
  );
}

/**
 * Turns raw facet counts into the panel's grouped options.
 *
 * Order is fixed rather than count-driven, so the panel does not reshuffle every
 * time a filter changes — a moving filter list is disorienting.
 */
function buildFilterGroups(facets: FacetCount[]): FilterGroup[] {
  const order: { key: string; label: string }[] = [
    { key: 'brand', label: 'Brand' },
    { key: 'material', label: 'Material' },
    { key: 'color', label: 'Colour' },
    { key: 'size', label: 'Size' },
    { key: 'tag', label: 'Features' },
    { key: 'collection', label: 'Collection' },
  ];

  return order.map(({ key, label }) => ({
    key,
    label,
    options: facets
      .filter((facet) => facet.namespace === key)
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
      .map((facet) => ({
        value: facet.value,
        label: facetLabel(facet.token),
        count: facet.count,
      })),
  }));
}

/** Chip labels for everything currently narrowing the result set. */
function appliedFilterLabels(filter: ProductFilter) {
  const labels: { key: string; value: string; label: string }[] = [];

  for (const key of ['brand', 'material', 'color', 'size', 'tag', 'collection'] as const) {
    for (const value of filter[key] ?? []) {
      labels.push({ key, value, label: facetLabel(`${key}:${value}`) });
    }
  }

  if (filter.inStockOnly) labels.push({ key: 'inStockOnly', value: 'true', label: 'In stock' });
  if (filter.onSaleOnly) labels.push({ key: 'onSaleOnly', value: 'true', label: 'On sale' });
  if (filter.newOnly) labels.push({ key: 'newOnly', value: 'true', label: 'New arrivals' });
  if (filter.minRating) {
    labels.push({
      key: 'minRating',
      value: String(filter.minRating),
      label: `${filter.minRating} stars & up`,
    });
  }

  return labels;
}
