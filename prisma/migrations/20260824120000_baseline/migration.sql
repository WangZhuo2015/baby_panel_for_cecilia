-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Family" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "FamilyMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "relation" TEXT NOT NULL DEFAULT 'parent',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FamilyMember_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FamilyMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Baby" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "gender" TEXT NOT NULL DEFAULT 'female',
    "birthDate" TEXT NOT NULL,
    "gestationalAge" INTEGER,
    "avatarUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Baby_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FeedingRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "babyId" TEXT NOT NULL,
    "recordedById" TEXT,
    "timestamp" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountMl" INTEGER,
    "leftMinutes" INTEGER,
    "rightMinutes" INTEGER,
    "spitUp" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeedingRecord_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "Baby" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SleepRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "babyId" TEXT NOT NULL,
    "recordedById" TEXT,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "nightWakingCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SleepRecord_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "Baby" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DiaperRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "babyId" TEXT NOT NULL,
    "recordedById" TEXT,
    "timestamp" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "poopColor" TEXT,
    "poopConsistency" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiaperRecord_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "Baby" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GrowthMeasurement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "babyId" TEXT NOT NULL,
    "recordedById" TEXT,
    "date" TEXT NOT NULL,
    "ageInMonths" INTEGER,
    "ageLabel" TEXT NOT NULL,
    "weightKg" REAL,
    "heightCm" REAL,
    "headCircumferenceCm" REAL,
    "percentile" INTEGER,
    "imageUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GrowthMeasurement_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "Baby" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MedicalReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "babyId" TEXT NOT NULL,
    "recordedById" TEXT,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "hospital" TEXT,
    "doctorNotes" TEXT,
    "aiSummary" TEXT,
    "itemsJson" TEXT NOT NULL,
    "imageUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MedicalReport_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "Baby" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FoodLogRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "babyId" TEXT NOT NULL,
    "recordedById" TEXT,
    "date" TEXT NOT NULL,
    "time" TEXT NOT NULL,
    "foods" TEXT NOT NULL,
    "portion" TEXT NOT NULL,
    "acceptance" INTEGER NOT NULL,
    "babyState" TEXT NOT NULL,
    "hasAbnormal" BOOLEAN NOT NULL DEFAULT false,
    "abnormalNotes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FoodLogRecord_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "Baby" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FamilyFoodStatus" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "foodId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'to_try',
    "firstAddedDate" TEXT,
    "acceptance" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FamilyFoodStatus_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FamilyBookStatus" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "readCount" INTEGER NOT NULL DEFAULT 0,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FamilyBookStatus_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DataRelease" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "asOf" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SourceRef" (
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
    CONSTRAINT "SourceRef_dataReleaseId_fkey" FOREIGN KEY ("dataReleaseId") REFERENCES "DataRelease" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Vaccine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vaccineId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "englishName" TEXT,
    "programType" TEXT NOT NULL,
    "legacyLabel" TEXT,
    "sexRestriction" TEXT NOT NULL DEFAULT 'all',
    "chinaNational" BOOLEAN NOT NULL DEFAULT false,
    "diseases" TEXT NOT NULL,
    "targetPopulation" TEXT,
    "policyEffectiveDate" TEXT,
    "policyVersion" TEXT,
    "routineHealthyChildOption" BOOLEAN NOT NULL DEFAULT true,
    "manualReviewRequired" BOOLEAN NOT NULL DEFAULT false,
    "marketStatus" TEXT,
    "productBrandName" TEXT,
    "productManufacturer" TEXT,
    "productApprovalNumber" TEXT,
    "jiangsuNotes" TEXT,
    "suzhouNotes" TEXT,
    "catchUpSupported" BOOLEAN NOT NULL DEFAULT false,
    "catchUpRules" TEXT NOT NULL,
    "simultaneousVaccination" TEXT,
    "substitutionRules" TEXT NOT NULL,
    "contraindications" TEXT NOT NULL,
    "precautions" TEXT NOT NULL,
    "specialPopulations" TEXT NOT NULL,
    "regionalOverrides" TEXT NOT NULL,
    "regimenOptions" TEXT NOT NULL,
    "sourceRefsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "VaccineDose" (
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
    CONSTRAINT "VaccineDose_vaccineId_fkey" FOREIGN KEY ("vaccineId") REFERENCES "Vaccine" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VaccineSourceRef" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vaccineId" TEXT NOT NULL,
    "sourceRefId" TEXT NOT NULL,
    CONSTRAINT "VaccineSourceRef_vaccineId_fkey" FOREIGN KEY ("vaccineId") REFERENCES "Vaccine" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "VaccineSourceRef_sourceRefId_fkey" FOREIGN KEY ("sourceRefId") REFERENCES "SourceRef" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VaccineStrategyGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "strategyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" TEXT,
    "baseProgram" TEXT,
    "optionsJson" TEXT NOT NULL,
    "sourceRefsJson" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "VaccineScheduleEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ageMonths" INTEGER,
    "ageDays" INTEGER,
    "ageLabel" TEXT,
    "vaccineId" TEXT NOT NULL,
    "doseNumber" INTEGER NOT NULL,
    "priority" TEXT NOT NULL,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "action" TEXT,
    "selectionGroup" TEXT,
    "notes" TEXT,
    "sourceRefsJson" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "ScheduleEngineRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ruleId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "vaccineIdsJson" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sourceRefsJson" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "DevelopmentMilestone" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "milestoneId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "originalDomain" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "assessmentAgeMonths" INTEGER NOT NULL,
    "ageRangeEarliestMonth" INTEGER,
    "ageRangeMedianMonth" INTEGER,
    "ageRangeLatestMonth" INTEGER,
    "criterionType" TEXT,
    "criterionThreshold" TEXT,
    "criterionDescription" TEXT,
    "observationMethod" TEXT,
    "requiresProfessionalAssessment" BOOLEAN NOT NULL DEFAULT false,
    "sourceSystem" TEXT,
    "sourceRefsJson" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "MilestoneSourceRef" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "milestoneId" TEXT NOT NULL,
    "sourceRefId" TEXT NOT NULL,
    CONSTRAINT "MilestoneSourceRef_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "DevelopmentMilestone" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MilestoneSourceRef_sourceRefId_fkey" FOREIGN KEY ("sourceRefId") REFERENCES "SourceRef" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DevelopmentWarningSign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "warningSignId" TEXT NOT NULL,
    "ageMonths" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "recommendedAction" TEXT NOT NULL,
    "urgency" TEXT NOT NULL,
    "sourceRefsJson" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "FeedingGuideline" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ageMinMonths" INTEGER NOT NULL,
    "ageMaxMonths" INTEGER NOT NULL,
    "mealFrequency" TEXT,
    "milkGuidance" TEXT,
    "textureJson" TEXT NOT NULL,
    "foodDiversityJson" TEXT NOT NULL,
    "responsiveFeedingJson" TEXT NOT NULL,
    "safetyJson" TEXT NOT NULL,
    "sourceRefsJson" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "FoodItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "foodId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "foodGroup" TEXT,
    "recommendedFromMonth" INTEGER,
    "recommendedToMonth" INTEGER,
    "exactMonthEvidence" BOOLEAN NOT NULL DEFAULT false,
    "guidance" TEXT,
    "isCommonAllergen" BOOLEAN,
    "allergenIntroductionGuidance" TEXT,
    "highRiskInfantNeedsMedicalAdvice" BOOLEAN,
    "chokingRisk" BOOLEAN NOT NULL DEFAULT false,
    "chokingNotes" TEXT,
    "preparationJson" TEXT NOT NULL,
    "avoidBeforeMonths" INTEGER,
    "nutritionJson" TEXT NOT NULL,
    "textureByAgeJson" TEXT NOT NULL,
    "notes" TEXT,
    "sourceRefsJson" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Book" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "originalTitle" TEXT,
    "authorJson" TEXT NOT NULL,
    "illustratorJson" TEXT,
    "translatorJson" TEXT,
    "publisher" TEXT,
    "isbn" TEXT,
    "editionYear" INTEGER,
    "language" TEXT,
    "origin" TEXT,
    "ageMinMonths" INTEGER,
    "ageMaxMonths" INTEGER,
    "categoriesJson" TEXT NOT NULL,
    "bookFormat" TEXT,
    "description" TEXT,
    "interactionSuggestionsJson" TEXT,
    "whyAgeAppropriate" TEXT,
    "ratingScore" REAL,
    "ratingCount" INTEGER,
    "ratingSource" TEXT,
    "ratingRetrievedDate" TEXT,
    "coverColor" TEXT,
    "sourceRefsJson" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "ActivityRecommendation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "activityId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "categoriesJson" TEXT NOT NULL,
    "ageMinMonths" INTEGER,
    "ageMaxMonths" INTEGER,
    "developmentGoalsJson" TEXT NOT NULL,
    "materialsJson" TEXT NOT NULL,
    "stepsJson" TEXT NOT NULL,
    "targetMonthMin" INTEGER,
    "targetMonthMax" INTEGER,
    "goal" TEXT,
    "durationMinutes" INTEGER,
    "frequency" TEXT,
    "difficulty" TEXT,
    "supervision" TEXT,
    "safetyJson" TEXT NOT NULL,
    "stopConditionsJson" TEXT NOT NULL,
    "evidenceType" TEXT,
    "medicalTreatment" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "sourceRefsJson" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "FoodPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "babyId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tags" TEXT NOT NULL,
    "nutrition" TEXT NOT NULL,
    "ingredients" TEXT NOT NULL,
    "steps" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FoodPlan_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "Baby" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VaccineRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "babyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dose" TEXT NOT NULL,
    "scheduledDate" TEXT NOT NULL,
    "completedDate" TEXT,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "countdownDays" INTEGER,
    CONSTRAINT "VaccineRecord_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "Baby" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VaccineSelection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "babyId" TEXT NOT NULL,
    "vaccineId" TEXT NOT NULL,
    "doseNumber" INTEGER NOT NULL DEFAULT 1,
    "selected" BOOLEAN NOT NULL DEFAULT true,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VaccineSelection_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "Baby" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "endpoint" TEXT NOT NULL,
    "keysJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Family_inviteCode_key" ON "Family"("inviteCode");

