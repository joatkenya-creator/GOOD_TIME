import 'server-only';

import type { EmailSuppressionType } from '@/generated/prisma/enums';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

/**
 * The suppression list.
 *
 * ## Why this exists
 *
 * Sending to an address that hard-bounced, repeatedly, is the fastest way to
 * destroy a sending reputation — and reputation is shared across the whole
 * domain. One ignored bounce list degrades password-reset delivery for
 * everybody, and that failure is invisible until a customer says they never got
 * the email.
 *
 * ## Hard versus soft
 *
 * A hard bounce means the mailbox does not exist. Permanent, act immediately.
 *
 * A soft bounce is temporary — a full mailbox, a greylisting server, an
 * out-of-office autoresponder loop. Suppressing on the first one loses a
 * customer over a busy inbox, so they are counted instead and promoted to hard
 * at three inside a week.
 *
 * ## Complaints are absolute
 *
 * Someone who pressed "report spam" must never receive marketing again,
 * regardless of what any preference screen says afterwards. Transactional mail
 * about an order they actually placed is a separate judgement: a receipt for a
 * purchase is not marketing, and withholding it is its own failure.
 */

/** Soft bounces inside this window that promote to a hard suppression. */
const SOFT_BOUNCE_LIMIT = 3;
const SOFT_BOUNCE_WINDOW_DAYS = 7;

/**
 * Whether an address may be sent to.
 *
 * `kind` matters. A suppressed address still gets the receipt for an order they
 * placed — that is a legal and practical obligation, and a complaint about a
 * newsletter says nothing about whether they want to know their parcel shipped.
 * Only a hard bounce blocks everything, because there is genuinely nowhere to
 * deliver it.
 */
export async function canSend(
  email: string,
  kind: 'transactional' | 'marketing',
): Promise<boolean> {
  const suppression = await prisma.emailSuppression.findUnique({
    where: { email: email.toLowerCase() },
    select: { reason: true, releasedAt: true },
  });

  if (!suppression || suppression.releasedAt) return true;

  // Nowhere to deliver it. Nothing gets through.
  if (suppression.reason === 'HARD_BOUNCE') return false;

  // A complaint or an operator block stops marketing, not a receipt.
  return kind === 'transactional';
}

/** Bulk variant, for the newsletter. One query rather than one per recipient. */
export async function filterSendable(emails: string[]): Promise<string[]> {
  const lowered = emails.map((email) => email.toLowerCase());

  const suppressed = await prisma.emailSuppression.findMany({
    where: { email: { in: lowered }, releasedAt: null },
    select: { email: true },
  });

  const blocked = new Set(suppressed.map((row) => row.email));
  return lowered.filter((email) => !blocked.has(email));
}

export interface SuppressionInput {
  email: string;
  reason: EmailSuppressionType;
  providerMessageId?: string | null;
  detail?: string | null;
}

/**
 * Records a hard bounce or a complaint.
 *
 * Idempotent: the provider retries its webhook, and the same bounce arriving
 * twice must not look like two problems.
 */
export async function suppress(input: SuppressionInput): Promise<void> {
  const email = input.email.toLowerCase();

  await prisma.emailSuppression.upsert({
    where: { email },
    create: {
      email,
      reason: input.reason,
      providerMessageId: input.providerMessageId ?? null,
      detail: input.detail?.slice(0, 500) ?? null,
      lastBounceAt: new Date(),
    },
    update: {
      reason: input.reason,
      detail: input.detail?.slice(0, 500) ?? null,
      lastBounceAt: new Date(),
      // Re-suppressing clears a manual release: the address bounced again, so
      // whatever the customer fixed is not fixed.
      releasedAt: null,
      releasedBy: null,
    },
  });

  /*
   * A complaint also unsubscribes, permanently.
   *
   * Leaving the newsletter row confirmed means the next campaign includes them
   * again — the suppression list would catch it, but "we kept trying and were
   * blocked" is not the same as "we stopped".
   */
  if (input.reason === 'COMPLAINT') {
    await prisma.newsletterSubscriber
      .updateMany({ where: { email }, data: { unsubscribedAt: new Date() } })
      .catch(() => undefined);

    await prisma.user
      .updateMany({ where: { email }, data: { acceptsMarketing: false } })
      .catch(() => undefined);
  }

  logger.warn('email.suppressed', { email, reason: input.reason });
}

/**
 * Records a soft bounce, promoting it to hard once it stops looking temporary.
 *
 * The window matters: three bounces over eight months is a mailbox that is
 * occasionally full. Three in a week is a mailbox that is gone.
 */
export async function recordSoftBounce(input: SuppressionInput): Promise<'counted' | 'promoted'> {
  const email = input.email.toLowerCase();
  const cutoff = new Date(Date.now() - SOFT_BOUNCE_WINDOW_DAYS * 86_400_000);

  const existing = await prisma.emailSuppression.findUnique({ where: { email } });

  // Outside the window, the count starts again rather than accumulating over
  // years into a suppression nobody can explain.
  const stale = !existing?.lastBounceAt || existing.lastBounceAt < cutoff;
  const count = stale ? 1 : existing.softBounceCount + 1;

  if (count >= SOFT_BOUNCE_LIMIT) {
    await suppress({ ...input, reason: 'HARD_BOUNCE', detail: `${count} soft bounces in a week` });
    return 'promoted';
  }

  await prisma.emailSuppression.upsert({
    where: { email },
    create: {
      email,
      reason: 'SOFT_BOUNCE',
      providerMessageId: input.providerMessageId ?? null,
      detail: input.detail?.slice(0, 500) ?? null,
      softBounceCount: count,
      lastBounceAt: new Date(),
      // Counted, not blocking. `canSend` lets SOFT_BOUNCE through.
      releasedAt: new Date(),
    },
    update: {
      softBounceCount: count,
      lastBounceAt: new Date(),
      detail: input.detail?.slice(0, 500) ?? null,
    },
  });

  return 'counted';
}

/**
 * Releases an address, by hand.
 *
 * Never automatic. An address that bounced and then silently resumed is how a
 * reputation problem comes back — a release should be somebody deciding, with
 * their name on it, usually because the customer told them the mailbox is fixed.
 */
export async function release(email: string, actorId: string): Promise<void> {
  await prisma.emailSuppression.updateMany({
    where: { email: email.toLowerCase() },
    data: { releasedAt: new Date(), releasedBy: actorId, softBounceCount: 0 },
  });

  logger.info('email.suppression_released', { email: email.toLowerCase(), actorId });
}

/** The admin's view: what is blocked, why, and how much of it there is. */
export async function suppressionStats(): Promise<{
  hardBounces: number;
  complaints: number;
  manual: number;
  softTracked: number;
}> {
  const grouped = await prisma.emailSuppression.groupBy({
    by: ['reason'],
    where: { releasedAt: null },
    _count: { _all: true },
  });

  const count = (reason: EmailSuppressionType) =>
    grouped.find((row) => row.reason === reason)?._count._all ?? 0;

  return {
    hardBounces: count('HARD_BOUNCE'),
    complaints: count('COMPLAINT'),
    manual: count('MANUAL'),
    // Not blocking, but the number that predicts the next batch of hard bounces.
    softTracked: await prisma.emailSuppression.count({ where: { reason: 'SOFT_BOUNCE' } }),
  };
}
