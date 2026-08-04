-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ImportJobStatus" ADD VALUE 'PARTIAL';
ALTER TYPE "ImportJobStatus" ADD VALUE 'ROLLED_BACK';

-- DropIndex
DROP INDEX "analytics_events_recent_idx";

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "externalId" TEXT;

-- CreateIndex
CREATE INDEX "products_externalId_idx" ON "products"("externalId");