-- CreateIndex
CREATE INDEX "FamilyMember_userId_idx" ON "FamilyMember"("userId");

-- CreateIndex
CREATE INDEX "FamilyMember_familyId_idx" ON "FamilyMember"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "FamilyMember_familyId_userId_key" ON "FamilyMember"("familyId", "userId");

-- CreateIndex
CREATE INDEX "Baby_familyId_idx" ON "Baby"("familyId");

-- CreateIndex
CREATE INDEX "FeedingRecord_babyId_timestamp_idx" ON "FeedingRecord"("babyId", "timestamp");

-- CreateIndex
CREATE INDEX "SleepRecord_babyId_startTime_idx" ON "SleepRecord"("babyId", "startTime");

-- CreateIndex
CREATE INDEX "DiaperRecord_babyId_timestamp_idx" ON "DiaperRecord"("babyId", "timestamp");

-- CreateIndex
CREATE INDEX "GrowthMeasurement_babyId_date_idx" ON "GrowthMeasurement"("babyId", "date");

-- CreateIndex
CREATE INDEX "MedicalReport_babyId_date_idx" ON "MedicalReport"("babyId", "date");

-- CreateIndex
CREATE INDEX "MedicalReport_babyId_category_date_idx" ON "MedicalReport"("babyId", "category", "date");

