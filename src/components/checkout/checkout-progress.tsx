'use client';

import { Check } from 'lucide-react';

import { cn } from '@/utils/cn';

export const CHECKOUT_STEPS = ['Contact', 'Shipping', 'Payment', 'Review'] as const;
export type CheckoutStep = (typeof CHECKOUT_STEPS)[number];

/**
 * Step indicator.
 *
 * Progress is the single cheapest thing you can give someone in a checkout: it
 * answers "how much longer" before they ask, which is the moment they leave.
 *
 * Completed steps are buttons, upcoming steps are not. Letting someone jump
 * forward to Payment before an address exists produces an error they did not
 * cause; letting them jump back to fix a typo is the whole point.
 */
export function CheckoutProgress({
  current,
  furthest,
  onNavigate,
}: {
  current: CheckoutStep;
  /** The furthest step reached, so completed steps stay reachable after going back. */
  furthest: CheckoutStep;
  onNavigate: (step: CheckoutStep) => void;
}) {
  const currentIndex = CHECKOUT_STEPS.indexOf(current);
  const furthestIndex = CHECKOUT_STEPS.indexOf(furthest);

  return (
    <nav aria-label="Checkout progress">
      <ol className="flex items-center gap-1 sm:gap-2">
        {CHECKOUT_STEPS.map((step, index) => {
          const isCurrent = index === currentIndex;
          const isDone = index < furthestIndex;
          const reachable = index <= furthestIndex;

          return (
            <li key={step} className="flex flex-1 items-center gap-1 sm:gap-2">
              <button
                type="button"
                onClick={() => reachable && onNavigate(step)}
                disabled={!reachable}
                aria-current={isCurrent ? 'step' : undefined}
                className={cn(
                  'flex min-h-11 flex-1 flex-col items-start gap-1.5 rounded-lg px-1 py-1.5 text-left',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)',
                  reachable && !isCurrent && 'hover:bg-surface-muted',
                  !reachable && 'cursor-default',
                )}
              >
                <span
                  className={cn(
                    'h-1 w-full rounded-full transition-colors',
                    isCurrent || isDone ? 'bg-accent' : 'bg-border',
                  )}
                />

                <span
                  className={cn(
                    'text-body-xs flex items-center gap-1 font-medium',
                    isCurrent
                      ? 'text-accent-text'
                      : isDone
                        ? 'text-foreground'
                        : 'text-foreground-subtle',
                  )}
                >
                  {isDone ? <Check aria-hidden="true" className="size-3" /> : null}
                  {step}
                  {isDone ? <span className="sr-only"> — completed</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
