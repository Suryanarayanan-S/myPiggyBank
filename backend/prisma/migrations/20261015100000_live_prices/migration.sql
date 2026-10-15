-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Family" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "spendingCurrency" TEXT NOT NULL DEFAULT 'EUR',
    "wealthCurrency" TEXT NOT NULL DEFAULT 'INR',
    "rateMode" TEXT NOT NULL DEFAULT 'manual',
    "targetEssentials" INTEGER NOT NULL DEFAULT 50,
    "targetFun" INTEGER NOT NULL DEFAULT 30,
    "targetFuture" INTEGER NOT NULL DEFAULT 20,
    "nameEssentials" TEXT NOT NULL DEFAULT 'Keep Me Alive',
    "nameFun" TEXT NOT NULL DEFAULT 'Make Me Happy',
    "nameFuture" TEXT NOT NULL DEFAULT 'Make Me Rich',
    "quickEntryHints" BOOLEAN NOT NULL DEFAULT true,
    "investmentsAt" TEXT NOT NULL DEFAULT 'value',
    "livePrices" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Family" ("createdAt", "id", "investmentsAt", "name", "nameEssentials", "nameFun", "nameFuture", "quickEntryHints", "rateMode", "spendingCurrency", "targetEssentials", "targetFun", "targetFuture", "updatedAt", "wealthCurrency") SELECT "createdAt", "id", "investmentsAt", "name", "nameEssentials", "nameFun", "nameFuture", "quickEntryHints", "rateMode", "spendingCurrency", "targetEssentials", "targetFun", "targetFuture", "updatedAt", "wealthCurrency" FROM "Family";
DROP TABLE "Family";
ALTER TABLE "new_Family" RENAME TO "Family";
CREATE TABLE "new_HoldingPrice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "holdingId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "price" BIGINT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HoldingPrice_holdingId_fkey" FOREIGN KEY ("holdingId") REFERENCES "Holding" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_HoldingPrice" ("createdAt", "date", "holdingId", "id", "price") SELECT "createdAt", "date", "holdingId", "id", "price" FROM "HoldingPrice";
DROP TABLE "HoldingPrice";
ALTER TABLE "new_HoldingPrice" RENAME TO "HoldingPrice";
CREATE UNIQUE INDEX "HoldingPrice_holdingId_date_key" ON "HoldingPrice"("holdingId", "date");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
