-- Prices written by the Zerodha import before prices had a source were not typed by hand:
-- mark them as imported, so the NSE close of the same day can replace them.
UPDATE "HoldingPrice" SET "source" = 'import'
WHERE "source" = 'manual'
  AND "holdingId" IN (
    SELECT "id" FROM "Holding" WHERE "note" LIKE 'Imported from a Zerodha holdings file on %'
  )
  AND date("date" / 1000, 'unixepoch') = (
    SELECT substr("note", length('Imported from a Zerodha holdings file on ') + 1, 10)
    FROM "Holding" WHERE "Holding"."id" = "HoldingPrice"."holdingId"
  );
