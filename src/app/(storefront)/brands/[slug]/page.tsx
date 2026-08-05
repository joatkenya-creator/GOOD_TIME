import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { CompareBar } from '@/components/catalog/compare-bar';
import { ListingView } from '@/components/catalog/listing-view';
import { ROUTES } from '@/constants/routes';
import { productFilterSchema } from '@/features/catalog/schemas';
import { breadcrumbs } from '@/lib/seo/breadcrumbs';
import { buildMetadata } from '@/lib/seo/metadata';
import { getBrandBySlug, listBrandSlugs, listBrands } from '@/services/category.service';
import { getFacetCounts, getPriceBounds, listProducts } from '@/services/product.service';

/**
 * A brand's product listing.
 *
 * Same `ListingView` as `/shop` and `/collections/[slug]`, for the same reason:
 * three listings that filter differently but behave identically is one surface
 * to maintain, not three.
 */

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamicParams = false;
export const revalidate = 3_600;

export async function generateStaticParams() {
  return (await listBrandSlugs()).map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);

  if (!brand) return {};

  return buildMetadata({
    title: brand.seo?.title ?? brand.name,
    description: brand.seo?.description ?? brand.description ?? undefined,
    path: ROUTES.brand(slug),
  });
}

export default async function BrandPage({ params, searchParams }: PageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const brand = await getBrandBySlug(slug);

  if (!brand) notFound();

  const filter = productFilterSchema.parse(query);

  // The foreign key, not the `brand:` facet token. The column is indexed and
  // cannot drift out of step with the product's denormalised facet array.
  const scope = { brandId: brand.id };

  const [result, facets, priceBounds, siblings] = await Promise.all([
    listProducts(filter, scope),
    getFacetCounts(filter),
    getPriceBounds(scope),
    listBrands(),
  ]);

  return (
    <>
      <ListingView
        title={brand.name}
        description={brand.description}
        trail={breadcrumbs(
          { name: 'Brands', path: ROUTES.brands },
          { name: brand.name, path: ROUTES.brand(slug) },
        )}
        filter={filter}
        result={result}
        facets={facets}
        priceBounds={priceBounds}
        relatedLinks={siblings
          .filter((entry) => entry.slug !== slug)
          .map((entry) => ({ name: entry.name, href: ROUTES.brand(entry.slug) }))}
        basePath={ROUTES.brand(slug)}
      />
      <CompareBar />
    </>
  );
}
