import { ChevronDown } from 'lucide-react';

import { fieldVariants } from '@/components/ui/input';
import { cn } from '@/utils/cn';

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

/**
 * Native `<select>`.
 *
 * A custom listbox is only worth building when the design genuinely needs one
 * (multi-column swatches, search-in-list). Until then the native control gives us
 * correct mobile behaviour, keyboard support and screen-reader semantics for free.
 */
export function Select({
  className,
  children,
  'aria-invalid': ariaInvalid,
  ...props
}: SelectProps) {
  return (
    <div className="relative">
      <select
        className={cn(
          fieldVariants({ tone: ariaInvalid ? 'invalid' : 'default' }),
          'cursor-pointer appearance-none pr-11',
          className,
        )}
        aria-invalid={ariaInvalid}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-4 size-4 -translate-y-1/2 text-foreground-muted"
      />
    </div>
  );
}
