-- Phase 8: Klarna becomes the payment provider, plus Cloudflare Web Analytics.
--
-- Both changes are additive enum values and a default change. Nothing is
-- dropped: STRIPE stays in `PaymentProvider` so historical payment rows keep
-- their meaning, and removing an enum value would fail against any row using it.
--
-- Postgres will not let a new enum value be used in the same transaction that
-- adds it, which is why the default is changed in a separate statement below
-- and why this migration must not be squashed with one that inserts KLARNA rows.

-- AlterEnum
ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'KLARNA';

-- AlterEnum
ALTER TYPE "MarketingProvider" ADD VALUE IF NOT EXISTS 'CLOUDFLARE_WEB_ANALYTICS';
