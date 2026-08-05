import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { Container } from '@/components/layout/container';
import { Reveal } from '@/components/motion/reveal';
import { BlogCard, type BlogCardData } from '@/components/product/blog-card';
import { ROUTES } from '@/constants/routes';

/**
 * Journal preview.
 *
 * Editorial content is how this category earns organic search traffic that
 * product pages cannot — the questions people type are informational long
 * before they are transactional.
 *
 * ## Why this reads the database
 *
 * It used to render three hardcoded articles whose slugs pointed at
 * `/guides/choosing-your-first-vibrator` and two siblings. No such posts
 * existed, so the homepage advertised three guides and every one of them 404'd
 * — on the most-visited page on the site, to every visitor and every crawler.
 *
 * Publishing a guide in the admin is now the only way it appears here, which
 * makes the link and the article the same fact. With nothing published the
 * section renders nothing at all: a heading promising "clear answers" above an
 * empty grid is worse than silence.
 *
 * The posts arrive as a prop because `components/` is barred from importing
 * `services/` — the page fetches, the component renders.
 */
export function JournalSection({ posts }: { posts: BlogCardData[] }) {
  if (posts.length === 0) return null;

  return (
    <section aria-labelledby="journal-title" className="py-(--spacing-section)">
      <Container>
        <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-xl">
            <p className="text-eyebrow text-accent-text uppercase">Buying guides</p>
            <h2 id="journal-title" className="mt-3 text-display-lg text-foreground">
              Clear answers, no euphemisms
            </h2>
          </div>

          <Link
            href={ROUTES.blog}
            className="group inline-flex min-h-6 items-center gap-1.5 rounded-sm text-body-sm font-medium text-foreground hover:text-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
          >
            Read all guides
            <ArrowRight
              aria-hidden="true"
              className="size-4 transition-transform duration-(--duration-base) group-hover:translate-x-1"
            />
          </Link>
        </div>

        <ul className="grid gap-x-6 gap-y-12 md:grid-cols-3">
          {posts.map((post, index) => (
            <li key={post.slug}>
              <Reveal delay={Math.min(index * 0.08, 0.24)}>
                <BlogCard post={post} />
              </Reveal>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
