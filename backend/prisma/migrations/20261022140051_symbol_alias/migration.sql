-- CreateTable
CREATE TABLE "SymbolAlias" (
    "symbol" TEXT NOT NULL,
    "former" TEXT NOT NULL,

    PRIMARY KEY ("symbol", "former")
);
