-- The money story was removed (user request); its switch goes with it.
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Family" ("createdAt", "id", "name", "nameEssentials", "nameFun", "nameFuture", "quickEntryHints", "rateMode", "spendingCurrency", "targetEssentials", "targetFun", "targetFuture", "updatedAt", "wealthCurrency") SELECT "createdAt", "id", "name", "nameEssentials", "nameFun", "nameFuture", "quickEntryHints", "rateMode", "spendingCurrency", "targetEssentials", "targetFun", "targetFuture", "updatedAt", "wealthCurrency" FROM "Family";
DROP TABLE "Family";
ALTER TABLE "new_Family" RENAME TO "Family";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

