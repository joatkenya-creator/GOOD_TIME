import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { CompareBar } from '@/components/catalog/compare-bar';
import { ListingView } from '@/components/catalog/listing-view';
import { ROUTES } from '@/constants/routes';
import { productFilterSchema } from '@/features/catalog/schemas';
import { breadcrumbs } from '@/lib/seo/breadcrumbs';
import { buildMetadata } from '@/lib/seo/metadata';
import { prerenderParams } from '@/lib/static-params';
import {
  getCollectionBySlug,
  listCollectionSlugs,
  listCollections,
} from '@/services/category.service';
import { getFacetCounts, getPriceBounds, listProducts } from '@/services/product.service';

/**
 * A collection's product listing.
 *
 * Reuses `ListingView` wholesale — the same filters, sorting, pagination and
 * facet UI as `/shop`. A collection differs from a category only in how its
 * membership is decided, so giving it a second, subtly different listing
 * experience would be a bug that takes months to notice.
 */

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Prerendered where the build can reach the database.
 *
 * These are linked from the global navigation, so a crawler reaches them on its
 * first visit to any page. `dynamicParams` stays at its default of `true`: a
 * build with no database prerenders nothing, and closing the route would then
 * 404 every collection on the site. A mistyped slug is still a real 404 —
 * `notFound()` below enforces it per request rather than per route.
 */
export const revalidate = 3_600;

export async function generateStaticParams() {
  return (await prerenderParams(listCollectionSlugs)).map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const collection = await getCollectionBySlug(slug);

  if (!collection) return {};

  return buildMetadata({
    title: collection.seo?.title ?? collection.title,
    description: collection.seo?.description ?? collection.description ?? undefined,
    path: ROUTES.collection(slug),
  });
}

export default async function CollectionPage({ params, searchParams }: PageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const collection = await getCollectionBySlug(slug);

  if (!collection) notFound();

  const filter = productFilterSchema.parse(query);

  // Membership is the join table, not a facet. A rule-driven collection writes
  // the same rows, so both kinds resolve through one predicate.
  const scope = { collections: { some: { collectionId: collection.id } } };

  const [result, facets, priceBounds, siblings] = await Promise.all([
    listProducts(filter, scope),
    getFacetCounts(filter),
    getPriceBounds(scope),
    listCollections(),
  ]);

  return (
    <>
      <ListingView
        title={collection.title}
        description={collection.description}
        trail={breadcrumbs(
          { name: 'Collections', path: ROUTES.collections },
          { name: collection.title, path: ROUTES.collection(slug) },
        )}
        filter={filter}
        result={result}
        facets={facets}
        priceBounds={priceBounds}
        // The other collections, so a shopper who has opened the wrong edit has
        // somewhere to go that is not the back button.
        relatedLinks={siblings
          .filter((entry) => entry.slug !== slug)
          .map((entry) => ({ name: entry.title, href: ROUTES.collection(entry.slug) }))}
        basePath={ROUTES.collection(slug)}
      />
      <CompareBar />
    </>
  );
}
