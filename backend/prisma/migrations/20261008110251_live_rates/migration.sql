-- CreateTable
CREATE TABLE "LiveRate" (
    "month" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "rateMicros" INTEGER NOT NULL,
    "asOf" TEXT NOT NULL,
    "final" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("month", "quote")
);

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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Family" ("createdAt", "id", "name", "spendingCurrency", "targetEssentials", "targetFun", "targetFuture", "updatedAt", "wealthCurrency") SELECT "createdAt", "id", "name", "spendingCurrency", "targetEssentials", "targetFun", "targetFuture", "updatedAt", "wealthCurrency" FROM "Family";
DROP TABLE "Family";
ALTER TABLE "new_Family" RENAME TO "Family";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