-- CreateIndex
CREATE INDEX "FoodLogRecord_babyId_date_idx" ON "FoodLogRecord"("babyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "FamilyFoodStatus_familyId_foodId_key" ON "FamilyFoodStatus"("familyId", "foodId");

-- CreateIndex
CREATE UNIQUE INDEX "FamilyBookStatus_familyId_bookId_key" ON "FamilyBookStatus"("familyId", "bookId");

-- CreateIndex
CREATE UNIQUE INDEX "Vaccine_vaccineId_key" ON "Vaccine"("vaccineId");

-- CreateIndex
CREATE INDEX "VaccineDose_vaccineId_idx" ON "VaccineDose"("vaccineId");

-- CreateIndex
CREATE UNIQUE INDEX "VaccineStrategyGroup_strategyId_key" ON "VaccineStrategyGroup"("strategyId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleEngineRule_ruleId_key" ON "ScheduleEngineRule"("ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "DevelopmentMilestone_milestoneId_key" ON "DevelopmentMilestone"("milestoneId");

-- CreateIndex
CREATE INDEX "DevelopmentMilestone_assessmentAgeMonths_category_idx" ON "DevelopmentMilestone"("assessmentAgeMonths", "category");

-- CreateIndex
CREATE UNIQUE INDEX "DevelopmentWarningSign_warningSignId_key" ON "DevelopmentWarningSign"("warningSignId");

-- CreateIndex
CREATE UNIQUE INDEX "FoodItem_foodId_key" ON "FoodItem"("foodId");

-- CreateIndex
CREATE UNIQUE INDEX "Book_bookId_key" ON "Book"("bookId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityRecommendation_activityId_key" ON "ActivityRecommendation"("activityId");

-- CreateIndex
CREATE INDEX "FoodPlan_babyId_date_idx" ON "FoodPlan"("babyId", "date");

-- CreateIndex
CREATE INDEX "VaccineRecord_babyId_scheduledDate_idx" ON "VaccineRecord"("babyId", "scheduledDate");

-- CreateIndex
CREATE UNIQUE INDEX "VaccineSelection_babyId_vaccineId_doseNumber_key" ON "VaccineSelection"("babyId", "vaccineId", "doseNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

