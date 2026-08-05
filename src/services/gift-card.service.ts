import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

import type { Prisma } from '@/generated/prisma/client';
import { errors } from '@/lib/api/errors';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

/**
 * Gift cards.
 *
 * A gift card is a liability: the business owes the bearer whatever is left on
 * it. Three consequences shape this file.
 *
 * **The code is a bearer instrument, so it is hashed.** Anyone holding the code
 * can spend the balance, exactly like a password — and a leaked database should
 * not be a stack of cash. Only a SHA-256 of the normalised code is stored,
 * alongside the last four characters so support can identify a card someone is
 * reading out over the phone.
 *
 * **Every movement is a ledger row.** `balanceCents` is a cache; the truth is
 * the sum of `GiftCardTransaction`. A balance that changed without a row is
 * unexplainable to the customer and unauditable to us.
 *
 * **It is tender, not a discount.** Applied after tax, recorded in
 * `Order.giftCardAppliedCents`, never folded into `discountCents`. A discount
 * shrinks the taxable base; a gift card pays part of a bill that was already
 * taxed in full. Conflating them under-collects tax — the same reasoning that
 * governs store credit in `rewards.service.ts`.
 */

/** Unambiguous alphabet: no O/0, I/1, or U (which people hear as "you"). */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTVWXYZ23456789';

