import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Container } from '@/components/layout/container';
import { LEGAL_SLUGS, getLegalDocument } from '@/features/legal/documents';
import { buildMetadata } from '@/lib/seo/metadata';

/**
 * Static content pages, currently the two legal documents.
 *
 * `generateStaticParams` lists only the slugs that exist, so every other
 * `/pages/*` link in the footer keeps returning a real 404 rather than an empty
 * shell pretending to be a page. Those are phase 6 content work and are on
 * record in docs/quality.md; a "coming soon" placeholder where a returns policy
 * should be is worse than the honest 404, because it looks like an answer.
 *
 * `dynamicParams = false` makes that structural: an unknown slug cannot even
 * reach the component.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return LEGAL_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const document = getLegalDocument(slug);
  if (!document) return {};

  return buildMetadata({
    title: document.title,
    description: document.description,
    path: `/pages/${slug}`,
  });
}

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const document = getLegalDocument(slug);

  if (!document) notFound();

  const updated = new Date(`${document.updated}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <Container as="article" width="narrow" className="py-16 sm:py-24">
      <header>
        <h1 className="text-display-lg text-foreground">{document.title}</h1>

        {/*
          A policy with no date cannot be checked against the version someone
          agreed to. `dateTime` carries the machine-readable form.
        */}
        <p className="mt-3 text-body-sm text-foreground-subtle">
          Last updated <time dateTime={document.updated}>{updated}</time>
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
