-- CreateIndex
CREATE INDEX "SleepRecord_babyId_endTime_idx" ON "SleepRecord"("babyId", "endTime");

-- CreateIndex
CREATE INDEX "SourceRef_dataReleaseId_idx" ON "SourceRef"("dataReleaseId");
