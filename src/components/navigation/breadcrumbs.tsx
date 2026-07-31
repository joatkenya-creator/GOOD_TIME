import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

import { type BreadcrumbEntry } from '@/lib/seo/json-ld';
import { cn } from '@/utils/cn';

export interface BreadcrumbsProps {
  trail: BreadcrumbEntry[];
  className?: string;
}

/**
 * Visible breadcrumb trail.
 *
 * Fed by the same `trail` array that produces the JSON-LD `BreadcrumbList`, so
 * what Google indexes and what the customer sees can never diverge.
 */
export function Breadcrumbs({ trail, className }: BreadcrumbsProps) {
  if (trail.length < 2) return null;

  return (
    <nav aria-label="Breadcrumb" className={cn('text-sm', className)}>
      <ol className="flex flex-wrap items-center gap-1.5 text-foreground-muted">
        {trail.map((entry, index) => {
          const isLast = index === trail.length - 1;

          return (
            <li key={entry.path} className="flex items-center gap-1.5">
              {index > 0 ? (
                <ChevronRight aria-hidden="true" className="size-3.5 text-foreground-subtle" />
              ) : null}

              {isLast ? (
                <span
                  aria-current="page"
                  className="inline-flex min-h-6 items-center font-medium text-foreground"
                >
                  {entry.name}
                </span>
              ) : (
                // `min-h-6` gives each crumb a 24px tap target without changing
                // the visual rhythm — they are standalone links, not inline text.
                <Link
                  href={entry.path}
                  className="inline-flex min-h-6 items-center rounded-sm transition-colors duration-(--duration-fast) hover:text-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
                >
                  {entry.name}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
