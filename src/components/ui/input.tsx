import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/utils/cn';

/**
 * Shared field styling. Input, textarea and select all use it so a focus ring or
 * border-radius change happens in exactly one place.
 */
export const fieldVariants = cva(
  [
    'w-full rounded-lg border bg-surface text-foreground',
    'placeholder:text-foreground-subtle',
    'transition-[border-color,box-shadow] duration-(--duration-fast) ease-(--ease-brand)',
    'focus:ring-4 focus:outline-none',
    'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-60',
    'read-only:bg-surface-muted',
  ],
  {
    variants: {
      tone: {
        default: 'border-border focus:border-accent focus:ring-brand-100',
        invalid: 'border-danger-500 focus:border-danger-500 focus:ring-danger-50',
      },
      inputSize: {
        sm: 'h-9 px-3 text-sm',
        md: 'h-11 px-4 text-sm',
        lg: 'h-13 px-4 text-base',
      },
    },
    defaultVariants: { tone: 'default', inputSize: 'md' },
  },
);

export interface InputProps
  extends
    Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>,
    VariantProps<typeof fieldVariants> {
  /** Rendered inside the field, before the text. */
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
}

export function Input({
  className,
  tone,
  inputSize,
  leadingIcon,
  trailingIcon,
  'aria-invalid': ariaInvalid,
  ...props
}: InputProps) {
  // A field marked invalid by the form should look invalid without the caller
  // having to remember to pass `tone` as well.
  const resolvedTone = tone ?? (ariaInvalid ? 'invalid' : 'default');

  const field = (
    <input
      className={cn(
        fieldVariants({ tone: resolvedTone, inputSize }),
        leadingIcon && 'pl-11',
        trailingIcon && 'pr-11',
        className,
      )}
      aria-invalid={ariaInvalid}
      {...props}
    />
  );

  if (!leadingIcon && !trailingIcon) return field;

  return (
    <div className="relative">
      {leadingIcon ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-foreground-subtle [&_svg]:size-4"
        >
          {leadingIcon}
        </span>
      ) : null}
      {field}
      {trailingIcon ? (
        <span className="absolute top-1/2 right-4 -translate-y-1/2 text-foreground-subtle [&_svg]:size-4">
          {trailingIcon}
        </span>
      ) : null}
    </div>
  );
}
