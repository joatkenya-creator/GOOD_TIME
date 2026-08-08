import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Container } from '@/components/layout/container';
import { LEGAL_SLUGS, getLegalDocument } from '@/features/legal/documents';
import { buildMetadata } from '@/lib/seo/metadata';
import { prerenderParams } from '@/lib/static-params';
import { getPageBySlug, listPageSlugs } from '@/services/blog.service';

/**
 * Static content pages.
 *
 * Two sources, checked in this order:
 *
 *   1. **Legal documents in code** (`/pages/privacy`, `/pages/terms`). These are
 *      versioned with the application on purpose: what a customer agreed to must
 *      be recoverable from git, and a policy an admin can silently edit is not
 *      evidence of anything.
 *   2. **Published `Page` rows**, authored in the admin — shipping, returns,
 *      warranty, contact, care and the rest of the footer.
 *
 * ## Why the database source had to be added
 *
 * The admin has had a Pages screen since phase 6 and this route ignored it
 * entirely: it served only `LEGAL_SLUGS`, and `dynamicParams = false` refused
 * every other slug. A merchant could write a returns policy, save it
 * successfully, and it would never appear anywhere — while the footer linked to
 * twelve such pages and every one of them 404'd, with no way to fix it short of
 * a deploy.
 *
 * The honest 404 for genuinely unwritten content is still the right answer and
 * still what happens. It is now a content gap the merchant can close rather
 * than a wall.
 */

type PageProps = { params: Promise<{ slug: string }> };

/**
 * Prerender what exists at build time, and stay open to new slugs.
 *
 * `dynamicParams` is deliberately left at its default of `true`: a page
 * published an hour after a deploy must be reachable without one. An unknown
 * slug still 404s — `notFound()` below enforces that, rather than the route
 * being closed to everything it did not know about at build time.
 */
export const revalidate = 3_600;

export async function generateStaticParams() {
  const published = await prerenderParams(listPageSlugs);

  return [...LEGAL_SLUGS.map((slug) => ({ slug })), ...published.map(({ slug }) => ({ slug }))];
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;

  const legal = getLegalDocument(slug);
  if (legal) {
    return buildMetadata({
      title: legal.title,
      description: legal.description,
      path: `/pages/${slug}`,
    });
  }

  const page = await getPageBySlug(slug);
  if (!page) return {};

  return buildMetadata({
    title: page.seo?.title ?? page.title,
    description: page.seo?.description ?? undefined,
    path: `/pages/${slug}`,
  });
}

function formatDate(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(`${value}T00:00:00Z`) : value;

  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export default async function ContentPage({ params }: PageProps) {
  const { slug } = await params;
  const document = getLegalDocument(slug);

  // --- Legal documents, from code -------------------------------------------
  if (document) {
    return (
      <Container as="article" width="narrow" className="py-16 sm:py-24">
        <header>
          <h1 className="text-display-lg text-foreground">{document.title}</h1>

          {/*
            A policy with no date cannot be checked against the version someone
            agreed to. `dateTime` carries the machine-readable form.
          */}
          <p className="mt-3 text-body-sm text-foreground-subtle">
            Last updated <time dateTime={document.updated}>{formatDate(document.updated)}</time>
          </p>

          <p className="mt-6 text-body leading-relaxed text-foreground-muted">{document.intro}</p>
        </header>

        {document.sections.map((section) => (
          <section key={section.heading} className="mt-12">
            <h2 className="text-display-sm text-foreground">{section.heading}</h2>

            {section.paragraphs.map((paragraph) => (
              <p key={paragraph} className="mt-4 text-body leading-relaxed text-foreground-muted">
                {paragraph}
              </p>
            ))}

            {section.bullets ? (
              <ul className="mt-4 list-disc space-y-2 pl-6 text-body leading-relaxed text-foreground-muted">
                {section.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </Container>
    );
  }

  // --- Admin-authored pages, from the database ------------------------------
  const page = await getPageBySlug(slug);

  if (!page) notFound();

  /*
   * Rendered as plain text, for the same reason as a guide's body: `content` is
   * untyped free text and there is no HTML sanitiser in the dependency tree.
   * `dangerouslySetInnerHTML` here would make every admin author a stored-XSS
   * vector against every reader, on pages that carry a session cookie.
   */
  const paragraphs = page.content
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);

  return (
    <Container as="article" width="narrow" className="py-16 sm:py-24">
      <header>
        <h1 className="text-display-lg text-foreground">{page.title}</h1>

        <p className="mt-3 text-body-sm text-foreground-subtle">
          Last updated{' '}
          <time dateTime={page.updatedAt.toISOString()}>{formatDate(page.updatedAt)}</time>
        </p>
      </header>

      <div className="mt-10 space-y-5">
        {paragraphs.map((paragraph, index) => (
          // Index is safe: derived from immutable content, never reordered.
          <p key={index} className="text-body leading-relaxed text-foreground-muted">
            {paragraph}
          </p>
        ))}
      </div>
    </Container>
  );
}
