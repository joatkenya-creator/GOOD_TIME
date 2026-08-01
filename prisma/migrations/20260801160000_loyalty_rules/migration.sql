-- Loyalty rules: earning, redemption, tiers, birthdays and referrals.
--
-- Written idempotently. The first attempt failed partway through — Postgres
-- commits each DDL statement here, so `carts` and `reward_accounts` had already
-- taken their columns while `orders` had not, and a plain re-run would then have
-- failed on the columns that already existed.

-- Loyalty tender on an order. Deliberately separate from `discountCents`: credit
-- and points are tender against a bill that was already taxed in full, whereas a
-- discount reduces the taxable base. Folding them together under-collects tax.
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "creditAppliedCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "pointsRedeemed" INTEGER NOT NULL DEFAULT 0;

-- The customer's intent to spend loyalty on a basket. The amounts are always
-- recomputed at checkout from the live balance; these are flags, not figures.
ALTER TABLE "carts"
  ADD COLUMN IF NOT EXISTS "applyStoreCredit" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "redeemPoints" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "reward_accounts"
  ADD COLUMN IF NOT EXISTS "lastBirthdayGrantAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "referredByCode" TEXT,
  ADD COLUMN IF NOT EXISTS "referralPaidAt" TIMESTAMP(3);

-- Loyalty tender can never exceed the bill, and never be negative.
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_credit_within_total";
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_points_redeemed_non_negative";

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_credit_within_total"
    CHECK ("creditAppliedCents" BETWEEN 0 AND "totalCents"),
  ADD CONSTRAINT "orders_points_redeemed_non_negative"
    CHECK ("pointsRedeemed" >= 0);

-- Expiring points is a scheduled sweep over unexpired earnings; this is the index
-- it reads. Partial, because rows that never expire are never scanned.
CREATE INDEX IF NOT EXISTS "reward_transactions_expiring_idx"
  ON "reward_transactions" ("userId", "expiresAt")
  WHERE "expiresAt" IS NOT NULL;
