-- Bounce and complaint suppression.
--
-- Additive only: a new enum, a new table, no changes to anything existing. Safe
-- to apply while the previous release is still serving traffic, which is the
-- rule every migration here follows (see docs/prisma.md).

-- CreateEnum
CREATE TYPE "EmailSuppressionType" AS ENUM ('HARD_BOUNCE', 'SOFT_BOUNCE', 'COMPLAINT', 'MANUAL');

-- CreateTable
CREATE TABLE "email_suppressions" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" "EmailSuppressionType" NOT NULL,
    "providerMessageId" TEXT,
    "detail" TEXT,
    "softBounceCount" INTEGER NOT NULL DEFAULT 0,
    "lastBounceAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "releasedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("id")
);

-- The lookup on every send: one address, is it suppressed.
CREATE UNIQUE INDEX "email_suppressions_email_key" ON "email_suppressions"("email");

-- The admin's "what is currently suppressed and why" view.
CREATE INDEX "email_suppressions_reason_releasedAt_idx" ON "email_suppressions"("reason", "releasedAt");
