-- CreateTable
CREATE TABLE "Baby" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nickname" TEXT NOT NULL,
    "gender" TEXT NOT NULL DEFAULT 'female',
    "birthDate" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "FeedingRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "timestamp" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountMl" INTEGER,
    "leftMinutes" INTEGER,
    "rightMinutes" INTEGER,
    "spitUp" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SleepRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "nightWakingCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "DiaperRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "timestamp" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "poopColor" TEXT,
    "poopConsistency" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "GrowthMeasurement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "ageLabel" TEXT NOT NULL,
    "weightKg" REAL,
    "heightCm" REAL,
    "headCircumferenceCm" REAL,
    "percentile" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "FoodLogRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "time" TEXT NOT NULL,
    "foods" TEXT NOT NULL,
    "portion" TEXT NOT NULL,
    "acceptance" INTEGER NOT NULL,
    "babyState" TEXT NOT NULL,
    "hasAbnormal" BOOLEAN NOT NULL DEFAULT false,
    "abnormalNotes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    "firstAddedDate" TEXT,
    "acceptance" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'to_try',
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
    "readCount" INTEGER NOT NULL DEFAULT 0,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
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
    "date" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tags" TEXT NOT NULL,
    "nutrition" TEXT NOT NULL,
    "ingredients" TEXT NOT NULL,
    "steps" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "VaccineRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "dose" TEXT NOT NULL,
    "scheduledDate" TEXT NOT NULL,
    "completedDate" TEXT,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "countdownDays" INTEGER
);

-- CreateIndex
CREATE UNIQUE INDEX "Vaccine_vaccineId_key" ON "Vaccine"("vaccineId");

-- CreateIndex
CREATE UNIQUE INDEX "VaccineStrategyGroup_strategyId_key" ON "VaccineStrategyGroup"("strategyId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleEngineRule_ruleId_key" ON "ScheduleEngineRule"("ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "DevelopmentMilestone_milestoneId_key" ON "DevelopmentMilestone"("milestoneId");

-- CreateIndex
CREATE UNIQUE INDEX "DevelopmentWarningSign_warningSignId_key" ON "DevelopmentWarningSign"("warningSignId");

-- CreateIndex
CREATE UNIQUE INDEX "FoodItem_foodId_key" ON "FoodItem"("foodId");

-- CreateIndex
CREATE UNIQUE INDEX "Book_bookId_key" ON "Book"("bookId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityRecommendation_activityId_key" ON "ActivityRecommendation"("activityId");
