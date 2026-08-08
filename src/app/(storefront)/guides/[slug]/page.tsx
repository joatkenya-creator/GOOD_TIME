import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { JsonLd } from '@/components/common/json-ld';
import { Container } from '@/components/layout/container';
import { Breadcrumbs } from '@/components/navigation/breadcrumbs';
import { ROUTES } from '@/constants/routes';
import { breadcrumbs } from '@/lib/seo/breadcrumbs';
import { articleSchema, breadcrumbSchema } from '@/lib/seo/json-ld';
import { buildMetadata } from '@/lib/seo/metadata';
import { prerenderParams } from '@/lib/static-params';
import { getPostBySlug, listOtherPosts, listPostSlugs } from '@/services/blog.service';

/**
 * One buying guide.
 *
 * ## Why the body is rendered as plain text
 *
 * `Post.content` is untyped free text and there is no HTML sanitiser in the
 * dependency tree. Rendering it with `dangerouslySetInnerHTML` would make every
 * admin author a potential XSS vector against every reader — a stored payload
 * that runs on a page carrying a session cookie.
 *
 * So it is split into paragraphs and rendered as React text nodes, which are
 * escaped by construction. Markdown support is a deliberate future addition
 * that arrives *with* a sanitiser, not before one.
 */

type PageProps = { params: Promise<{ slug: string }> };

/**
 * Prerendered, but open to new slugs.
 *
 * Unlike collections and brands, editorial is published continuously and a post
 * written after the last deploy must be reachable without one — so
 * `dynamicParams` stays at its default of `true` and the page is generated on
 * first request.
 */
export const revalidate = 3_600;

export async function generateStaticParams() {
  return (await prerenderParams(listPostSlugs)).map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPostBySlug(slug);

  if (!post) return {};

  return buildMetadata({
    title: post.seo?.title ?? post.title,
    description: post.seo?.description ?? post.excerpt ?? undefined,
    path: ROUTES.post(slug),
    type: 'article',
  });
}

function formatDate(value: Date): string {
  return value.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export default async function GuidePage({ params }: PageProps) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);

  if (!post) notFound();

  const others = await listOtherPosts(slug);
  const trail = breadcrumbs(
    { name: 'Buying guides', path: ROUTES.blog },
    { name: post.title, path: ROUTES.post(slug) },
  );

  // Blank-line separated. The single most common convention in a plain-text
  // editor, and the only one that is unambiguous without a parser.
  const paragraphs = post.content
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);

  return (
    <>
      <JsonLd
        schema={[
          breadcrumbSchema(trail),
          articleSchema({
            title: post.title,
            slug: post.slug,
            description: post.excerpt,
            authorName: post.authorName,
            publishedAt: post.publishedAt ?? post.updatedAt,
            updatedAt: post.updatedAt,
          }),
        ]}
      />

      <Container as="article" width="narrow" className="py-10 sm:py-14">
        <Breadcrumbs trail={trail} />

        <header className="mt-6">
          <h1 className="text-display-lg text-foreground">{post.title}</h1>

          <p className="mt-3 text-body-sm text-foreground-subtle">
            By {post.authorName}
            {post.publishedAt ? (
              <>
                {' · '}
                <time dateTime={post.publishedAt.toISOString()}>
                  {formatDate(post.publishedAt)}
                </time>
              </>
            ) : null}
            {' · '}
            {post.readingMinutes} min read
          </p>

          {post.excerpt ? (
            <p className="mt-6 text-body-lg leading-relaxed text-foreground-muted">
              {post.excerpt}
            </p>
          ) : null}
        </header>

        <div className="mt-10 space-y-5">
          {paragraphs.map((paragraph, index) => (
            <p
              // Index is safe: this list is derived from immutable content and
              // is never reordered or filtered after render.
              key={index}
              className="text-body leading-relaxed text-foreground-muted"
            >
              {paragraph}
            </p>
          ))}
        </div>

        {post.tags.length > 0 ? (
          <ul className="mt-10 flex flex-wrap gap-2">
            {post.tags.map((tag) => (
              <li
                key={tag.slug}
                className="text-body-xs rounded-full border border-border px-3 py-1 text-foreground-muted"
              >
                {tag.name}
              </li>
            ))}
          </ul>
        ) : null}

        {others.length > 0 ? (
          <section aria-labelledby="more-guides" className="mt-16 border-t border-border pt-10">
            <h2 id="more-guides" className="text-h5 font-semibold text-foreground">
              More guides
            </h2>

            <ul className="mt-4 space-y-3">
              {others.map((other) => (
                <li key={other.slug}>
                  <Link
                    href={ROUTES.post(other.slug)}
                    className="rounded-sm text-body text-accent underline underline-offset-2 hover:text-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
                  >
                    {other.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </Container>
    </>
  );
}
