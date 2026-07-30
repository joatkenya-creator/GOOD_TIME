'use client';

import { useFormStatus } from 'react-dom';

import { Button, type ButtonProps } from '@/components/ui/button';

/**
 * Submit button that derives its pending state from the enclosing form.
 *
 * Works with Server Actions out of the box — no `isSubmitting` state to thread
 * through, and no chance of the button and the form disagreeing about whether a
 * submission is in flight.
 *
 * For React Hook Form's client-side `handleSubmit`, pass `isLoading` explicitly
 * instead; `useFormStatus` only tracks native form submissions.
 */
export function SubmitButton({ isLoading, children, ...props }: ButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" isLoading={isLoading ?? pending} {...props}>
      {children}
    </Button>
  );
}
