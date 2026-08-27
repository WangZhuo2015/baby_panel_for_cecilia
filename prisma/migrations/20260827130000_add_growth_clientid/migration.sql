-- AlterTable
ALTER TABLE "GrowthMeasurement" ADD COLUMN "clientId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "GrowthMeasurement_babyId_clientId_key" ON "GrowthMeasurement"("babyId", "clientId");
