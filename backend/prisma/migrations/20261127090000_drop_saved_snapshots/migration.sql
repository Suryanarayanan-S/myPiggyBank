-- Net worth is worked out for every day now: the snapshots the app saved are no longer used.
-- Only the past entries typed in (no breakdown) stay.
DELETE FROM "NetWorthSnapshot" WHERE "breakdown" IS NOT NULL;
ALTER TABLE "NetWorthSnapshot" DROP COLUMN "breakdown";
