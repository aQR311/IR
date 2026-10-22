-- AlterTable
ALTER TABLE "ShareTransaction" ADD COLUMN     "importBatch" TEXT;

-- CreateIndex
CREATE INDEX "ShareTransaction_importBatch_idx" ON "ShareTransaction"("importBatch");
