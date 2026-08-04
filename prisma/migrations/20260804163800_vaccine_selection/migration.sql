-- CreateTable
CREATE TABLE "VaccineSelection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vaccineId" TEXT NOT NULL,
    "doseNumber" INTEGER NOT NULL DEFAULT 1,
    "selected" BOOLEAN NOT NULL DEFAULT true,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "VaccineSelection_vaccineId_doseNumber_key" ON "VaccineSelection"("vaccineId", "doseNumber");
