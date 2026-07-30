import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/utils/cn';

export interface PaginationProps {
  page: number;
  totalPages: number;
  /** Builds the href for a page number — keeps this component route-agnostic. */
  buildHref: (page: number) => string;
  className?: string;
}

/**
 * Pagination as real links.
 *
 * Anchors rather than buttons so pages are crawlable, middle-clickable and
 * shareable — a JS-only pager hides an entire catalogue from search engines.
 *
 * Long ranges collapse to `1 … 4 5 6 … 20`, which keeps the control a fixed
 * width no matter how many pages exist.
 */
export function Pagination({ page, totalPages, buildHref, className }: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages = pageWindow(page, totalPages);

  return (
    <nav
      aria-label="Pagination"
      className={cn('flex items-center justify-center gap-1', className)}
    >
      <PageLink
        href={buildHref(page - 1)}
        disabled={page <= 1}
        label="Previous page"
        className="pr-3.5 pl-3"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
        <span className="hidden sm:inline">Previous</span>
      </PageLink>

      <ul className="flex items-center gap-1">
        {pages.map((entry, index) =>
          entry === 'gap' ? (
            <li key={`gap-${index}`} aria-hidden="true" className="px-2 text-foreground-subtle">
              …
            </li>
          ) : (
            <li key={entry}>
              <Link
                href={buildHref(entry)}
                aria-label={`Page ${entry}`}
                aria-current={entry === page ? 'page' : undefined}
                className={cn(
                  'flex size-10 items-center justify-center rounded-md text-sm font-medium',
                  'transition-colors duration-(--duration-fast) ease-(--ease-brand)',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)',
                  entry === page
                    ? 'bg-foreground text-white'
                    : 'text-foreground-muted hover:bg-surface-muted hover:text-foreground',
                )}
              >
                {entry}
              </Link>
            </li>
          ),
        )}
      </ul>

      <PageLink
        href={buildHref(page + 1)}
        disabled={page >= totalPages}
        label="Next page"
        className="pr-3 pl-3.5"
      >
        <span className="hidden sm:inline">Next</span>
        <ChevronRight aria-hidden="true" className="size-4" />
      </PageLink>
    </nav>
  );
}

function PageLink({
  href,
  disabled,
  label,
  className,
  children,
}: {
  href: string;
  disabled: boolean;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  const styles = cn(
    'flex h-10 items-center gap-1.5 rounded-md text-sm font-medium',
    'transition-colors duration-(--duration-fast) ease-(--ease-brand)',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)',
    className,
  );

  // A disabled link is a `<span>`, not an anchor with a click handler that
  // swallows the event — there is nothing to navigate to.
  if (disabled) {
    return (
      <span
        aria-disabled="true"
        className={cn(styles, 'cursor-not-allowed text-foreground-subtle')}
      >
        {children}
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-label={label}
      className={cn(styles, 'text-foreground-muted hover:bg-surface-muted hover:text-foreground')}
    >
      {children}
    </Link>
  );
}

/** `1 … 4 5 6 … 20` — always the first, last, current and its neighbours. */
function pageWindow(page: number, totalPages: number): (number | 'gap')[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);

  const middle = [page - 1, page, page + 1].filter((entry) => entry > 1 && entry < totalPages);
  const result: (number | 'gap')[] = [1];

  if ((middle[0] ?? totalPages) > 2) result.push('gap');
  result.push(...middle);
  if ((middle.at(-1) ?? 1) < totalPages - 1) result.push('gap');
  result.push(totalPages);

  return result;
}
