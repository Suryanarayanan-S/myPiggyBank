-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "importBatch" TEXT;

-- CreateIndex
CREATE INDEX "Transaction_familyId_importBatch_idx" ON "Transaction"("familyId", "importBatch");
