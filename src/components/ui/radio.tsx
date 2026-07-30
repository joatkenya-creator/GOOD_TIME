import { cn } from '@/utils/cn';

export type RadioProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>;

/**
 * Native radio, brand-tinted via `accent-color`.
 *
 * One CSS property replaces the custom control, the ARIA contract and the
 * arrow-key handling a hand-rolled version would need — the browser already
 * groups radios by `name` and moves focus between them correctly.
 */
export function Radio({ className, ...props }: RadioProps) {
  return (
    <input
      type="radio"
      className={cn(
        'size-4.5 shrink-0 cursor-pointer border-border accent-(--color-accent)',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export interface RadioGroupProps extends React.FieldsetHTMLAttributes<HTMLFieldSetElement> {
  legend: string;
  /** Visually hide the legend while keeping it for screen readers. */
  hideLegend?: boolean;
}

/**
 * Groups radios in a `<fieldset>` so assistive technology announces the question
 * alongside each option. A `<div>` of radios is a common and costly a11y miss.
 */
export function RadioGroup({
  legend,
  hideLegend = false,
  className,
  children,
  ...props
}: RadioGroupProps) {
  return (
    <fieldset className={cn('space-y-3', className)} {...props}>
      <legend className={cn('text-sm font-medium text-foreground', hideLegend && 'sr-only')}>
        {legend}
      </legend>
      {children}
    </fieldset>
  );
}
