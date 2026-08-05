import type { Metadata } from 'next';
import Link from 'next/link';

import { Container } from '@/components/layout/container';
import { Breadcrumbs } from '@/components/navigation/breadcrumbs';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ROUTES } from '@/constants/routes';
import { breadcrumbs } from '@/lib/seo/breadcrumbs';
import { buildMetadata } from '@/lib/seo/metadata';
import { listBrands } from '@/services/category.service';

/**
 * The brand index.
 *
 * In this category the maker is a safety signal rather than a badge — who
 * publishes material certificates, who states decibel levels, who honours a
 * warranty. That is why brands get their own surface instead of being only a
 * filter chip on the listing page.
 */
export const revalidate = 3_600;

export const metadata: Metadata = buildMetadata({
  title: 'Brands',
  description:
    'The makers we stock, and what each one publishes about materials, motors and warranty.',
  path: ROUTES.brands,
});

export default async function BrandsPage() {
  const brands = await listBrands();
  const trail = breadcrumbs({ name: 'Brands', path: ROUTES.brands });

  return (
    <Container className="py-10 sm:py-14">
      <Breadcrumbs trail={trail} />

      <header className="mt-6 max-w-2xl">
        <h1 className="text-display-lg text-foreground">Brands</h1>
        <p className="mt-3 text-body leading-relaxed text-foreground-muted">
          Every maker we stock, with what they publish about materials and construction. We do not
          list a brand that will not tell us what its products are made of.
        </p>
      </header>

      {brands.length === 0 ? (
        <div className="mt-12">
          <EmptyState
            title="No brands listed yet"
            description="The full catalogue is still one click away."
            action={
              <Button asChild>
                <Link href={ROUTES.shop}>Browse everything</Link>
              </Button>
            }
          />
        </div>
      ) : (
        <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {brands.map((brand) => (
            <li key={brand.slug}>
              <Link
                href={ROUTES.brand(brand.slug)}
                className="group flex h-full flex-col rounded-2xl border border-border bg-surface p-6 transition-[border-color,box-shadow] hover:border-accent hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
              >
                <h2 className="text-h5 font-semibold text-foreground group-hover:text-accent-text">
                  {brand.name}
                </h2>

                {brand.description ? (
                  <p className="mt-2 flex-1 text-body-sm leading-relaxed text-foreground-muted">
                    {brand.description}
                  </p>
                ) : null}

                <p className="text-body-xs mt-4 text-foreground-subtle">
                  {brand._count.products} {brand._count.products === 1 ? 'product' : 'products'}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
