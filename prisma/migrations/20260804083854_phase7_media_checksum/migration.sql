-- AlterTable
ALTER TABLE "media" ADD COLUMN     "checksum" TEXT;

-- CreateIndex
CREATE INDEX "media_checksum_idx" ON "media"("checksum");
