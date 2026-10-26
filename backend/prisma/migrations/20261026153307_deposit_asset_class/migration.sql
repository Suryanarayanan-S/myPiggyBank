-- How net worth counts a deposit (existing ones: investment, as before).
ALTER TABLE "Deposit" ADD COLUMN "assetClass" TEXT NOT NULL DEFAULT 'investment';
