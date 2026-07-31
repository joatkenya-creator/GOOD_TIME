'use client';

import { Play, ZoomIn } from 'lucide-react';
import { useState } from 'react';

import { MediaPlaceholder } from '@/components/common/media-placeholder';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/utils/cn';

export interface GalleryItem {
  id: string;
  seed: string;
  alt: string;
  type: 'IMAGE' | 'VIDEO' | 'DOCUMENT';
}

export interface ProductGalleryProps {
  items: GalleryItem[];
  productName: string;
}

/**
 * Product gallery.
 *
 * Thumbnails are a real `tablist`, so arrow keys move between views — the
 * behaviour a keyboard user expects and almost never gets from a gallery built
 * out of divs.
 *
 * Zoom opens a dialog rather than using a hover-magnifier: hover zoom does not
 * exist on touch, which is most of this traffic, and a full-size view is more
 * useful than a moving loupe anyway.
 */
export function ProductGallery({ items, productName }: ProductGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [zoomOpen, setZoomOpen] = useState(false);

  const active = items[activeIndex] ?? items[0];
  if (!active) return null;

  function onKeyDown(event: React.KeyboardEvent) {
    const moves: Record<string, number> = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1,
    };
    const delta = moves[event.key];
    if (delta === undefined) return;

    event.preventDefault();
    setActiveIndex((index) => (index + delta + items.length) % items.length);
  }

  return (
    // `min-w-0` throughout: this sits in a CSS grid, and a grid child defaults to
    // `min-width: auto`, so without it the thumbnail rail's intrinsic width
    // (5 x 64px + gaps = 360px) forces the whole column wider than the viewport
    // on a phone. Measured at 360px: the gallery was 380px in a 320px column.
    <div className="flex min-w-0 flex-col gap-4 lg:flex-row-reverse lg:gap-5">
      <div className="relative min-w-0 flex-1">
        <button
          type="button"
          onClick={() => setZoomOpen(true)}
          aria-label={`Enlarge image ${activeIndex + 1} of ${items.length}`}
          className="group relative block w-full overflow-hidden rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
        >
          <MediaPlaceholder
            seed={active.seed}
            label={active.alt}
            ratio="product"
            tone="mixed"
            className="transition-transform duration-700 ease-(--ease-brand) group-hover:scale-[1.03]"
          />

          <span
            aria-hidden="true"
            className="absolute right-4 bottom-4 flex size-10 items-center justify-center rounded-full bg-surface/90 text-foreground shadow-sm backdrop-blur transition-opacity group-hover:opacity-100 sm:opacity-0"
          >
            {active.type === 'VIDEO' ? <Play className="size-4" /> : <ZoomIn className="size-4" />}
          </span>
        </button>

        <p className="mt-2 text-center text-xs text-foreground-subtle lg:hidden">
          {activeIndex + 1} / {items.length}
        </p>
      </div>

      {items.length > 1 ? (
        <div
          role="tablist"
          aria-label={`${productName} images`}
          aria-orientation="vertical"
          onKeyDown={onKeyDown}
          className="flex min-w-0 gap-2.5 overflow-x-auto lg:w-20 lg:flex-col lg:overflow-visible"
        >
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={index === activeIndex}
              aria-label={`View image ${index + 1}: ${item.alt}`}
              tabIndex={index === activeIndex ? 0 : -1}
              onClick={() => setActiveIndex(index)}
              className={cn(
                'relative w-16 shrink-0 overflow-hidden rounded-lg transition-all duration-(--duration-fast) lg:w-full',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)',
                index === activeIndex
                  ? 'ring-2 ring-accent ring-offset-2'
                  : 'opacity-65 hover:opacity-100',
              )}
            >
              <MediaPlaceholder seed={item.seed} ratio="product" tone="mixed" />
              {item.type === 'VIDEO' ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-0 flex items-center justify-center bg-ink-900/30 text-white"
                >
                  <Play className="size-4" />
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      <Modal
        open={zoomOpen}
        onClose={() => setZoomOpen(false)}
        title={productName}
        description={`Image ${activeIndex + 1} of ${items.length}`}
        size="lg"
      >
        <MediaPlaceholder
          seed={active.seed}
          label={active.alt}
          ratio="square"
          tone="mixed"
          className="rounded-xl"
        />
        <p className="mt-4 text-center text-body-sm text-foreground-muted">{active.alt}</p>
      </Modal>
    </div>
  );
}
