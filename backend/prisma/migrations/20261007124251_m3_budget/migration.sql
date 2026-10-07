-- CreateTable
CREATE TABLE "CategoryLimit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CategoryLimit_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CategoryLimit_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Family" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "spendingCurrency" TEXT NOT NULL DEFAULT 'EUR',
    "wealthCurrency" TEXT NOT NULL DEFAULT 'INR',
    "targetEssentials" INTEGER NOT NULL DEFAULT 50,
    "targetFun" INTEGER NOT NULL DEFAULT 30,
    "targetFuture" INTEGER NOT NULL DEFAULT 20,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Family" ("createdAt", "id", "name", "spendingCurrency", "updatedAt", "wealthCurrency") SELECT "createdAt", "id", "name", "spendingCurrency", "updatedAt", "wealthCurrency" FROM "Family";
DROP TABLE "Family";
ALTER TABLE "new_Family" RENAME TO "Family";
CREATE TABLE "new_Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "amount" BIGINT NOT NULL,
    "type" TEXT NOT NULL,
    "categoryId" TEXT,
    "memberId" TEXT,
    "merchant" TEXT,
    "notes" TEXT,
    "tags" TEXT NOT NULL DEFAULT '',
    "transferAccountId" TEXT,
    "transferAmount" BIGINT,
    "isMonthlyTotal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Transaction_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "FamilyMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_transferAccountId_fkey" FOREIGN KEY ("transferAccountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Transaction" ("accountId", "amount", "categoryId", "createdAt", "date", "familyId", "id", "memberId", "merchant", "notes", "tags", "transferAccountId", "transferAmount", "type", "updatedAt") SELECT "accountId", "amount", "categoryId", "createdAt", "date", "familyId", "id", "memberId", "merchant", "notes", "tags", "transferAccountId", "transferAmount", "type", "updatedAt" FROM "Transaction";
DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";
CREATE INDEX "Transaction_familyId_date_idx" ON "Transaction"("familyId", "date");
CREATE INDEX "Transaction_accountId_date_idx" ON "Transaction"("accountId", "date");
CREATE INDEX "Transaction_familyId_categoryId_idx" ON "Transaction"("familyId", "categoryId");
CREATE INDEX "Transaction_familyId_isMonthlyTotal_date_idx" ON "Transaction"("familyId", "isMonthlyTotal", "date");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "CategoryLimit_familyId_month_categoryId_key" ON "CategoryLimit"("familyId", "month", "categoryId");
