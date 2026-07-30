'use client';

import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/utils/cn';

const schema = z.object({ email: z.email('Enter a valid email address.') });

export interface NewsletterFormProps {
  /** `inverse` for use on a dark band. */
  variant?: 'default' | 'inverse';
  className?: string;
}

/**
 * Newsletter signup.
 *
 * Validates against the same Zod primitive the server will use, so the rules
 * cannot drift once the endpoint exists. Submission is a no-op in phase 2 —
 * wiring it to an audience list belongs with the email phase.
 *
 * The status message is a live region, so the success confirmation is announced
 * rather than only appearing visually.
 */
export function NewsletterForm({ variant = 'default', className }: NewsletterFormProps) {
  const inverse = variant === 'inverse';
  const [status, setStatus] = useState<'idle' | 'error' | 'done'>('idle');
  const [message, setMessage] = useState('');

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const parsed = schema.safeParse({ email: formData.get('email') });

    if (!parsed.success) {
      setStatus('error');
      setMessage(parsed.error.issues[0]?.message ?? 'Enter a valid email address.');
      return;
    }

    setStatus('done');
    setMessage('You are on the list. Look out for a welcome note.');
    event.currentTarget.reset();
  }

  return (
    <form onSubmit={onSubmit} noValidate className={cn('w-full', className)}>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <label htmlFor="newsletter-email" className="sr-only">
            Email address
          </label>
          <Input
            id="newsletter-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            inputSize="lg"
            aria-invalid={status === 'error' ? true : undefined}
            aria-describedby="newsletter-status"
            className={cn(
              inverse && 'border-white/20 bg-white/10 text-white placeholder:text-white/50',
            )}
          />
        </div>

        <Button type="submit" size="lg" variant={inverse ? 'secondary' : 'primary'}>
          Subscribe
          <ArrowRight aria-hidden="true" />
        </Button>
      </div>

      <p
        id="newsletter-status"
        role="status"
        aria-live="polite"
        className={cn(
          'mt-3 min-h-5 text-body-sm',
          status === 'error' && 'font-medium text-danger-700',
          status === 'done' && (inverse ? 'text-white/80' : 'text-success-700'),
          status === 'idle' && (inverse ? 'text-white/60' : 'text-foreground-subtle'),
        )}
      >
        {status === 'idle' ? 'No spam. Discreet subject lines. Unsubscribe any time.' : message}
      </p>
    </form>
  );
}
