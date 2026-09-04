-- Security hardening: PAT plaintext -> SHA-256 hash (+作废存量令牌，需重发)
-- FK hardening: AiJob 关联 User/Baby；静态引用表补 onDelete Cascade
-- Cleanup: 删3处冗余 @@index；删 VaccineRecord.countdownDays 死列
-- 另修复基线漂移：补 PersonalAccessToken / AgentVoiceLog 建表（此前仅 db push 未留 migration）

DROP INDEX "OAuthAuthorizationCode_code_idx";
DROP INDEX "OAuthRefreshToken_tokenHash_idx";
CREATE TABLE "PersonalAccessToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '我的快捷指令',
    "tokenHash" TEXT NOT NULL,
    "tokenHint" TEXT NOT NULL DEFAULT '',
    "lastUsedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PersonalAccessToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "AgentVoiceLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "babyId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "reply" TEXT NOT NULL,
    "isAsync" BOOLEAN NOT NULL DEFAULT false,
    "isFastPath" BOOLEAN NOT NULL DEFAULT false,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentVoiceLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentVoiceLog_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "Baby" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AiJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "babyId" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "inputArchiveId" TEXT,
    "resultJson" TEXT,
    "imageUrl" TEXT,
    "errorMessage" TEXT,
    "claimed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "AiJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AiJob_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "Baby" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AiJob" ("babyId", "claimed", "createdAt", "errorMessage", "finishedAt", "id", "imageUrl", "inputArchiveId", "resultJson", "status", "type", "userId") SELECT "babyId", "claimed", "createdAt", "errorMessage", "finishedAt", "id", "imageUrl", "inputArchiveId", "resultJson", "status", "type", "userId" FROM "AiJob";
DROP TABLE "AiJob";
ALTER TABLE "new_AiJob" RENAME TO "AiJob";
CREATE INDEX "AiJob_userId_createdAt_idx" ON "AiJob"("userId", "createdAt");
CREATE INDEX "AiJob_status_claimed_idx" ON "AiJob"("status", "claimed");
CREATE TABLE "new_MilestoneSourceRef" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "milestoneId" TEXT NOT NULL,
    "sourceRefId" TEXT NOT NULL,
    CONSTRAINT "MilestoneSourceRef_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "DevelopmentMilestone" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MilestoneSourceRef_sourceRefId_fkey" FOREIGN KEY ("sourceRefId") REFERENCES "SourceRef" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_MilestoneSourceRef" ("id", "milestoneId", "sourceRefId") SELECT "id", "milestoneId", "sourceRefId" FROM "MilestoneSourceRef";
DROP TABLE "MilestoneSourceRef";
ALTER TABLE "new_MilestoneSourceRef" RENAME TO "MilestoneSourceRef";
CREATE TABLE "new_SourceRef" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "organization" TEXT NOT NULL,
    "year" INTEGER,
    "publicationDate" TEXT,
    "url" TEXT,
    "sourceLevel" TEXT,
    "sourceType" TEXT,
    "accessedDate" TEXT,
    "notes" TEXT,
    "dataReleaseId" TEXT,
    CONSTRAINT "SourceRef_dataReleaseId_fkey" FOREIGN KEY ("dataReleaseId") REFERENCES "DataRelease" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SourceRef" ("accessedDate", "dataReleaseId", "id", "notes", "organization", "publicationDate", "sourceId", "sourceLevel", "sourceType", "title", "url", "year") SELECT "accessedDate", "dataReleaseId", "id", "notes", "organization", "publicationDate", "sourceId", "sourceLevel", "sourceType", "title", "url", "year" FROM "SourceRef";
DROP TABLE "SourceRef";
ALTER TABLE "new_SourceRef" RENAME TO "SourceRef";
CREATE INDEX "SourceRef_dataReleaseId_idx" ON "SourceRef"("dataReleaseId");
CREATE TABLE "new_VaccineDose" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vaccineId" TEXT NOT NULL,
    "doseNumber" INTEGER NOT NULL,
    "doseLabel" TEXT NOT NULL,
    "recommendedAgeMonths" INTEGER,
    "minimumAgeDays" INTEGER,
    "maximumAgeDays" INTEGER,
    "recommendedAgeMaxMonths" INTEGER,
    "minimumIntervalDaysFromPrevious" INTEGER,
    "maximumIntervalDaysFromPrevious" INTEGER,
    "route" TEXT,
    "site" TEXT,
    "doseVolumeMl" REAL,
    "notes" TEXT,
    "sourceRefsJson" TEXT NOT NULL,
    CONSTRAINT "VaccineDose_vaccineId_fkey" FOREIGN KEY ("vaccineId") REFERENCES "Vaccine" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_VaccineDose" ("doseLabel", "doseNumber", "doseVolumeMl", "id", "maximumAgeDays", "maximumIntervalDaysFromPrevious", "minimumAgeDays", "minimumIntervalDaysFromPrevious", "notes", "recommendedAgeMaxMonths", "recommendedAgeMonths", "route", "site", "sourceRefsJson", "vaccineId") SELECT "doseLabel", "doseNumber", "doseVolumeMl", "id", "maximumAgeDays", "maximumIntervalDaysFromPrevious", "minimumAgeDays", "minimumIntervalDaysFromPrevious", "notes", "recommendedAgeMaxMonths", "recommendedAgeMonths", "route", "site", "sourceRefsJson", "vaccineId" FROM "VaccineDose";
DROP TABLE "VaccineDose";
ALTER TABLE "new_VaccineDose" RENAME TO "VaccineDose";
CREATE INDEX "VaccineDose_vaccineId_idx" ON "VaccineDose"("vaccineId");
CREATE TABLE "new_VaccineRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "babyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dose" TEXT NOT NULL,
    "scheduledDate" TEXT NOT NULL,
    "completedDate" TEXT,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "VaccineRecord_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "Baby" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_VaccineRecord" ("babyId", "completedDate", "dose", "id", "isCompleted", "name", "scheduledDate") SELECT "babyId", "completedDate", "dose", "id", "isCompleted", "name", "scheduledDate" FROM "VaccineRecord";
DROP TABLE "VaccineRecord";
ALTER TABLE "new_VaccineRecord" RENAME TO "VaccineRecord";
CREATE INDEX "VaccineRecord_babyId_scheduledDate_idx" ON "VaccineRecord"("babyId", "scheduledDate");
CREATE TABLE "new_VaccineSourceRef" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vaccineId" TEXT NOT NULL,
    "sourceRefId" TEXT NOT NULL,
    CONSTRAINT "VaccineSourceRef_vaccineId_fkey" FOREIGN KEY ("vaccineId") REFERENCES "Vaccine" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VaccineSourceRef_sourceRefId_fkey" FOREIGN KEY ("sourceRefId") REFERENCES "SourceRef" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_VaccineSourceRef" ("id", "sourceRefId", "vaccineId") SELECT "id", "sourceRefId", "vaccineId" FROM "VaccineSourceRef";
DROP TABLE "VaccineSourceRef";
ALTER TABLE "new_VaccineSourceRef" RENAME TO "VaccineSourceRef";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
CREATE UNIQUE INDEX "PersonalAccessToken_tokenHash_key" ON "PersonalAccessToken"("tokenHash");
CREATE INDEX "PersonalAccessToken_userId_idx" ON "PersonalAccessToken"("userId");
CREATE INDEX "AgentVoiceLog_userId_acknowledged_createdAt_idx" ON "AgentVoiceLog"("userId", "acknowledged", "createdAt");
CREATE INDEX "AgentVoiceLog_babyId_createdAt_idx" ON "AgentVoiceLog"("babyId", "createdAt");
