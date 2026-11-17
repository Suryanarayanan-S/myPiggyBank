-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "accountId" TEXT,
    "date" DATETIME NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "categoryId" TEXT,
    "memberId" TEXT,
    "merchant" TEXT,
    "notes" TEXT,
    "tags" TEXT NOT NULL DEFAULT '',
    "transferAccountId" TEXT,
    "transferAmount" BIGINT,
    "isMonthlyTotal" BOOLEAN NOT NULL DEFAULT false,
    "importBatch" TEXT,
    "recurringRuleId" TEXT,
    "depositId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Transaction_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "FamilyMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_transferAccountId_fkey" FOREIGN KEY ("transferAccountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transaction_recurringRuleId_fkey" FOREIGN KEY ("recurringRuleId") REFERENCES "RecurringRule" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "Deposit" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Transaction" ("accountId", "amount", "categoryId", "createdAt", "currency", "date", "familyId", "id", "importBatch", "isMonthlyTotal", "memberId", "merchant", "notes", "recurringRuleId", "tags", "transferAccountId", "transferAmount", "type", "updatedAt") SELECT "accountId", "amount", "categoryId", "createdAt", "currency", "date", "familyId", "id", "importBatch", "isMonthlyTotal", "memberId", "merchant", "notes", "recurringRuleId", "tags", "transferAccountId", "transferAmount", "type", "updatedAt" FROM "Transaction";
DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";
CREATE INDEX "Transaction_familyId_date_idx" ON "Transaction"("familyId", "date");
CREATE INDEX "Transaction_accountId_date_idx" ON "Transaction"("accountId", "date");
CREATE INDEX "Transaction_familyId_categoryId_idx" ON "Transaction"("familyId", "categoryId");
CREATE INDEX "Transaction_familyId_isMonthlyTotal_date_idx" ON "Transaction"("familyId", "isMonthlyTotal", "date");
CREATE INDEX "Transaction_familyId_importBatch_idx" ON "Transaction"("familyId", "importBatch");
CREATE INDEX "Transaction_depositId_idx" ON "Transaction"("depositId");
CREATE UNIQUE INDEX "Transaction_recurringRuleId_date_key" ON "Transaction"("recurringRuleId", "date");
CREATE TABLE "new_Deposit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'fd',
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "ownerMemberId" TEXT,
    "accountId" TEXT,
    "assetClass" TEXT NOT NULL DEFAULT 'investment',
    "principal" BIGINT NOT NULL,
    "rateBp" INTEGER NOT NULL,
    "startDate" DATETIME NOT NULL,
    "maturityDate" DATETIME,
    "rateHistory" TEXT,
    "compounding" TEXT NOT NULL DEFAULT 'quarterly',
    "interest" TEXT NOT NULL DEFAULT 'reinvest',
    "closedAt" DATETIME,
    "recurringRuleId" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Deposit_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Deposit_ownerMemberId_fkey" FOREIGN KEY ("ownerMemberId") REFERENCES "FamilyMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Deposit_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Deposit_recurringRuleId_fkey" FOREIGN KEY ("recurringRuleId") REFERENCES "RecurringRule" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Deposit" ("accountId", "assetClass", "closedAt", "compounding", "createdAt", "currency", "familyId", "id", "interest", "kind", "maturityDate", "name", "note", "ownerMemberId", "principal", "rateBp", "recurringRuleId", "startDate", "updatedAt") SELECT "accountId", "assetClass", "closedAt", "compounding", "createdAt", "currency", "familyId", "id", "interest", "kind", "maturityDate", "name", "note", "ownerMemberId", "principal", "rateBp", "recurringRuleId", "startDate", "updatedAt" FROM "Deposit";
DROP TABLE "Deposit";
ALTER TABLE "new_Deposit" RENAME TO "Deposit";
CREATE UNIQUE INDEX "Deposit_recurringRuleId_key" ON "Deposit"("recurringRuleId");
CREATE INDEX "Deposit_familyId_idx" ON "Deposit"("familyId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

