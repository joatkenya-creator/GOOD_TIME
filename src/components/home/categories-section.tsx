import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { Container } from '@/components/layout/container';
import { Reveal } from '@/components/motion/reveal';
import { CategoryCard } from '@/components/product/category-card';
import { ROUTES } from '@/constants/routes';
import { featuredCategories } from '@/features/home/content';
import { cn } from '@/utils/cn';

/**
 * Featured categories.
 *
 * A bento grid rather than a uniform row: two tiles span two columns, which
 * gives the eye a path through the section and stops six identical rectangles
 * reading as a placeholder.
 */
export function CategoriesSection() {
  return (
    <section aria-labelledby="categories-title" className="py-(--spacing-section)">
      <Container>
        <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-xl">
            <p className="text-eyebrow text-accent-text uppercase">Browse</p>
            <h2 id="categories-title" className="mt-3 text-display-lg text-foreground">
              Start where it suits you
            </h2>
          </div>

          <Link
            href={ROUTES.shop}
            className="group inline-flex min-h-6 items-center gap-1.5 rounded-sm text-body-sm font-medium text-foreground hover:text-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
          >
            All categories
            <ArrowRight
              aria-hidden="true"
              className="size-4 transition-transform duration-(--duration-base) group-hover:translate-x-1"
            />
          </Link>
        </div>

        <ul className="grid grid-cols-2 gap-4 sm:gap-5 lg:grid-cols-4">
          {featuredCategories.map((category, index) => (
            <li key={category.slug} className={cn(category.feature && 'col-span-2')}>
              <Reveal delay={Math.min(index * 0.06, 0.3)}>
                <CategoryCard
                  category={category}
                  href={category.href}
                  size={category.feature ? 'feature' : 'default'}
                  className="h-full"
                />
              </Reveal>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
