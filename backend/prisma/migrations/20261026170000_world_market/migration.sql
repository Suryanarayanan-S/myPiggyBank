-- AlterTable
ALTER TABLE "HoldingTrade" ADD COLUMN "ref" TEXT;

-- CreateTable
CREATE TABLE "WorldInstrument" (
    "isin" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL,
    "entityValue" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "idNotation" TEXT,
    "venue" TEXT,
    "currency" TEXT,
    "splits" TEXT NOT NULL DEFAULT '[]',
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "HoldingTrade_holdingId_ref_key" ON "HoldingTrade"("holdingId", "ref");

