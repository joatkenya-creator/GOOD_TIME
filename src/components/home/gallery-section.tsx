// lucide v1 removed brand marks, so this uses a generic camera glyph rather
// than bundling a third-party logo we have no licence to ship.
import { Camera } from 'lucide-react';

import { Container } from '@/components/layout/container';
import { MediaPlaceholder } from '@/components/common/media-placeholder';
import { Reveal } from '@/components/motion/reveal';
import { siteConfig } from '@/config/site';
import { galleryItems } from '@/features/home/content';

/**
 * Social gallery.
 *
 * Closes the page with lifestyle imagery rather than another call to action —
 * the last impression should be the world the brand lives in.
 *
 * Rendered as a plain grid of links, not an embedded Instagram widget: a
 * third-party embed would cost a render-blocking script, a CSP exception and a
 * tracking cookie, for content we can serve ourselves.
 */
export function GallerySection() {
  return (
    <section aria-labelledby="gallery-title" className="pb-(--spacing-section)">
      <Container>
        <div className="mb-8 text-center">
          <p className="text-eyebrow text-accent-text uppercase">In the wild</p>
          <h2 id="gallery-title" className="mt-3 text-display-md text-foreground">
            Tag us with #IntimateBunnieShelf
          </h2>
          <a
            href={siteConfig.social.instagram}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex min-h-6 items-center gap-2 rounded-sm text-body-sm font-medium text-foreground hover:text-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
          >
            <Camera aria-hidden="true" className="size-4" />
            Follow along
            <span className="sr-only"> on Instagram (opens in a new tab)</span>
          </a>
        </div>
      </Container>

      <Reveal>
        <ul className="grid grid-cols-2 gap-2 px-2 sm:grid-cols-4 lg:grid-cols-8 lg:gap-3 lg:px-3">
          {galleryItems.map((item) => (
            <li key={item.seed}>
              <a
                href={siteConfig.social.instagram}
                target="_blank"
                rel="noopener noreferrer"
                className="group block overflow-hidden rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
              >
                <MediaPlaceholder
                  seed={item.seed}
                  ratio="square"
                  tone="mixed"
                  className="transition-transform duration-700 ease-(--ease-brand) group-hover:scale-110"
                />
                <span className="sr-only">
                  {item.label} — view on Instagram (opens in a new tab)
                </span>
              </a>
            </li>
          ))}
        </ul>
      </Reveal>
    </section>
  );
}
