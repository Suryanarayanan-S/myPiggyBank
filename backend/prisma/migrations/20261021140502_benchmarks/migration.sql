-- CreateTable
CREATE TABLE "BenchmarkPoint" (
    "series" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "value" BIGINT NOT NULL,

    PRIMARY KEY ("series", "date")
);
