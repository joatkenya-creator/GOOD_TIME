import 'dotenv/config';

import { createScriptClient } from '../prisma/client';
import {
  hashGiftCardCode,
  issueGiftCard,
  quoteGiftCard,
  reconcileGiftCard,
  redeemGiftCard,
  refundToGiftCard,
} from '../src/services/gift-card.service';

/**
 * Gift cards, end to end against the live database.
 *
 *   npm run verify:gift-cards
 *
 * A gift card is a liability the business owes the bearer, so the things worth
 * proving are the ones that lose or duplicate money: that a race for the last
 * dollar has exactly one winner, that a refund returns value once, and that the
 * cached balance never disagrees with the ledger.
 *
 * Creates its own card and cleans up after itself.
 */
const prisma = createScriptClient();

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main(): Promise<void> {
  console.log('\nGift cards\n');

  const created: string[] = [];

  try {
    // ------------------------------------------------------------- issuing
    console.log('Issuing');

    const issued = await issueGiftCard({
      amountCents: 5000,
      issuedToEmail: 'giftcard-verify@example.test',
      note: 'Verification card',
    });
    created.push(issued.id);

    check('a card is issued with a code', issued.code.startsWith('GT-'));
    check('the code is grouped for reading aloud', issued.code.split('-').length === 4);

    const stored = await prisma.giftCard.findUniqueOrThrow({ where: { id: issued.id } });
    check('the balance matches the amount issued', stored.balanceCents === 5000);

    // The whole point of hashing: the plaintext must not be recoverable.
    check(
      'the plaintext code is not stored anywhere',
      stored.codeHash !== issued.code && stored.codeHash === hashGiftCardCode(issued.code),
    );
    check('only the last four are kept for support', stored.last4.length === 4);

    const ledger = await prisma.giftCardTransaction.findFirst({
      where: { giftCardId: issued.id, type: 'ISSUED' },
    });
    check('issuing writes a ledger row', ledger !== null);

    // ------------------------------------------------------------ quoting
    console.log('\nQuoting');

    const lowerCase = await quoteGiftCard(issued.code.toLowerCase(), 10_000);
    check('a lower-case code still works', lowerCase.ok);

    const noDashes = await quoteGiftCard(issued.code.replace(/-/g, ''), 10_000);
    check('a code typed without dashes still works', noDashes.ok);

    const capped = await quoteGiftCard(issued.code, 2000);
    check(
      'a quote never exceeds the bill',
      capped.ok && capped.quote.applicableCents === 2000,
      capped.ok ? String(capped.quote.applicableCents) : capped.message,
    );

    const full = await quoteGiftCard(issued.code, 10_000);
    check(
      'a quote never exceeds the balance',
      full.ok && full.quote.applicableCents === 5000,
      full.ok ? String(full.quote.applicableCents) : full.message,
    );

    const wrong = await quoteGiftCard('GT-XXXX-XXXX-XXXX', 5000);
    check('an unknown code is refused', !wrong.ok);
    check(
      'an unknown code gives nothing away',
      !wrong.ok && !/exist|found|invalid code/i.test(wrong.message),
      wrong.ok ? '' : wrong.message,
    );

    // ---------------------------------------------------------- redeeming
    console.log('\nRedeeming');

    const order = await prisma.order.findFirst({ select: { id: true } });
    if (!order) {
      console.log('  (skipped: no order to attach a redemption to)');
    } else {
      const spent = await prisma.$transaction((tx) =>
        redeemGiftCard(tx, { giftCardId: issued.id, amountCents: 2000, orderId: order.id }),
      );
      check('redeeming returns the amount spent', spent === 2000);

      const afterSpend = await prisma.giftCard.findUniqueOrThrow({ where: { id: issued.id } });
      check('the balance drops by the amount spent', afterSpend.balanceCents === 3000);

      const spendRow = await prisma.giftCardTransaction.findFirst({
        where: { giftCardId: issued.id, type: 'REDEEMED' },
      });
      check('redeeming writes a negative ledger row', spendRow?.amountCents === -2000);
      check('the ledger records the balance after', spendRow?.balanceAfter === 3000);

      /*
       * The race. Two checkouts try to spend more than remains between them.
       *
       * The conditional update means exactly one can win; the loser has to
       * throw, or the shop ships goods paid for with money that was not there.
       */
      const results = await Promise.allSettled([
        prisma.$transaction((tx) =>
          redeemGiftCard(tx, { giftCardId: issued.id, amountCents: 3000, orderId: order.id }),
        ),
        prisma.$transaction((tx) =>
          redeemGiftCard(tx, { giftCardId: issued.id, amountCents: 3000, orderId: order.id }),
        ),
      ]);

      const winners = results.filter((result) => result.status === 'fulfilled').length;
      check('two checkouts racing for the last balance: exactly one wins', winners === 1, `${winners} won`);

      const afterRace = await prisma.giftCard.findUniqueOrThrow({ where: { id: issued.id } });
      check('the balance never goes negative', afterRace.balanceCents >= 0, String(afterRace.balanceCents));
      check('an emptied card is marked redeemed', afterRace.status === 'REDEEMED', afterRace.status);

      // ------------------------------------------------------- refunding
      console.log('\nRefunding');

      const returned = await refundToGiftCard(order.id);
      check('a refund returns value to the card', returned > 0, String(returned));

      const afterRefund = await prisma.giftCard.findUniqueOrThrow({ where: { id: issued.id } });
      check('a refunded card becomes spendable again', afterRefund.status === 'ACTIVE');

      const replay = await refundToGiftCard(order.id);
      check('a replayed refund returns nothing the second time', replay === 0);
    }

    // ------------------------------------------------------------- ledger
    console.log('\nThe ledger');

    const reconciled = await reconcileGiftCard(issued.id);
    check(
      'the balance equals the sum of the ledger',
      reconciled.matches,
      `stored ${reconciled.storedBalance} vs ledger ${reconciled.ledgerBalance}`,
    );
  } finally {
    for (const id of created) {
      await prisma.giftCardTransaction.deleteMany({ where: { giftCardId: id } });
      await prisma.giftCard.delete({ where: { id } }).catch(() => undefined);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  for (const failure of failures) console.log(`  FAILED: ${failure}`);
  if (failed > 0) process.exit(1);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
