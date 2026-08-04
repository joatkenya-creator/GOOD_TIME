-- CreateEnum
CREATE TYPE "GiftCardTransactionType" AS ENUM ('ISSUED', 'REDEEMED', 'REFUNDED', 'ADJUSTED', 'EXPIRED', 'CANCELLED');

-- AlterTable
ALTER TABLE "carts" ADD COLUMN     "giftCardId" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "giftCardAppliedCents" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "gift_card_transactions" (
    "id" TEXT NOT NULL,
    "giftCardId" TEXT NOT NULL,
    "type" "GiftCardTransactionType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "orderId" TEXT,
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gift_card_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gift_card_transactions_giftCardId_createdAt_idx" ON "gift_card_transactions"("giftCardId", "createdAt");

-- CreateIndex
CREATE INDEX "gift_card_transactions_orderId_idx" ON "gift_card_transactions"("orderId");

-- AddForeignKey
ALTER TABLE "gift_card_transactions" ADD CONSTRAINT "gift_card_transactions_giftCardId_fkey" FOREIGN KEY ("giftCardId") REFERENCES "gift_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_card_transactions" ADD CONSTRAINT "gift_card_transactions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_card_transactions" ADD CONSTRAINT "gift_card_transactions_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Gift card value never goes negative, whatever the application believes.
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_gift_card_non_negative" CHECK ("giftCardAppliedCents" >= 0);

-- A redemption row must actually move value.
ALTER TABLE "gift_card_transactions"
  ADD CONSTRAINT "gift_card_transactions_non_zero" CHECK ("amountCents" <> 0),
  ADD CONSTRAINT "gift_card_transactions_balance_non_negative" CHECK ("balanceAfter" >= 0);
