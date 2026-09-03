-- AlterTable
ALTER TABLE "DiaperRecord" ADD COLUMN "source" TEXT DEFAULT 'ui_manual';
ALTER TABLE "DiaperRecord" ADD COLUMN "sourceAgent" TEXT;

-- AlterTable
ALTER TABLE "FoodLogRecord" ADD COLUMN "source" TEXT DEFAULT 'ui_manual';
ALTER TABLE "FoodLogRecord" ADD COLUMN "sourceAgent" TEXT;

-- AlterTable
ALTER TABLE "GrowthMeasurement" ADD COLUMN "source" TEXT DEFAULT 'ui_manual';
ALTER TABLE "GrowthMeasurement" ADD COLUMN "sourceAgent" TEXT;

-- AlterTable
ALTER TABLE "MedicalReport" ADD COLUMN "source" TEXT DEFAULT 'ui_manual';
ALTER TABLE "MedicalReport" ADD COLUMN "sourceAgent" TEXT;

-- AlterTable
ALTER TABLE "SleepRecord" ADD COLUMN "source" TEXT DEFAULT 'ui_manual';
ALTER TABLE "SleepRecord" ADD COLUMN "sourceAgent" TEXT;

-- CreateTable
CREATE TABLE "FormulaProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "stage" INTEGER,
    "scoopWeightG" REAL NOT NULL DEFAULT 4.3,
    "waterPerScoopMl" REAL NOT NULL DEFAULT 30.0,
    "reconstitutionRatio" REAL NOT NULL DEFAULT 0.135,
    "servingSizeUnit" TEXT NOT NULL DEFAULT 'per_100g',
    "nutrientsJson" TEXT NOT NULL,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FormulaProduct_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SupplementProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "dosageForm" TEXT NOT NULL,
    "unitName" TEXT NOT NULL,
    "defaultDose" REAL NOT NULL DEFAULT 1.0,
    "nutrientsJson" TEXT NOT NULL,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SupplementProduct_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SupplementSchedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "babyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "frequency" TEXT NOT NULL DEFAULT 'daily',
    "customDaysJson" TEXT,
    "targetDose" REAL NOT NULL DEFAULT 1.0,
    "reminderTime" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startDate" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SupplementSchedule_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "Baby" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SupplementSchedule_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SupplementProduct" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SupplementRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "babyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "clientId" TEXT,
    "recordedById" TEXT,
    "source" TEXT DEFAULT 'ui_manual',
    "sourceAgent" TEXT,
    "date" TEXT NOT NULL,
    "time" TEXT NOT NULL,
    "dose" REAL NOT NULL DEFAULT 1.0,
    "unitName" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplementRecord_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "Baby" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SupplementRecord_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SupplementProduct" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OAuthClient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT,
    "clientName" TEXT,
    "redirectUrisJson" TEXT NOT NULL,
    "grantTypesJson" TEXT NOT NULL DEFAULT '["authorization_code","refresh_token"]',
    "responseTypesJson" TEXT NOT NULL DEFAULT '["code"]',
    "scope" TEXT DEFAULT 'baby:read baby:write',
    "tokenEndpointAuthMethod" TEXT NOT NULL DEFAULT 'none',
    "isDynamic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OAuthAuthorizationCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "babyId" TEXT,
    "redirectUri" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "resource" TEXT,
    "codeChallenge" TEXT NOT NULL,
    "codeChallengeMethod" TEXT NOT NULL DEFAULT 'S256',
    "expiresAt" DATETIME NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OAuthAuthorizationCode_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "OAuthClient" ("clientId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OAuthAuthorizationCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OAuthAuthorizationCode_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "Baby" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OAuthRefreshToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "babyId" TEXT,
    "scope" TEXT NOT NULL,
    "resource" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OAuthRefreshToken_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "OAuthClient" ("clientId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OAuthRefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OAuthRefreshToken_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "Baby" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OAuthConsent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "babyId" TEXT,
    "scope" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OAuthConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OAuthConsent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "OAuthClient" ("clientId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OAuthConsent_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "Baby" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OAuthAuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT,
    "clientId" TEXT,
    "userId" TEXT,
    "babyId" TEXT,
    "action" TEXT NOT NULL,
    "toolName" TEXT,
    "authResult" TEXT NOT NULL,
    "durationMs" INTEGER,
    "statusCode" INTEGER,
    "ip" TEXT,
    "userAgent" TEXT,
    "metadataJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "RecordSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "babyId" TEXT NOT NULL,
    "userId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'mcp',
    "sourceAgent" TEXT,
    "action" TEXT NOT NULL DEFAULT 'delete',
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "restored" BOOLEAN NOT NULL DEFAULT false,
    "restoredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecordSnapshot_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "Baby" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FeedingRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "babyId" TEXT NOT NULL,
    "formulaProductId" TEXT,
    "clientId" TEXT,
    "recordedById" TEXT,
    "source" TEXT DEFAULT 'ui_manual',
    "sourceAgent" TEXT,
    "timestamp" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountMl" INTEGER,
    "leftMinutes" INTEGER,
    "rightMinutes" INTEGER,
    "spitUp" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeedingRecord_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "Baby" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FeedingRecord_formulaProductId_fkey" FOREIGN KEY ("formulaProductId") REFERENCES "FormulaProduct" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_FeedingRecord" ("amountMl", "babyId", "clientId", "createdAt", "id", "leftMinutes", "notes", "recordedById", "rightMinutes", "spitUp", "timestamp", "type") SELECT "amountMl", "babyId", "clientId", "createdAt", "id", "leftMinutes", "notes", "recordedById", "rightMinutes", "spitUp", "timestamp", "type" FROM "FeedingRecord";
DROP TABLE "FeedingRecord";
ALTER TABLE "new_FeedingRecord" RENAME TO "FeedingRecord";
CREATE INDEX "FeedingRecord_babyId_timestamp_idx" ON "FeedingRecord"("babyId", "timestamp");
CREATE INDEX "FeedingRecord_formulaProductId_idx" ON "FeedingRecord"("formulaProductId");
CREATE UNIQUE INDEX "FeedingRecord_babyId_clientId_key" ON "FeedingRecord"("babyId", "clientId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "FormulaProduct_familyId_idx" ON "FormulaProduct"("familyId");

-- CreateIndex
CREATE INDEX "SupplementProduct_familyId_idx" ON "SupplementProduct"("familyId");

-- CreateIndex
CREATE INDEX "SupplementSchedule_babyId_idx" ON "SupplementSchedule"("babyId");

-- CreateIndex
CREATE INDEX "SupplementSchedule_productId_idx" ON "SupplementSchedule"("productId");

-- CreateIndex
CREATE INDEX "SupplementRecord_babyId_date_idx" ON "SupplementRecord"("babyId", "date");

-- CreateIndex
CREATE INDEX "SupplementRecord_productId_idx" ON "SupplementRecord"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplementRecord_babyId_clientId_key" ON "SupplementRecord"("babyId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthClient_clientId_key" ON "OAuthClient"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthAuthorizationCode_code_key" ON "OAuthAuthorizationCode"("code");

-- CreateIndex
CREATE INDEX "OAuthAuthorizationCode_clientId_idx" ON "OAuthAuthorizationCode"("clientId");

-- CreateIndex
CREATE INDEX "OAuthAuthorizationCode_userId_idx" ON "OAuthAuthorizationCode"("userId");

-- CreateIndex
CREATE INDEX "OAuthAuthorizationCode_code_idx" ON "OAuthAuthorizationCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthRefreshToken_tokenHash_key" ON "OAuthRefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "OAuthRefreshToken_clientId_idx" ON "OAuthRefreshToken"("clientId");

-- CreateIndex
CREATE INDEX "OAuthRefreshToken_userId_idx" ON "OAuthRefreshToken"("userId");

-- CreateIndex
CREATE INDEX "OAuthRefreshToken_tokenHash_idx" ON "OAuthRefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "OAuthConsent_userId_idx" ON "OAuthConsent"("userId");

-- CreateIndex
CREATE INDEX "OAuthConsent_clientId_idx" ON "OAuthConsent"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthConsent_userId_clientId_babyId_key" ON "OAuthConsent"("userId", "clientId", "babyId");

-- CreateIndex
CREATE INDEX "OAuthAuditLog_userId_createdAt_idx" ON "OAuthAuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "OAuthAuditLog_clientId_createdAt_idx" ON "OAuthAuditLog"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "OAuthAuditLog_action_createdAt_idx" ON "OAuthAuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "RecordSnapshot_babyId_createdAt_idx" ON "RecordSnapshot"("babyId", "createdAt");

-- CreateIndex
CREATE INDEX "RecordSnapshot_entityType_entityId_idx" ON "RecordSnapshot"("entityType", "entityId");

