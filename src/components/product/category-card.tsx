import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';

import { MediaPlaceholder } from '@/components/common/media-placeholder';
import { cn } from '@/utils/cn';

export interface CategoryCardData {
  slug: string;
  name: string;
  productCount?: number;
  imageSeed: string;
}

export interface CategoryCardProps {
  category: CategoryCardData;
  /** `feature` spans two grid cells and uses a wider crop. */
  size?: 'default' | 'feature';
  href: string;
  className?: string;
}

/**
 * Category tile.
 *
 * The label sits on a gradient scrim rather than directly on the artwork, which
 * keeps text contrast above 4.5:1 no matter what the underlying image is — the
 * usual failure mode for "text over photo" tiles.
 */
export function CategoryCard({ category, size = 'default', href, className }: CategoryCardProps) {
  return (
    <Link
      href={href}
      className={cn(
        'group relative isolate flex overflow-hidden rounded-2xl',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)',
        className,
      )}
    >
      <MediaPlaceholder
        seed={category.imageSeed}
        ratio={size === 'feature' ? 'landscape' : 'portrait'}
        tone="mixed"
        className="w-full transition-transform duration-700 ease-(--ease-brand) group-hover:scale-[1.05]"
      />

      <span
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-ink-900/75 via-ink-900/20 to-transparent"
      />

      <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-5 sm:p-6">
        <span>
          <span
            className={cn(
              'block font-display tracking-tight text-white',
              size === 'feature' ? 'text-display-sm' : 'text-xl',
            )}
          >
            {category.name}
          </span>
          {category.productCount ? (
            <span className="mt-1 block text-body-sm text-white/75">
              {category.productCount} products
            </span>
          ) : null}
        </span>

        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-colors duration-(--duration-base) group-hover:bg-accent">
          <ArrowUpRight aria-hidden="true" className="size-5" />
        </span>
      </span>
    </Link>
  );
}
