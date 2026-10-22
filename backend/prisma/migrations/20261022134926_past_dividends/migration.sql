-- AlterTable
ALTER TABLE "CorporateAction" ADD COLUMN "amount" BIGINT;

-- CreateTable
CREATE TABLE "MarketClose" (
    "symbol" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "close" BIGINT NOT NULL,

    PRIMARY KEY ("symbol", "date")
);
