'use client';

import { useEffect } from 'react';

import { Container } from '@/components/layout/container';
import { Button } from '@/components/ui/button';

/**
 * Route-level error boundary.
 *
 * `error.digest` is the only identifier that ties what the customer saw to the
 * server log line — the message itself is redacted in production builds.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Route error', { digest: error.digest, message: error.message });
  }, [error]);

  return (
    <Container
      as="main"
      width="narrow"
      className="flex min-h-dvh flex-col items-center justify-center py-24 text-center"
    >
      <p className="text-eyebrow text-accent uppercase">Something went wrong</p>
      <h1 className="mt-4 text-display-lg text-foreground">We hit a snag</h1>
      <p className="mt-4 text-base leading-relaxed text-foreground-muted">
        The issue has been logged. Try again, and contact us if it keeps happening.
      </p>

      {error.digest ? (
        <p className="mt-6 font-mono text-xs text-foreground-subtle">Reference: {error.digest}</p>
      ) : null}

      <Button className="mt-8" onClick={reset}>
        Try again
      </Button>
    </Container>
  );
}
