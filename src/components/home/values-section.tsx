import { Container } from '@/components/layout/container';
import { FeatureCard } from '@/components/common/feature-card';
import { Reveal } from '@/components/motion/reveal';
import { brandValues } from '@/features/home/content';

/**
 * Brand values.
 *
 * The only dark section on the page. Inverting the surface here does two things:
 * it gives the page a structural full stop before the softer journal and
 * newsletter sections, and it separates "what we promise" from "what we sell".
 *
 * The icons are the lucide set used consistently across the design system rather
 * than bespoke illustration — one visual language, and no 200KB of SVG.
 */
export function ValuesSection() {
  return (
    <section
      aria-labelledby="values-title"
      className="bg-surface-inverse py-(--spacing-section) text-white"
    >
      <Container>
        <div className="mb-14 max-w-2xl">
          <p className="text-eyebrow text-brand-300 uppercase">What we stand for</p>
          <h2 id="values-title" className="mt-3 text-display-lg text-white">
            Standards we will not trade away
          </h2>
          <p className="mt-4 text-body leading-relaxed text-white/65">
            Four commitments that decide what gets stocked, how it ships and how we talk about it.
          </p>
        </div>

        <ul className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {brandValues.map((value, index) => (
            <li key={value.title}>
              <Reveal delay={Math.min(index * 0.07, 0.28)}>
                <FeatureCard feature={value} variant="inverse" />
              </Reveal>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
