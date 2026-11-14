-- Preserve the original record text and dates. A missing actual date is never
-- repaired with today's date or a birth-date-derived schedule.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_VaccineRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "babyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vaccineId" TEXT,
    "dose" TEXT NOT NULL,
    "doseNumber" INTEGER,
    "recordStatus" TEXT,
    "administeredDate" TEXT,
    "scheduledDate" TEXT,
    "completedDate" TEXT,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "manufacturer" TEXT,
    "clinic" TEXT,
    "batchNumber" TEXT,
    "traceCode" TEXT,
    "administrationRoute" TEXT,
    "injectionSite" TEXT,
    "sourceText" TEXT,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "clientId" TEXT,
    "clientHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VaccineRecord_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "Baby" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_VaccineRecord" ("id", "babyId", "name", "vaccineId", "dose", "doseNumber", "scheduledDate", "completedDate", "administeredDate", "isCompleted", "recordStatus")
SELECT "id", "babyId", "name",
  CASE WHEN (SELECT COUNT(*) FROM "Vaccine" v WHERE v."name" = "VaccineRecord"."name") = 1
    THEN (SELECT v."vaccineId" FROM "Vaccine" v WHERE v."name" = "VaccineRecord"."name" LIMIT 1)
    ELSE NULL END,
  "dose",
  CASE REPLACE(TRIM("dose"), ' ', '')
    WHEN '1' THEN 1
    WHEN '第1剂' THEN 1
    WHEN '1剂' THEN 1
    WHEN '第1针' THEN 1
    WHEN '1针' THEN 1
    WHEN '2' THEN 2
    WHEN '第2剂' THEN 2
    WHEN '2剂' THEN 2
    WHEN '第2针' THEN 2
    WHEN '2针' THEN 2
    WHEN '3' THEN 3
    WHEN '第3剂' THEN 3
    WHEN '3剂' THEN 3
    WHEN '第3针' THEN 3
    WHEN '3针' THEN 3
    WHEN '4' THEN 4
    WHEN '第4剂' THEN 4
    WHEN '4剂' THEN 4
    WHEN '第4针' THEN 4
    WHEN '4针' THEN 4
    WHEN '5' THEN 5
    WHEN '第5剂' THEN 5
    WHEN '5剂' THEN 5
    WHEN '第5针' THEN 5
    WHEN '5针' THEN 5
    WHEN '6' THEN 6
    WHEN '第6剂' THEN 6
    WHEN '6剂' THEN 6
    WHEN '第6针' THEN 6
    WHEN '6针' THEN 6
    WHEN '7' THEN 7
    WHEN '第7剂' THEN 7
    WHEN '7剂' THEN 7
    WHEN '第7针' THEN 7
    WHEN '7针' THEN 7
    WHEN '8' THEN 8
    WHEN '第8剂' THEN 8
    WHEN '8剂' THEN 8
    WHEN '第8针' THEN 8
    WHEN '8针' THEN 8
    WHEN '9' THEN 9
    WHEN '第9剂' THEN 9
    WHEN '9剂' THEN 9
    WHEN '第9针' THEN 9
    WHEN '9针' THEN 9
    WHEN '10' THEN 10
    WHEN '第10剂' THEN 10
    WHEN '10剂' THEN 10
    WHEN '第10针' THEN 10
    WHEN '10针' THEN 10
    WHEN '11' THEN 11
    WHEN '第11剂' THEN 11
    WHEN '11剂' THEN 11
    WHEN '第11针' THEN 11
    WHEN '11针' THEN 11
    WHEN '12' THEN 12
    WHEN '第12剂' THEN 12
    WHEN '12剂' THEN 12
    WHEN '第12针' THEN 12
    WHEN '12针' THEN 12
    ELSE NULL END,
  NULLIF("scheduledDate", ''), "completedDate", "completedDate", "isCompleted",
  CASE
    WHEN "isCompleted" = 1 AND NULLIF("completedDate", '') IS NOT NULL THEN 'completed'
    WHEN "isCompleted" = 0 AND NULLIF("scheduledDate", '') IS NOT NULL THEN 'planned'
    ELSE 'needs_review'
  END
FROM "VaccineRecord";
DROP TABLE "VaccineRecord";
ALTER TABLE "new_VaccineRecord" RENAME TO "VaccineRecord";
CREATE INDEX "VaccineRecord_babyId_scheduledDate_idx" ON "VaccineRecord"("babyId", "scheduledDate");
CREATE INDEX "VaccineRecord_babyId_vaccineId_doseNumber_idx" ON "VaccineRecord"("babyId", "vaccineId", "doseNumber");
CREATE UNIQUE INDEX "VaccineRecord_babyId_clientId_key" ON "VaccineRecord"("babyId", "clientId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
