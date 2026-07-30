import { Slot } from '@/components/ui/slot';
import { Spinner } from '@/components/ui/spinner';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/utils/cn';

/**
 * Button.
 *
 * The full interaction contract lives in one place: focus ring, disabled state,
 * loading state, and the press micro-interaction. Nothing in the app should be a
 * hand-rolled `<button className="...">`.
 *
 * `asChild` renders the styling onto a child element — the standard escape hatch
 * for "a link that looks like a button" without nesting an `<a>` in a `<button>`.
 */
const buttonVariants = cva(
  [
    'relative inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap',
    'transition-[background-color,color,border-color,box-shadow,transform]',
    'duration-(--duration-fast) ease-(--ease-brand)',
    'active:scale-[0.985]',
    'disabled:pointer-events-none disabled:opacity-50',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-accent text-white shadow-xs hover:bg-accent-hover hover:shadow-brand',
        secondary: 'bg-ink-700 text-white shadow-xs hover:bg-ink-800',
        outline:
          'border border-border-strong bg-transparent text-foreground hover:bg-surface-muted',
        ghost: 'bg-transparent text-foreground hover:bg-surface-muted',
        subtle: 'bg-accent-soft text-brand-700 hover:bg-brand-100',
        danger: 'bg-danger-500 text-white shadow-xs hover:bg-danger-700',
        link: 'text-accent underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-9 rounded-md px-3.5 text-sm [&_svg]:size-4',
        md: 'h-11 rounded-lg px-5 text-sm [&_svg]:size-4',
        lg: 'h-13 rounded-lg px-7 text-base [&_svg]:size-5',
        icon: 'size-11 rounded-lg [&_svg]:size-5',
      },
      fullWidth: {
        true: 'w-full',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Disables the button and swaps the content for a spinner. */
  isLoading?: boolean;
  loadingLabel?: string;
}

export function Button({
  className,
  variant,
  size,
  fullWidth,
  asChild = false,
  isLoading = false,
  loadingLabel = 'Working…',
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot : 'button';

  return (
    <Component
      className={cn(buttonVariants({ variant, size, fullWidth }), className)}
      disabled={disabled || isLoading}
      // Screen readers get the busy state; sighted users get the spinner.
      aria-busy={isLoading || undefined}
      {...props}
    >
      {isLoading ? (
        <>
          <Spinner size="sm" label={null} />
          <span className="sr-only">{loadingLabel}</span>
          <span aria-hidden="true">{children}</span>
        </>
      ) : (
        children
      )}
    </Component>
  );
}

export { buttonVariants };
