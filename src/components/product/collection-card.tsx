import Link from 'next/link';

import { MediaPlaceholder } from '@/components/common/media-placeholder';
import { Button } from '@/components/ui/button';
import { cn } from '@/utils/cn';

export interface CollectionCardData {
  slug: string;
  title: string;
  eyebrow?: string;
  description: string;
  imageSeed: string;
  cta?: string;
}

export interface CollectionCardProps {
  collection: CollectionCardData;
  href: string;
  /** Flips the image to the right on desktop, for alternating editorial rows. */
  reversed?: boolean;
  className?: string;
}

/**
 * Collection card — an editorial, lifestyle-led presentation.
 *
 * Deliberately not a product card: collections sell a mood, so the copy gets
 * room to breathe and the image carries the weight. Alternating `reversed` rows
 * are what stop a stack of these reading as a template.
 */
export function CollectionCard({
  collection,
  href,
  reversed = false,
  className,
}: CollectionCardProps) {
  return (
    <article
      className={cn(
        'group grid items-center gap-8 lg:grid-cols-2 lg:gap-14',
        reversed && 'lg:[&>figure]:order-2',
        className,
      )}
    >
      <figure className="overflow-hidden rounded-3xl">
        <MediaPlaceholder
          seed={collection.imageSeed}
          label={collection.title}
          ratio="landscape"
          tone="brand"
          className="transition-transform duration-700 ease-(--ease-brand) group-hover:scale-[1.03]"
        />
      </figure>

      <div className="max-w-lg">
        {collection.eyebrow ? (
          <p className="text-eyebrow text-accent-text uppercase">{collection.eyebrow}</p>
        ) : null}

        <h3 className="mt-4 text-display-md text-foreground">{collection.title}</h3>

        <p className="mt-4 text-body leading-relaxed text-foreground-muted">
          {collection.description}
        </p>

        <Button variant="outline" className="mt-7" asChild>
          <Link href={href}>
            {collection.cta ?? 'Explore the collection'}
            <span className="sr-only"> {collection.title}</span>
          </Link>
        </Button>
      </div>
    </article>
  );
}
