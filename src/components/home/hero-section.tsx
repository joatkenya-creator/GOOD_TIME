import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { Container } from '@/components/layout/container';
import { MediaPlaceholder } from '@/components/common/media-placeholder';
import { Counter } from '@/components/motion/counter';
import { Reveal } from '@/components/motion/reveal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { hero } from '@/features/home/content';

/**
 * Hero.
 *
 * Asymmetric by design: an 11/9 split rather than a centred banner, so the
 * headline anchors the left edge and the artwork bleeds off the right. Centred
 * heroes are the single strongest "template" signal on an ecommerce homepage.
 *
 * The `<h1>` is the only one on the page. The stat row sits inside the hero
 * rather than in its own band, because trust numbers work hardest next to the
 * primary call to action.
 */
export function HeroSection() {
  return (
    <section
      aria-labelledby="hero-title"
      className="relative overflow-hidden bg-surface pt-12 pb-16 sm:pt-16 lg:pt-20 lg:pb-24"
    >
      {/* Soft brand wash anchored behind the artwork. */}
      <span
        aria-hidden="true"
        className="absolute top-0 right-0 -z-10 hidden h-[42rem] w-[46rem] rounded-full bg-brand-50 blur-3xl lg:block"
      />

      <Container className="grid items-center gap-12 lg:grid-cols-[11fr_9fr] lg:gap-16">
        <div className="max-w-2xl">
          <Reveal>
            <Badge variant="accent" uppercase>
              {hero.eyebrow}
            </Badge>
          </Reveal>

          <Reveal delay={0.08}>
            <h1 id="hero-title" className="mt-6 text-display-2xl text-foreground">
              {hero.title}
            </h1>
          </Reveal>

          <Reveal delay={0.16}>
            <p className="mt-6 max-w-xl text-body-lg leading-relaxed text-foreground-muted">
              {hero.description}
            </p>
          </Reveal>

          <Reveal delay={0.24}>
            <div className="mt-9 flex flex-wrap gap-3">
              <Button size="lg" asChild>
                <Link href={hero.primaryCta.href}>
                  {hero.primaryCta.label}
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>

              <Button size="lg" variant="outline" asChild>
                <Link href={hero.secondaryCta.href}>{hero.secondaryCta.label}</Link>
              </Button>
            </div>
          </Reveal>

          <Reveal delay={0.32}>
            <dl className="mt-12 grid grid-cols-3 gap-6 border-t border-border pt-8">
              {hero.stats.map((stat) => (
                <div key={stat.label}>
                  <dt className="sr-only">{stat.label}</dt>
                  <dd>
                    <span className="block font-display text-display-sm tracking-tight text-foreground">
                      {stat.isDecimal ? (
                        stat.value.toFixed(1)
                      ) : (
                        <Counter to={stat.value} suffix={stat.suffix ?? ''} />
                      )}
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-foreground-muted">
                      {stat.label}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </Reveal>
        </div>

        <Reveal direction="left" delay={0.12}>
          <div className="relative">
            <MediaPlaceholder
              seed={hero.imageSeed}
              label="Lifestyle hero"
              ratio="portrait"
              tone="brand"
              className="rounded-3xl shadow-lg"
            />

            {/* Floating proof card — breaks the rectangle and adds depth. */}
            <div className="absolute -bottom-6 -left-6 hidden max-w-56 rounded-2xl border border-border bg-surface p-5 shadow-lg sm:block">
              <p className="font-display text-2xl tracking-tight text-foreground">100%</p>
              <p className="mt-1 text-xs leading-relaxed text-foreground-muted">
                Non-porous materials only. No exceptions.
              </p>
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
