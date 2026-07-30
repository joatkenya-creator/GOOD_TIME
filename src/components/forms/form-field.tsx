'use client';

import { useId } from 'react';

import { cn } from '@/utils/cn';

export interface FormFieldProps {
  label: string;
  /** Field control. Receives the ids it needs to be accessible. */
  children: (props: {
    id: string;
    'aria-invalid': boolean | undefined;
    'aria-describedby': string | undefined;
  }) => React.ReactNode;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
}

/**
 * Accessible field wrapper.
 *
 * Wires up the four things every form control needs and every hand-rolled field
 * eventually gets wrong: a `<label for>`, `aria-invalid`, `aria-describedby`
 * pointing at the hint *and* the error, and an error announced politely.
 *
 * Render-prop rather than `cloneElement` so it works with any control —
 * `<Input>`, `<Select>`, a third-party card element — without knowing its API.
 */
export function FormField({ label, children, error, hint, required, className }: FormFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className={cn('space-y-2', className)}>
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-1 text-accent">
            *
          </span>
        ) : null}
      </label>

      {children({
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy || undefined,
      })}

      {hint && !error ? (
        <p id={hintId} className="text-xs leading-relaxed text-foreground-muted">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
