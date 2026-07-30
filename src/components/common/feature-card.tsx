import type { LucideIcon } from 'lucide-react';

import { cn } from '@/utils/cn';

export interface FeatureCardData {
  icon: LucideIcon;
  title: string;
  description: string;
}

export interface FeatureCardProps {
  feature: FeatureCardData;
  /** `bare` drops the border for use on an already-tinted band. */
  variant?: 'card' | 'bare' | 'inverse';
  className?: string;
}

/**
 * Feature / trust card.
 *
 * Three variants because the same content appears on white, on the tinted
 * "why shop with us" band, and on the dark brand-values section — one component,
 * not three near-identical ones.
 */
export function FeatureCard({ feature, variant = 'card', className }: FeatureCardProps) {
  const Icon = feature.icon;
  const inverse = variant === 'inverse';

  return (
    <div
      className={cn(
        'flex flex-col gap-4',
        variant === 'card' && 'rounded-2xl border border-border bg-surface p-6 sm:p-7',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex size-12 items-center justify-center rounded-xl',
          inverse ? 'bg-white/10 text-white' : 'bg-accent-soft text-accent-text',
        )}
      >
        <Icon className="size-5.5" strokeWidth={1.75} />
      </span>

      <div className="space-y-2">
        <h3
          className={cn(
            'font-sans text-base font-semibold',
            inverse ? 'text-white' : 'text-foreground',
          )}
        >
          {feature.title}
        </h3>
        <p
          className={cn(
            'text-body-sm leading-relaxed',
            inverse ? 'text-white/70' : 'text-foreground-muted',
          )}
        >
          {feature.description}
        </p>
      </div>
    </div>
  );
}
