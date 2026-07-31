-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "billingAddressSnapshot" JSONB,
ADD COLUMN     "shippingAddressSnapshot" JSONB;

