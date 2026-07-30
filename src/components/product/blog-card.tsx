import Link from 'next/link';

import { MediaPlaceholder } from '@/components/common/media-placeholder';
import { Badge } from '@/components/ui/badge';
import { ROUTES } from '@/constants/routes';
import { cn } from '@/utils/cn';
import { formatDate } from '@/utils/format';

export interface BlogCardData {
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  publishedAt: string;
  readingMinutes: number;
  imageSeed: string;
}

export interface BlogCardProps {
  post: BlogCardData;
  className?: string;
}

/**
 * Editorial card for the journal.
 *
 * The date is a real `<time datetime>` so it is machine-readable, and the whole
 * card is one stretched link for the same reason as the product card.
 */
export function BlogCard({ post, className }: BlogCardProps) {
  return (
    <article className={cn('group relative flex flex-col', className)}>
      <div className="overflow-hidden rounded-2xl">
        <MediaPlaceholder
          seed={post.imageSeed}
          ratio="landscape"
          tone="neutral"
          className="transition-transform duration-700 ease-(--ease-brand) group-hover:scale-[1.04]"
        />
      </div>

      <div className="mt-5 flex flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="accent">{post.category}</Badge>
          <span className="text-xs text-foreground-subtle">
            <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
            <span aria-hidden="true"> · </span>
            {post.readingMinutes} min read
          </span>
        </div>

        <h3 className="mt-3 font-display text-xl leading-snug tracking-tight text-foreground">
          <Link
            href={ROUTES.post(post.slug)}
            className="before:absolute before:inset-0 before:content-[''] hover:text-accent-text focus-visible:outline-none"
          >
            {post.title}
          </Link>
        </h3>

        <p className="mt-2.5 line-clamp-2 text-body-sm leading-relaxed text-foreground-muted">
          {post.excerpt}
        </p>
      </div>
    </article>
  );
}
