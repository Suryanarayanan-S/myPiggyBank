-- CreateTable
CREATE TABLE "Deposit" (
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
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Deposit_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Deposit_ownerMemberId_fkey" FOREIGN KEY ("ownerMemberId") REFERENCES "FamilyMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Deposit_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Deposit_familyId_idx" ON "Deposit"("familyId");
