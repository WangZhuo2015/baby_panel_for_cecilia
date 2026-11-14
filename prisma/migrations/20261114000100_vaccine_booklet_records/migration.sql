-- Preserve existing records while making unknown historical plan dates/doses nullable.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_VaccineRecord" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "babyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "vaccineId" TEXT,
  "dose" TEXT,
  "doseNumber" INTEGER,
  "scheduledDate" TEXT,
  "completedDate" TEXT,
  "isCompleted" BOOLEAN NOT NULL DEFAULT false,
  "clinic" TEXT,
  "batchNumber" TEXT,
  "manufacturer" TEXT,
  "productName" TEXT,
  "traceabilityCode" TEXT,
  "injectionSite" TEXT,
  "notes" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VaccineRecord_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "Baby" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_VaccineRecord" ("id", "babyId", "name", "dose", "scheduledDate", "completedDate", "isCompleted")
SELECT "id", "babyId", "name", "dose", "scheduledDate", "completedDate", "isCompleted" FROM "VaccineRecord";
DROP TABLE "VaccineRecord";
ALTER TABLE "new_VaccineRecord" RENAME TO "VaccineRecord";
CREATE INDEX "VaccineRecord_babyId_scheduledDate_idx" ON "VaccineRecord"("babyId", "scheduledDate");
CREATE INDEX "VaccineRecord_babyId_completedDate_idx" ON "VaccineRecord"("babyId", "completedDate");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
