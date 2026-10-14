-- Limits remember their currency. Existing limits were set in the family's spending currency.
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CategoryLimit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CategoryLimit_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CategoryLimit_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CategoryLimit" ("amount", "categoryId", "createdAt", "familyId", "id", "month", "updatedAt", "currency")
SELECT l."amount", l."categoryId", l."createdAt", l."familyId", l."id", l."month", l."updatedAt", f."spendingCurrency"
FROM "CategoryLimit" l JOIN "Family" f ON f."id" = l."familyId";
DROP TABLE "CategoryLimit";
ALTER TABLE "new_CategoryLimit" RENAME TO "CategoryLimit";
CREATE UNIQUE INDEX "CategoryLimit_familyId_month_categoryId_key" ON "CategoryLimit"("familyId", "month", "categoryId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
