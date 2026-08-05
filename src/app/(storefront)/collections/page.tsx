import type { Metadata } from 'next';
import Link from 'next/link';

import { Container } from '@/components/layout/container';
import { Breadcrumbs } from '@/components/navigation/breadcrumbs';
import { EmptyState } from '@/components/ui/empty-state';
import { ROUTES } from '@/constants/routes';
import { breadcrumbs } from '@/lib/seo/breadcrumbs';
import { buildMetadata } from '@/lib/seo/metadata';
import { listCollections } from '@/services/category.service';

/**
 * The collections index.
 *
 * Collections cut across the category tree: "The Quiet Hours" holds vibrators,
 * wands and rings, chosen for a property no category expresses. That is the
 * whole reason they exist alongside `/shop`, and it is why this page is linked
 * from the global navigation rather than buried.
 *
 * Revalidated rather than dynamic. Five rows that change when a merchandiser
 * edits them is the definition of cacheable, and this page is reached from
 * every page on the site.
 */
export const revalidate = 3_600;

export const metadata: Metadata = buildMetadata({
  title: 'Collections',
  description:
    'Edits that cut across categories: quiet toys, first purchases, gifts and couples. Every product body-safe, with specs published.',
  path: ROUTES.collections,
});

export default async function CollectionsPage() {
  const collections = await listCollections();
  const trail = breadcrumbs({ name: 'Collections', path: ROUTES.collections });

  return (
    <Container className="py-10 sm:py-14">
      <Breadcrumbs trail={trail} />

      <header className="mt-6 max-w-2xl">
        <h1 className="text-display-lg text-foreground">Collections</h1>
        <p className="mt-3 text-body leading-relaxed text-foreground-muted">
          Groupings that a category tree cannot express — chosen for how something feels, who it is
          for, or how quiet it is, rather than for what shelf it sits on.
        </p>
      </header>

      {collections.length === 0 ? (
        <div className="mt-12">
          <EmptyState
            title="No collections yet"
            description="Nothing has been published here. The full catalogue is still one click away."
          />
        </div>
      ) : (
        <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {collections.map((collection) => (
            <li key={collection.slug}>
              <Link
                href={ROUTES.collection(collection.slug)}
                className="group flex h-full flex-col rounded-2xl border border-border bg-surface p-6 transition-[border-color,box-shadow] hover:border-accent hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
              >
                <h2 className="text-h5 font-semibold text-foreground group-hover:text-accent-text">
                  {collection.title}
                </h2>

                {collection.description ? (
                  <p className="mt-2 flex-1 text-body-sm leading-relaxed text-foreground-muted">
                    {collection.description}
                  </p>
                ) : null}

                {/*
                  The count is the honest signal of whether this edit is worth
                  opening. A collection card that turns out to hold two products
                  is a small betrayal of the click.
                */}
                <p className="text-body-xs mt-4 text-foreground-subtle">
                  {collection._count.products}{' '}
                  {collection._count.products === 1 ? 'product' : 'products'}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
