import type { Metadata } from 'next';
import Link from 'next/link';

import { Container } from '@/components/layout/container';
import { Breadcrumbs } from '@/components/navigation/breadcrumbs';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ROUTES } from '@/constants/routes';
import { breadcrumbs } from '@/lib/seo/breadcrumbs';
import { buildMetadata } from '@/lib/seo/metadata';
import { listPosts } from '@/services/blog.service';

/**
 * The buying-guides index.
 *
 * Informational search is how this category earns traffic that product pages
 * cannot: people ask whether a material is body-safe long before they ask which
 * one to buy. This is the surface that answers them.
 *
 * Revalidated hourly. Editorial changes on a human timescale, and the index is
 * linked from the global navigation.
 */
export const revalidate = 3_600;

export const metadata: Metadata = buildMetadata({
  title: 'Buying guides',
  description:
    'Plain-language guides to materials, sizing, cleaning and care. No euphemisms, and every claim checkable.',
  path: ROUTES.blog,
});

function formatDate(value: Date | null): string | null {
  if (!value) return null;

  return value.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export default async function GuidesPage() {
  const posts = await listPosts();
  const trail = breadcrumbs({ name: 'Buying guides', path: ROUTES.blog });

  return (
    <Container className="py-10 sm:py-14">
      <Breadcrumbs trail={trail} />

      <header className="mt-6 max-w-2xl">
        <h1 className="text-display-lg text-foreground">Buying guides</h1>
        <p className="mt-3 text-body leading-relaxed text-foreground-muted">
          Clear answers, no euphemisms. What materials actually mean, how to size a first purchase,
          and how to clean and store what you buy so it lasts.
        </p>
      </header>

      {posts.length === 0 ? (
        /*
          Honest rather than decorative.

          An empty archive says so and offers the catalogue. A grid of
          placeholder cards would look like content that failed to load, and
          "coming soon" where a safety guide should be is worse than nothing —
          it reads as an answer.
        */
        <div className="mt-12">
          <EmptyState
            title="No guides published yet"
            description="We are writing these. In the meantime, every product page lists its materials, dimensions and decibel level in full."
            action={
              <Button asChild>
                <Link href={ROUTES.shop}>Browse the catalogue</Link>
              </Button>
            }
          />
        </div>
      ) : (
        <ul className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => {
            const published = formatDate(post.publishedAt);

            return (
              <li key={post.slug}>
                <article className="flex h-full flex-col">
                  <h2 className="text-h5 font-semibold text-foreground">
                    <Link
                      href={ROUTES.post(post.slug)}
                      className="rounded-sm hover:text-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
                    >
                      {post.title}
                    </Link>
                  </h2>

                  {post.excerpt ? (
                    <p className="mt-2 flex-1 text-body-sm leading-relaxed text-foreground-muted">
                      {post.excerpt}
                    </p>
                  ) : null}

                  <p className="text-body-xs mt-4 text-foreground-subtle">
                    {published ? (
                      <time dateTime={post.publishedAt!.toISOString()}>{published}</time>
                    ) : null}
                    {published ? ' · ' : ''}
                    {post.readingMinutes} min read
                  </p>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </Container>
  );
}
