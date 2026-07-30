import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { MediaPlaceholder } from '@/components/common/media-placeholder';
import { Button } from '@/components/ui/button';
import { cn } from '@/utils/cn';

export interface PromoBannerProps {
  eyebrow?: string;
  title: string;
  description: string;
  href: string;
  cta: string;
  secondary?: { label: string; href: string };
  imageSeed: string;
  /** Small print — offer terms, expiry. */
  terms?: string;
  tone?: 'dark' | 'brand';
  className?: string;
}

/**
 * Seasonal promotional banner.
 *
 * Full-bleed and high-contrast so it interrupts the scroll deliberately once,
 * rather than competing with the product sections around it.
 *
 * Offer terms sit directly beneath the CTA: burying them is both a conversion
 * problem — the visitor distrusts the offer — and an FTC advertising risk.
 */
export function PromoBanner({
  eyebrow,
  title,
  description,
  href,
  cta,
  secondary,
  imageSeed,
  terms,
  tone = 'dark',
  className,
}: PromoBannerProps) {
  return (
    <section
      aria-labelledby="promo-title"
      className={cn(
        'relative isolate overflow-hidden rounded-3xl',
        tone === 'dark' ? 'bg-ink-900' : 'bg-brand-700',
        className,
      )}
    >
      <MediaPlaceholder
        seed={imageSeed}
        ratio="auto"
        tone={tone === 'dark' ? 'neutral' : 'brand'}
        className="absolute inset-0 -z-10 h-full opacity-25 mix-blend-luminosity"
      />

      <div className="grid gap-10 px-7 py-14 sm:px-12 sm:py-20 lg:grid-cols-2 lg:items-center lg:px-16">
        <div className="max-w-xl">
          {eyebrow ? <p className="text-eyebrow text-white/70 uppercase">{eyebrow}</p> : null}

          <h2 id="promo-title" className="mt-4 text-display-lg text-white">
            {title}
          </h2>

          <p className="mt-4 text-body-lg leading-relaxed text-white/75">{description}</p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Button size="lg" asChild>
              <Link href={href}>
                {cta}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>

            {secondary ? (
              <Button
                size="lg"
                variant="outline"
                asChild
                className="border-white/25 text-white hover:bg-white/10 hover:text-white"
              >
                <Link href={secondary.href}>{secondary.label}</Link>
              </Button>
            ) : null}
          </div>

          {terms ? <p className="mt-5 text-xs text-white/50">{terms}</p> : null}
        </div>
      </div>
    </section>
  );
}
