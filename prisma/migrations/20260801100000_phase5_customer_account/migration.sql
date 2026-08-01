-- CreateEnum
CREATE TYPE "NotificationTopic" AS ENUM ('ORDER_UPDATES', 'SHIPPING_UPDATES', 'RETURNS', 'PROMOTIONS', 'NEWSLETTER', 'PRODUCT_BACK_IN_STOCK', 'REVIEW_REMINDERS', 'SECURITY_ALERTS');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'IN_TRANSIT', 'RECEIVED', 'REFUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReturnReason" AS ENUM ('DAMAGED', 'NOT_AS_DESCRIBED', 'WRONG_ITEM', 'ARRIVED_LATE', 'CHANGED_MIND', 'QUALITY', 'OTHER');

-- CreateEnum
CREATE TYPE "RewardTransactionType" AS ENUM ('EARNED_PURCHASE', 'EARNED_REVIEW', 'EARNED_REFERRAL', 'EARNED_BIRTHDAY', 'REDEEMED', 'ADJUSTMENT', 'EXPIRED', 'STORE_CREDIT');

-- CreateEnum
CREATE TYPE "VipTier" AS ENUM ('STANDARD', 'SILVER', 'GOLD', 'PLATINUM');

-- CreateEnum
CREATE TYPE "LoginOutcome" AS ENUM ('SUCCESS', 'BAD_PASSWORD', 'UNKNOWN_EMAIL', 'LOCKED', 'FAILED_2FA');

-- CreateTable
CREATE TABLE "user_preferences" (
    "userId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "locale" TEXT NOT NULL DEFAULT 'en-US',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "onboardingCompletedAt" TIMESTAMP(3),
    "birthMonth" INTEGER,
    "birthDay" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "userId" TEXT NOT NULL,
    "topic" "NotificationTopic" NOT NULL,
    "email" BOOLEAN NOT NULL DEFAULT true,
    "sms" BOOLEAN NOT NULL DEFAULT false,
    "push" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("userId","topic")
);

-- CreateTable
CREATE TABLE "saved_payment_methods" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'STRIPE',
    "customerRef" TEXT NOT NULL,
    "providerRef" TEXT NOT NULL,
    "brand" TEXT,
    "last4" TEXT,
    "expMonth" INTEGER,
    "expYear" INTEGER,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "outcome" "LoginOutcome" NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'credentials',
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_accounts" (
    "userId" TEXT NOT NULL,
    "pointsBalance" INTEGER NOT NULL DEFAULT 0,
    "storeCreditCents" INTEGER NOT NULL DEFAULT 0,
    "tier" "VipTier" NOT NULL DEFAULT 'STANDARD',
    "tierReviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reward_accounts_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "reward_transactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "RewardTransactionType" NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "orderId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "rewardCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_requests" (
    "id" TEXT NOT NULL,
    "returnNumber" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT,
    "status" "ReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" "ReturnReason" NOT NULL,
    "comment" TEXT,
    "refundCents" INTEGER,
    "refundedAt" TIMESTAMP(3),
    "carrier" "ShippingCarrier",
    "trackingNumber" TEXT,
    "trackingUrl" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewerNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "return_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_items" (
    "id" TEXT NOT NULL,
    "returnRequestId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" "ReturnReason" NOT NULL,
    "condition" TEXT,

    CONSTRAINT "return_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "saved_payment_methods_providerRef_key" ON "saved_payment_methods"("providerRef");

-- CreateIndex
CREATE INDEX "saved_payment_methods_userId_isDefault_idx" ON "saved_payment_methods"("userId", "isDefault");

-- CreateIndex
CREATE INDEX "user_sessions_userId_revokedAt_lastSeenAt_idx" ON "user_sessions"("userId", "revokedAt", "lastSeenAt");

-- CreateIndex
CREATE INDEX "login_events_userId_createdAt_idx" ON "login_events"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "login_events_email_createdAt_idx" ON "login_events"("email", "createdAt");

-- CreateIndex
CREATE INDEX "reward_transactions_userId_createdAt_idx" ON "reward_transactions"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "referral_codes_userId_key" ON "referral_codes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "referral_codes_code_key" ON "referral_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "return_requests_returnNumber_key" ON "return_requests"("returnNumber");

-- CreateIndex
CREATE INDEX "return_requests_userId_createdAt_idx" ON "return_requests"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "return_requests_status_createdAt_idx" ON "return_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "return_items_returnRequestId_idx" ON "return_items"("returnRequestId");

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_payment_methods" ADD CONSTRAINT "saved_payment_methods_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_events" ADD CONSTRAINT "login_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_accounts" ADD CONSTRAINT "reward_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_transactions" ADD CONSTRAINT "reward_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "reward_accounts"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "return_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Return numbers.
--
-- Same reasoning as order numbers: two returns filed in the same millisecond
-- must not collide, and a sequence is the only thing that guarantees that
-- without a lock. Offset so an RMA is never mistaken for an order number.
CREATE SEQUENCE IF NOT EXISTS return_number_seq START WITH 100000 INCREMENT BY 1;

-- Guards the database can enforce and the application therefore cannot forget.
ALTER TABLE "return_items"
  ADD CONSTRAINT "return_items_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "user_preferences"
  ADD CONSTRAINT "user_preferences_birth_month_range" CHECK ("birthMonth" BETWEEN 1 AND 12),
  ADD CONSTRAINT "user_preferences_birth_day_range" CHECK ("birthDay" BETWEEN 1 AND 31);

-- A balance is a cached aggregate, but a negative one is always a bug.
ALTER TABLE "reward_accounts"
  ADD CONSTRAINT "reward_accounts_points_non_negative" CHECK ("pointsBalance" >= 0),
  ADD CONSTRAINT "reward_accounts_credit_non_negative" CHECK ("storeCreditCents" >= 0);

-- Exactly one default card per customer. A partial unique index says that in one
-- line; the application would need a transaction and would still race.
CREATE UNIQUE INDEX "saved_payment_methods_one_default_per_user"
  ON "saved_payment_methods" ("userId") WHERE "isDefault" = true;

-- The address book has the same rule, per address type.
CREATE UNIQUE INDEX "addresses_one_default_per_user_type"
  ON "addresses" ("userId", "type") WHERE "isDefault" = true;
