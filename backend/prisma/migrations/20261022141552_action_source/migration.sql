-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CorporateAction" (
    "symbol" TEXT NOT NULL,
    "exDate" DATETIME NOT NULL,
    "purpose" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "num" INTEGER,
    "den" INTEGER,
    "amount" BIGINT,
    "source" TEXT NOT NULL DEFAULT 'list',

    PRIMARY KEY ("symbol", "exDate", "purpose")
);
INSERT INTO "new_CorporateAction" ("amount", "den", "exDate", "kind", "num", "purpose", "symbol") SELECT "amount", "den", "exDate", "kind", "num", "purpose", "symbol" FROM "CorporateAction";
DROP TABLE "CorporateAction";
ALTER TABLE "new_CorporateAction" RENAME TO "CorporateAction";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
