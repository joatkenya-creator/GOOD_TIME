-- Phase 8, part two: point the `payments.provider` default at KLARNA.
--
-- Split from the migration that adds the enum value because Postgres refuses to
-- use a new enum label in the transaction that created it:
--   "unsafe use of new value 'KLARNA' of enum type PaymentProvider"
--
-- Existing rows are untouched. A row written before this migration is a genuine
-- Stripe payment and must keep saying so.

-- AlterTable
ALTER TABLE "payments" ALTER COLUMN "provider" SET DEFAULT 'KLARNA';
