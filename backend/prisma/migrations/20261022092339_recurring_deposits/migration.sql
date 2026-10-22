-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Deposit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'fd',
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "ownerMemberId" TEXT,
    "accountId" TEXT,
    "principal" BIGINT NOT NULL,
    "rateBp" INTEGER NOT NULL,
    "startDate" DATETIME NOT NULL,
    "maturityDate" DATETIME NOT NULL,
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
INSERT INTO "new_Deposit" ("accountId", "closedAt", "compounding", "createdAt", "currency", "familyId", "id", "interest", "kind", "maturityDate", "name", "note", "ownerMemberId", "principal", "rateBp", "startDate", "updatedAt") SELECT "accountId", "closedAt", "compounding", "createdAt", "currency", "familyId", "id", "interest", "kind", "maturityDate", "name", "note", "ownerMemberId", "principal", "rateBp", "startDate", "updatedAt" FROM "Deposit";
DROP TABLE "Deposit";
ALTER TABLE "new_Deposit" RENAME TO "Deposit";
CREATE UNIQUE INDEX "Deposit_recurringRuleId_key" ON "Deposit"("recurringRuleId");
CREATE INDEX "Deposit_familyId_idx" ON "Deposit"("familyId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
