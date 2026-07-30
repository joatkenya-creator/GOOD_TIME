import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { Container } from '@/components/layout/container';
import { Reveal } from '@/components/motion/reveal';
import { BlogCard } from '@/components/product/blog-card';
import { ROUTES } from '@/constants/routes';
import { journalPosts } from '@/features/home/content';

/**
 * Journal preview.
 *
 * Editorial content is how this category earns organic search traffic that
 * product pages cannot — the questions people type are informational long before
 * they are transactional.
 */
export function JournalSection() {
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
            className="group inline-flex items-center gap-1.5 text-body-sm font-medium text-foreground hover:text-accent-text"
          >
            Read all guides
            <ArrowRight
              aria-hidden="true"
              className="size-4 transition-transform duration-(--duration-base) group-hover:translate-x-1"
            />
          </Link>
        </div>

        <ul className="grid gap-x-6 gap-y-12 md:grid-cols-3">
          {journalPosts.map((post, index) => (
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
