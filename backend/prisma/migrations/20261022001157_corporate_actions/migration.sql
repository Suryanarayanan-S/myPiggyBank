-- CreateTable
CREATE TABLE "CorporateAction" (
    "symbol" TEXT NOT NULL,
    "exDate" DATETIME NOT NULL,
    "purpose" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "num" INTEGER,
    "den" INTEGER,

    PRIMARY KEY ("symbol", "exDate", "purpose")
);

-- CreateTable
CREATE TABLE "HoldingAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "holdingId" TEXT NOT NULL,
    "exDate" DATETIME NOT NULL,
    "purpose" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "num" INTEGER,
    "den" INTEGER,
    "unitsBefore" BIGINT NOT NULL,
    "unitsAfter" BIGINT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HoldingAction_holdingId_fkey" FOREIGN KEY ("holdingId") REFERENCES "Holding" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "HoldingAction_holdingId_idx" ON "HoldingAction"("holdingId");

-- CreateIndex
CREATE UNIQUE INDEX "HoldingAction_holdingId_exDate_purpose_key" ON "HoldingAction"("holdingId", "exDate", "purpose");