/** `GT-XXXX-XXXX-XXXX` — grouped, because people read these aloud. */
export function generateGiftCardCode(): string {
  const bytes = randomBytes(12);
  const chars = [...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join('');
  return `GT-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

/**
 * Normalised before hashing, so a customer who types lower case or omits the
 * dashes still gets their money.
 */
function normalise(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function hashGiftCardCode(code: string): string {
  return createHash('sha256').update(normalise(code)).digest('hex');
}

export interface GiftCardQuote {
  id: string;
  last4: string;
  balanceCents: number;
  /** What this basket can actually take from it. */
  applicableCents: number;
}

/**
 * Looks a card up by code and reports what it is worth to this basket.
 *
 * Read-only. Nothing is reserved: two simultaneous checkouts can both quote the
 * same card, and the one that commits first wins — which is why the real
 * deduction happens inside the order transaction, under a conditional update.
 */
export async function quoteGiftCard(
  code: string,
  amountDueCents: number,
): Promise<{ ok: true; quote: GiftCardQuote } | { ok: false; message: string }> {
  if (!code.trim()) return { ok: false, message: 'Enter a gift card code.' };

  const card = await prisma.giftCard.findUnique({
    where: { codeHash: hashGiftCardCode(code) },
    select: { id: true, last4: true, status: true, balanceCents: true, expiresAt: true },
  });

  /*
   * One message for "no such card" and "wrong code".
   *
   * Distinguishing them turns this endpoint into an oracle for guessing codes,
   * and the codes are bearer instruments.
   */
  if (!card) return { ok: false, message: 'That gift card code was not recognised.' };

  if (card.status === 'CANCELLED') {
    return { ok: false, message: 'That gift card has been cancelled.' };
  }

  if (card.expiresAt && card.expiresAt.getTime() < Date.now()) {
    return { ok: false, message: 'That gift card has expired.' };
  }

  if (card.balanceCents <= 0) {
    return { ok: false, message: 'That gift card has no balance left.' };
  }

  return {
    ok: true,
    quote: {
      id: card.id,
      last4: card.last4,
      balanceCents: card.balanceCents,
      // Never more than the bill. Change is not given on a gift card.
      applicableCents: Math.min(card.balanceCents, Math.max(0, amountDueCents)),
    },
  };
}

/** The same quote, by id — for a card already attached to a cart. */
export async function quoteGiftCardById(
  giftCardId: string,
  amountDueCents: number,
): Promise<GiftCardQuote | null> {
  const card = await prisma.giftCard.findUnique({
    where: { id: giftCardId },
    select: { id: true, last4: true, status: true, balanceCents: true, expiresAt: true },
  });

  if (!card || card.status === 'CANCELLED' || card.balanceCents <= 0) return null;
  if (card.expiresAt && card.expiresAt.getTime() < Date.now()) return null;

  return {
    id: card.id,
    last4: card.last4,
    balanceCents: card.balanceCents,
    applicableCents: Math.min(card.balanceCents, Math.max(0, amountDueCents)),
  };
}

/**
 * Spends from a card, inside the caller's transaction.
 *
 * Takes a transaction client because this has to commit with the order or not
 * at all — a card debited against an order that failed to save is money the
 * customer has lost.
 *
 * The deduction is a conditional `updateMany` guarded on the balance still
 * being sufficient, so two checkouts racing for the last $20 cannot both win:
 * the second matches zero rows and is told to try again.
 */
export async function redeemGiftCard(
  tx: Prisma.TransactionClient,
  input: { giftCardId: string; amountCents: number; orderId: string },
): Promise<number> {
  if (input.amountCents <= 0) return 0;

  const updated = await tx.giftCard.updateMany({
    where: {
      id: input.giftCardId,
      status: { in: ['ACTIVE', 'REDEEMED'] },
      balanceCents: { gte: input.amountCents },
    },
    data: { balanceCents: { decrement: input.amountCents } },
  });

  if (updated.count === 0) {
    throw errors.badRequest('That gift card no longer has enough balance. Please try again.');
  }

  const card = await tx.giftCard.findUniqueOrThrow({
    where: { id: input.giftCardId },
    select: { balanceCents: true },
  });

  await tx.giftCardTransaction.create({
    data: {
      giftCardId: input.giftCardId,
      type: 'REDEEMED',
      amountCents: -input.amountCents,
      balanceAfter: card.balanceCents,
      orderId: input.orderId,
    },
  });

  // An emptied card is marked, so the admin list separates "spent" from
  // "issued and never used" without summing the ledger.
  if (card.balanceCents === 0) {
    await tx.giftCard.update({
      where: { id: input.giftCardId },
      data: { status: 'REDEEMED' },
    });
  }

  return input.amountCents;
}

/**
 * Returns gift card value after a refund.
 *
 * Value goes back to the card it came from, not to the payment method — the
 * customer never paid money for that portion, so refunding it to a card would
 * be handing them cash they did not spend.
 *
 * Idempotent: a replayed refund finds the reversal already recorded and stops.
 */
export async function refundToGiftCard(orderId: string): Promise<number> {
  const spent = await prisma.giftCardTransaction.findFirst({
    where: { orderId, type: 'REDEEMED' },
    select: { id: true, giftCardId: true, amountCents: true },
  });

  if (!spent) return 0;

  const alreadyReturned = await prisma.giftCardTransaction.findFirst({
    where: { orderId, type: 'REFUNDED' },
    select: { id: true },
  });

  if (alreadyReturned) return 0;

  const amount = Math.abs(spent.amountCents);

  return prisma.$transaction(async (tx) => {
    const card = await tx.giftCard.update({
      where: { id: spent.giftCardId },
      data: {
        balanceCents: { increment: amount },
        // A card emptied by this order becomes spendable again.
        status: 'ACTIVE',
      },
      select: { balanceCents: true },
    });

    await tx.giftCardTransaction.create({
      data: {
        giftCardId: spent.giftCardId,
        type: 'REFUNDED',
        amountCents: amount,
        balanceAfter: card.balanceCents,
        orderId,
      },
    });

    return amount;
  });
}

/**
 * Issues a card and returns the code **once**.
 *
 * The caller must deliver it immediately — it is not recoverable afterwards,
 * because only the hash is kept. That is the same trade as a password reset
 * token, for the same reason.
 */
export async function issueGiftCard(input: {
  amountCents: number;
  issuedToEmail?: string | null;
  note?: string | null;
  expiresAt?: Date | null;
  issuedById?: string | null;
}): Promise<{ code: string; id: string; last4: string }> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw errors.badRequest('A gift card needs a positive whole amount.');
  }

  const code = generateGiftCardCode();
  const normalised = normalise(code);

  const card = await prisma.$transaction(async (tx) => {
    const created = await tx.giftCard.create({
      data: {
        codeHash: hashGiftCardCode(code),
        last4: normalised.slice(-4),
        initialCents: input.amountCents,
        balanceCents: input.amountCents,
        issuedToEmail: input.issuedToEmail?.toLowerCase() ?? null,
        note: input.note ?? null,
        expiresAt: input.expiresAt ?? null,
        issuedById: input.issuedById ?? null,
      },
    });

    await tx.giftCardTransaction.create({
      data: {
        giftCardId: created.id,
        type: 'ISSUED',
        amountCents: input.amountCents,
        balanceAfter: input.amountCents,
        actorId: input.issuedById ?? null,
      },
    });

    return created;
  });

  logger.info('giftcard.issued', { giftCardId: card.id, amountCents: input.amountCents });

  return { code, id: card.id, last4: card.last4 };
}

/** Proves the cached balance equals the ledger. For "is this number right?". */
export async function reconcileGiftCard(giftCardId: string) {
  const [card, ledger] = await Promise.all([
    prisma.giftCard.findUniqueOrThrow({
      where: { id: giftCardId },
      select: { balanceCents: true },
    }),
    prisma.giftCardTransaction.aggregate({
      where: { giftCardId },
      _sum: { amountCents: true },
    }),
  ]);

  const fromLedger = ledger._sum.amountCents ?? 0;

  return {
    storedBalance: card.balanceCents,
    ledgerBalance: fromLedger,
    matches: card.balanceCents === fromLedger,
  };
}
