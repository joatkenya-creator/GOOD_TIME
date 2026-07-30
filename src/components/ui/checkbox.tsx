import { cn } from '@/utils/cn';

export type CheckboxProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>;

/**
 * Native checkbox with brand styling via `accent-color`. One CSS property does
 * what a custom control would need a dozen lines and an ARIA contract for.
 */
export function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <input
      type="checkbox"
      className={cn(
        'size-4.5 shrink-0 cursor-pointer rounded-xs border-border accent-(--color-accent)',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
