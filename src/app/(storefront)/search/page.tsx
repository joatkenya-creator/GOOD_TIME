import type { Metadata } from 'next';
import Link from 'next/link';
import { SearchX } from 'lucide-react';

import { CompareBar } from '@/components/catalog/compare-bar';
import { ProductGrid } from '@/components/catalog/product-grid';
import { Container } from '@/components/layout/container';
import { SearchBar } from '@/components/navigation/search-bar';
import { Alert } from '@/components/ui/alert';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { ROUTES } from '@/constants/routes';
import { buildMetadata } from '@/lib/seo/metadata';
import {
  getNoResultSuggestions,
  getPopularSearches,
  getTrendingSearches,
  recordSearch,
  searchProducts,
} from '@/services/search.service';

/**
 * Search results.
 *
 * Always `noindex`: search result pages are the classic source of thin,
 * near-duplicate content, and Google's own guidance is to keep them out of the
 * index. The products themselves are indexed on their own pages.
 *
 * Rendered dynamically — results depend entirely on the query, so there is
 * nothing to cache at the page level.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}): Promise<Metadata> {
  const { q } = await searchParams;

  return buildMetadata({
    title: q ? `Search results for “${q}”` : 'Search',
    description: 'Search body-safe toys by name, brand, material or feature.',
    path: ROUTES.search,
    noindex: true,
  });
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const term = q?.trim() ?? '';

  // Nothing typed yet: offer the popular and trending terms rather than an
  // empty page. This is also the state a visitor lands on from a nav link.
  if (term.length < 2) {
    const [popular, trending] = await Promise.all([getPopularSearches(8), getTrendingSearches(6)]);

    return (
      <Container width="content" className="py-14">
        <h1 className="text-display-lg text-foreground">Search</h1>
        <p className="mt-3 text-body leading-relaxed text-foreground-muted">
          Search by product name, brand, material or feature — try “quiet”, “silicone” or
          “waterproof”.
        </p>

        <SearchBar size="lg" autoFocus className="mt-8" />

        {trending.length ? (
          <TermList title="Trending today" terms={trending} className="mt-10" />
        ) : null}
        {popular.length ? (
          <TermList title="Popular searches" terms={popular} className="mt-8" />
        ) : null}
      </Container>
    );
  }

  const results = await searchProducts(term);

  // Telemetry, deliberately not awaited — it feeds the popular/trending lists and
  // the zero-result report, and must never slow a search down.
  void recordSearch(term, results.total);

  if (!results.items.length) {
    const suggestions = await getNoResultSuggestions();

    return (
      <>
        <Container className="py-14">
          <h1 className="text-display-lg text-foreground">No results for “{term}”</h1>

          <SearchBar size="lg" className="mt-8 max-w-xl" />

          <EmptyState
            icon={<SearchX />}
            title="Nothing matched that search"
            description="Check the spelling, try a broader term, or browse by category instead."
            className="mt-10"
            action={
              <Link
                href={ROUTES.shop}
                className="text-body-sm font-medium text-accent-text underline underline-offset-4"
              >
                Browse all products
              </Link>
            }
          />

          {suggestions.popular.length ? (
            <TermList title="Popular searches" terms={suggestions.popular} className="mt-12" />
          ) : null}

          {suggestions.bestSellers.length ? (
            <section aria-labelledby="bestsellers-heading" className="mt-14">
              <h2 id="bestsellers-heading" className="text-display-md text-foreground">
                Our best sellers
              </h2>
              <ProductGrid products={suggestions.bestSellers} className="mt-8" />
            </section>
          ) : null}
        </Container>
        <CompareBar />
      </>
    );
  }

  return (
    <>
      <Container className="py-14">
        <h1 className="text-display-lg text-foreground">Results for “{term}”</h1>

        <p aria-live="polite" className="mt-3 text-body-sm text-foreground-muted">
          {results.total} {results.total === 1 ? 'product' : 'products'}
        </p>

        <SearchBar size="lg" className="mt-8 max-w-xl" />

        {/*
          The fuzzy tier fired, meaning nothing matched exactly. Saying so is more
          honest than silently showing approximate results the visitor did not ask
          for — and it prompts them to check their spelling.
        */}
        {results.isFuzzy ? (
          <Alert variant="info" className="mt-8 max-w-2xl">
            No exact matches, so these are the closest results. Check the spelling if one of these
            is not what you meant.
          </Alert>
        ) : null}

        <ProductGrid products={results.items} className="mt-10" />
      </Container>
      <CompareBar />
    </>
  );
}

function TermList({
  title,
  terms,
  className,
}: {
  title: string;
  terms: string[];
  className?: string;
}) {
  return (
    <section className={className}>
      <h2 className="text-eyebrow text-foreground uppercase">{title}</h2>
      <ul className="mt-4 flex flex-wrap gap-2">
        {terms.map((term) => (
          <li key={term}>
            <Link href={`${ROUTES.search}?q=${encodeURIComponent(term)}`}>
              <Chip label={term} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
