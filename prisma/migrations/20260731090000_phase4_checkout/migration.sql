-- CreateEnum
CREATE TYPE "OrderEventType" AS ENUM ('CREATED', 'PAYMENT_STARTED', 'PAYMENT_SUCCEEDED', 'PAYMENT_FAILED', 'STATUS_CHANGED', 'FULFILLMENT_UPDATED', 'NOTE_ADDED', 'REFUND_ISSUED', 'EMAIL_SENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShippingRateType" AS ENUM ('FLAT', 'FREE', 'WEIGHT_BASED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrderStatus" ADD VALUE 'PAID';
ALTER TYPE "OrderStatus" ADD VALUE 'RETURNED';

-- DropIndex
DROP INDEX "product_search_documents_title_trgm_idx";

-- DropIndex
DROP INDEX "products_name_trgm_idx";

-- AlterTable
ALTER TABLE "cart_items" ADD COLUMN     "savedForLater" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "carts" ADD COLUMN     "email" TEXT,
ADD COLUMN     "estimatePostalCode" TEXT,
ADD COLUMN     "estimateState" TEXT,
ADD COLUMN     "giftNote" TEXT,
ADD COLUMN     "shippingRateId" TEXT;

-- AlterTable
ALTER TABLE "coupons" ADD COLUMN     "firstOrderOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "couponCode" TEXT,
ADD COLUMN     "estimatedDeliveryAt" TIMESTAMP(3),
ADD COLUMN     "giftNote" TEXT,
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "shippingMethod" TEXT,
ADD COLUMN     "shippingRateId" TEXT,
ADD COLUMN     "taxBreakdown" JSONB;

-- CreateTable
CREATE TABLE "order_events" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" "OrderEventType" NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "actorId" TEXT,
    "isCustomerVisible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_rates" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "ShippingRateType" NOT NULL DEFAULT 'FLAT',
    "baseCents" INTEGER NOT NULL DEFAULT 0,
    "perKgCents" INTEGER NOT NULL DEFAULT 0,
    "freeWeightGrams" INTEGER NOT NULL DEFAULT 0,
    "freeAboveSubtotalCents" INTEGER,
    "minSubtotalCents" INTEGER,
    "states" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "countries" TEXT[] DEFAULT ARRAY['US']::TEXT[],
    "estimatedDaysMin" INTEGER NOT NULL DEFAULT 3,
    "estimatedDaysMax" INTEGER NOT NULL DEFAULT 5,
    "carrier" "ShippingCarrier" NOT NULL DEFAULT 'USPS',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rates" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'US',
    "state" TEXT,
    "county" TEXT,
    "postalCode" TEXT,
    "label" TEXT NOT NULL,
    "rateBasisPoints" INTEGER NOT NULL,
    "appliesToShipping" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_events_orderId_createdAt_idx" ON "order_events"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "order_events_type_createdAt_idx" ON "order_events"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_rates_code_key" ON "shipping_rates"("code");

-- CreateIndex
CREATE INDEX "shipping_rates_isActive_position_idx" ON "shipping_rates"("isActive", "position");

-- CreateIndex
CREATE INDEX "tax_rates_country_state_county_postalCode_idx" ON "tax_rates"("country", "state", "county", "postalCode");

-- CreateIndex
CREATE INDEX "tax_rates_isActive_idx" ON "tax_rates"("isActive");

-- CreateIndex
CREATE INDEX "coupons_userId_idx" ON "coupons"("userId");

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_shippingRateId_fkey" FOREIGN KEY ("shippingRateId") REFERENCES "shipping_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_shippingRateId_fkey" FOREIGN KEY ("shippingRateId") REFERENCES "shipping_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ===========================================================================
-- Hand-written additions
--
-- Constraints and indexes beyond what the Prisma schema language can express.
-- The section above is regenerated from the datamodel; this one is maintained
-- by hand. Money and stock invariants belong here as well as in the service
-- layer: a constraint is what survives a bad migration or a console session.
-- ===========================================================================

-- --- Money integrity ------------------------------------------------------
-- Every monetary column on an order is unsigned, and the total must actually be
-- the sum of its parts. A rounding bug in the tax service is caught here rather
-- than by a customer noticing they were charged the wrong amount.
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_amounts_non_negative" CHECK (
    "subtotalCents" >= 0 AND "discountCents" >= 0 AND
    "shippingCents" >= 0 AND "taxCents" >= 0 AND "totalCents" >= 0
  ),
  ADD CONSTRAINT "orders_total_is_sum" CHECK (
    "totalCents" = "subtotalCents" - "discountCents" + "shippingCents" + "taxCents"
  ),
  -- A discount cannot exceed what is being discounted.
  ADD CONSTRAINT "orders_discount_within_subtotal" CHECK ("discountCents" <= "subtotalCents");

-- Order lines: quantity is positive, and the line total reconciles.
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "order_items_amounts_non_negative" CHECK (
    "unitPriceCents" >= 0 AND "discountCents" >= 0 AND "taxCents" >= 0 AND "totalCents" >= 0
  );

-- A cart line of zero or negative quantity is a bug, not an empty cart.
ALTER TABLE "cart_items"
  ADD CONSTRAINT "cart_items_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "cart_items_price_non_negative" CHECK ("unitPriceCents" >= 0);

-- --- Coupons --------------------------------------------------------------
ALTER TABLE "coupons"
  ADD CONSTRAINT "coupons_value_non_negative" CHECK ("value" >= 0),
  -- A percentage discount above 100% pays the customer to order.
  ADD CONSTRAINT "coupons_percentage_within_range" CHECK (
    "type" <> 'PERCENTAGE' OR "value" <= 100
  ),
  ADD CONSTRAINT "coupons_usage_count_non_negative" CHECK ("usedCount" >= 0);

-- --- Tax and shipping -----------------------------------------------------
-- Basis points: 0-10000 covers 0-100%. Anything outside is a data-entry error.
ALTER TABLE "tax_rates"
  ADD CONSTRAINT "tax_rates_basis_points_range" CHECK ("rateBasisPoints" BETWEEN 0 AND 10000);

ALTER TABLE "shipping_rates"
  ADD CONSTRAINT "shipping_rates_amounts_non_negative" CHECK (
    "baseCents" >= 0 AND "perKgCents" >= 0 AND "freeWeightGrams" >= 0
  ),
  ADD CONSTRAINT "shipping_rates_delivery_window_ordered" CHECK (
    "estimatedDaysMax" >= "estimatedDaysMin"
  );

-- --- Query paths ----------------------------------------------------------
-- Guest cart lookup by cookie, and the sweep that expires abandoned carts.
CREATE INDEX "carts_session_active_idx" ON "carts" ("sessionToken") WHERE "sessionToken" IS NOT NULL;

-- "Show me the active items in this cart" — the single hottest cart query.
CREATE INDEX "cart_items_active_idx" ON "cart_items" ("cartId") WHERE "savedForLater" = false;

-- Order lookup by number is what every support conversation starts with.
CREATE INDEX "orders_number_lower_idx" ON "orders" (LOWER("orderNumber"));

-- Reconciliation: unpaid orders older than the reservation window.
CREATE INDEX "orders_pending_created_idx" ON "orders" ("createdAt")
  WHERE "status" = 'PENDING';
