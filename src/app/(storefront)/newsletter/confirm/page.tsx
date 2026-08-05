import { CheckCircle2, XCircle } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Container } from '@/components/layout/container';
import { Button } from '@/components/ui/button';
import { ROUTES } from '@/constants/routes';
import { prisma } from '@/lib/prisma';

/**
 * Double opt-in confirmation and unsubscribe.
 *
 * Both live here because they are the same operation with opposite signs, and
 * both are driven by the single-use token from the email — never by an email
 * address in the URL, which would let anyone unsubscribe anyone.
 *
 * Unsubscribe works on GET with no confirmation step. That is deliberate: CAN-SPAM
 * requires one click, and an "are you sure?" between a customer and the exit is
 * the fastest route to a spam complaint.
 */
export const metadata: Metadata = {
  title: 'Newsletter',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function NewsletterConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; action?: string }>;
}) {
  const { token, action } = await searchParams;
  const unsubscribing = action === 'unsubscribe';

  const subscriber = token
    ? await prisma.newsletterSubscriber.findUnique({ where: { token } })
    : null;

  if (subscriber) {
    await prisma.newsletterSubscriber.update({
      where: { id: subscriber.id },
      data: unsubscribing
        ? { unsubscribedAt: new Date() }
        : { confirmedAt: subscriber.confirmedAt ?? new Date(), unsubscribedAt: null },
    });
  }

  const ok = Boolean(subscriber);

  return (
    <Container className="max-w-md py-20 text-center">
      <div
        className={`mx-auto flex size-14 items-center justify-center rounded-full ${
          ok ? 'bg-accent-subtle' : 'bg-surface-muted'
        }`}
      >
        {ok ? (
          <CheckCircle2 aria-hidden="true" className="size-7 text-accent-text" />
        ) : (
          <XCircle aria-hidden="true" className="size-7 text-foreground-subtle" />
        )}
      </div>

      <h1 className="text-h3 mt-5 font-bold text-foreground">
        {!ok
          ? 'That link is no longer valid'
          : unsubscribing
            ? 'You are unsubscribed'
            : 'You are on the list'}
      </h1>

      <p className="mt-3 text-body-sm text-foreground-muted">
        {!ok
          ? 'The link may have expired or already been used. Nothing has changed.'
          : unsubscribing
            ? 'We will not email you again. Transactional emails about orders you place will still come through.'
            : 'New arrivals, guides and the occasional offer — with nothing explicit in the subject line.'}
      </p>

      <Button asChild className="mt-6">
        <Link href={ROUTES.shop}>Continue shopping</Link>
      </Button>
    </Container>
  );
}
