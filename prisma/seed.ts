import { PrismaClient } from '../generated/prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');

function readJson<T>(filename: string): T {
  const filePath = path.join(DATA_DIR, filename);
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

function resolveDbPath(): string {
  const envUrl = process.env.DATABASE_URL;
  if (envUrl?.startsWith('file:')) {
    return path.resolve(process.cwd(), envUrl.slice('file:'.length));
  }
  return path.join(process.cwd(), 'dev.db');
}

async function main() {
  const dbPath = resolveDbPath();
  const adapter = new PrismaLibSql({ url: `file:${dbPath}` } as any);
  const prisma = new PrismaClient({ adapter });

  console.log('🗑️  Cleaning existing data...');
  await prisma.activityRecommendation.deleteMany();
  await prisma.book.deleteMany();
  await prisma.foodItem.deleteMany();
  await prisma.feedingGuideline.deleteMany();
  await prisma.developmentWarningSign.deleteMany();
  await prisma.developmentMilestone.deleteMany();
  await prisma.scheduleEngineRule.deleteMany();
  await prisma.vaccineScheduleEntry.deleteMany();
  await prisma.vaccineStrategyGroup.deleteMany();
  await prisma.vaccineDose.deleteMany();
  await prisma.vaccine.deleteMany();
  await prisma.sourceRef.deleteMany();
  await prisma.dataRelease.deleteMany();
  await prisma.baby.deleteMany();

  // ── Read all JSON files ─────────────────────────────────────────────
  console.log('📖 Reading JSON files...');
  const sourcesData = readJson<any>('01_sources.json');
  const sources = sourcesData.sources ?? sourcesData;
  const vaccinesData = readJson<any>('02_vaccines.json');
  const milestonesData = readJson<any>('03_milestones.json');
  const foodsData = readJson<any>('04_foods.json');
  const booksData = readJson<any>('05_books.json');
  const books = booksData.books ?? booksData;
  const activitiesData = readJson<any>('06_activities.json');
  const activities = activitiesData.activities ?? activitiesData;

  // ── 1. DataRelease ──────────────────────────────────────────────────
  console.log('📅 Creating DataRelease...');
  await prisma.dataRelease.create({
    data: {
      title: sourcesData.datasetMeta?.title ?? '0–3岁中国婴幼儿育儿数据库',
      asOf: sourcesData.datasetMeta?.asOf ?? '2026-08-03',
    },
  });

  // ── 2. SourceRefs ───────────────────────────────────────────────────
  console.log(`📚 Creating ${sources.length} SourceRefs...`);
  await prisma.sourceRef.createMany({
    data: sources.map((s: any) => ({
      sourceId: s.id,
      title: s.title,
      organization: s.organization ?? null,
      year: s.year ?? null,
      publicationDate: s.publicationDate ?? null,
      url: s.url ?? null,
      sourceLevel: s.sourceLevel ?? null,
      sourceType: s.sourceType ?? null,
      accessedDate: s.accessedDate ?? null,
      notes: s.notes ?? null,
    })),
  });

  // ── 3. Vaccines + VaccineDoses ──────────────────────────────────────
  const vaccines: any[] = vaccinesData.vaccines ?? vaccinesData;
  console.log(`💉 Creating ${vaccines.length} Vaccines...`);

  for (const v of vaccines) {
    const created = await prisma.vaccine.create({
      data: {
        vaccineId: v.id,
        name: v.name,
        shortName: v.shortName ?? null,
        englishName: v.englishName ?? null,
        programType: v.programType ?? 'non_program',
        legacyLabel: v.legacyLabel ?? null,
        sexRestriction: v.sexRestriction ?? 'all',
        chinaNational: v.chinaNational ?? false,
        diseases: v.diseases ? JSON.stringify(v.diseases) : '[]',
        targetPopulation: v.targetPopulation ?? null,
        policyEffectiveDate: v.policyEffectiveDate ?? null,
        policyVersion: v.policyVersion ?? null,
        routineHealthyChildOption: v.routineHealthyChildOption ?? true,
        manualReviewRequired: v.manualReviewRequired ?? false,
        marketStatus: v.marketStatus ?? null,
        productBrandName: v.product?.brandName ?? null,
        productManufacturer: v.product?.manufacturer ?? null,
        productApprovalNumber: v.product?.approvalNumber ?? null,
        jiangsuNotes: v.jiangsuNotes ?? null,
        suzhouNotes: v.suzhouNotes ?? null,
        catchUpSupported: v.catchUp?.supported ?? false,
        catchUpRules: v.catchUp?.rules ? JSON.stringify(v.catchUp.rules) : '[]',
        simultaneousVaccination: v.simultaneousVaccination ?? null,
        substitutionRules: v.substitutionRules ? JSON.stringify(v.substitutionRules) : '[]',
        contraindications: v.contraindications ? JSON.stringify(v.contraindications) : '[]',
        precautions: v.precautions ? JSON.stringify(v.precautions) : '[]',
        specialPopulations: v.specialPopulations ? JSON.stringify(v.specialPopulations) : '[]',
        regionalOverrides: v.regionalProgramOverrides ? JSON.stringify(v.regionalProgramOverrides) : '[]',
        regimenOptions: v.regimenOptions ? JSON.stringify(v.regimenOptions) : '[]',
        sourceRefsJson: v.sourceRefs ? JSON.stringify(v.sourceRefs) : '[]',
      },
    });

    if (v.doses && v.doses.length > 0) {
      await prisma.vaccineDose.createMany({
        data: v.doses.map((d: any) => ({
          vaccineId: created.id,
          doseNumber: d.doseNumber,
          doseLabel: d.doseLabel ?? `第${d.doseNumber}剂`,
          recommendedAgeMonths: d.recommendedAgeMonths ?? null,
          minimumAgeDays: d.minimumAgeDays ?? null,
          maximumAgeDays: d.maximumAgeDays ?? null,
          recommendedAgeMaxMonths: d.recommendedAgeMaxMonths ?? null,
          minimumIntervalDaysFromPrevious: d.minimumIntervalDaysFromPrevious ?? null,
          maximumIntervalDaysFromPrevious: d.maximumIntervalDaysFromPrevious ?? null,
          route: d.route ?? null,
          site: d.site ?? null,
          doseVolumeMl: d.doseVolumeMl ?? null,
          notes: d.notes ?? null,
          sourceRefsJson: d.sourceRefs ? JSON.stringify(d.sourceRefs) : '[]',
        })),
      });
    }
  }

  // ── 4. VaccineStrategyGroups ────────────────────────────────────────
  const strategyTemplates: any[] = vaccinesData.vaccineStrategyTemplates ?? [];
  console.log(`🧩 Creating ${strategyTemplates.length} VaccineStrategyGroups...`);
  if (strategyTemplates.length > 0) {
    await prisma.vaccineStrategyGroup.createMany({
      data: strategyTemplates.map((s: any) => ({
        strategyId: s.id,
        name: s.name,
        scope: s.scope ?? null,
        baseProgram: s.baseProgram ?? null,
        optionsJson: s.optionalSelections ? JSON.stringify(s.optionalSelections) : '[]',
        sourceRefsJson: s.sourceRefs ? JSON.stringify(s.sourceRefs) : '[]',
      })),
    });
  }

  // ── 5. VaccineScheduleEntries ───────────────────────────────────────
  const vaccineSchedule: any[] = vaccinesData.vaccineSchedule ?? [];
  const optionalVaccineTimeline: any[] = vaccinesData.optionalVaccineTimeline ?? [];
  console.log(`📆 Creating VaccineScheduleEntries (${vaccineSchedule.length} routine + ${optionalVaccineTimeline.length} optional)...`);

  const scheduleEntries: any[] = [];

  for (const entry of vaccineSchedule) {
    for (const item of (entry.items ?? [])) {
      scheduleEntries.push({
        ageMonths: entry.ageMonths,
        vaccineId: item.vaccineId,
        doseNumber: item.doseNumber ?? 1,
        priority: item.priority ?? 'routine',
        isOptional: false,
        sourceRefsJson: item.sourceRefs ? JSON.stringify(item.sourceRefs) : '[]',
      });
    }
  }

  for (const entry of optionalVaccineTimeline) {
    for (const item of (entry.items ?? [])) {
      scheduleEntries.push({
        ageMonths: entry.ageMonths ?? null,
        ageDays: entry.ageDays ?? null,
        ageLabel: entry.ageLabel ?? null,
        vaccineId: item.vaccineId,
        doseNumber: 1,
        priority: 'optional',
        isOptional: true,
        action: item.action ?? null,
        selectionGroup: item.selectionGroup ?? null,
        sourceRefsJson: item.sourceRefs ? JSON.stringify(item.sourceRefs) : '[]',
      });
    }
  }

  if (scheduleEntries.length > 0) {
    await prisma.vaccineScheduleEntry.createMany({ data: scheduleEntries });
  }

  // ── 6. ScheduleEngineRules ──────────────────────────────────────────
  const scheduleEngineRules: any[] = vaccinesData.scheduleEngineRules ?? [];
  console.log(`⚙️  Creating ${scheduleEngineRules.length} ScheduleEngineRules...`);
  if (scheduleEngineRules.length > 0) {
    await prisma.scheduleEngineRule.createMany({
      data: scheduleEngineRules.map((r: any) => ({
        ruleId: r.id,
        type: r.type,
        vaccineIdsJson: r.vaccineIds ? JSON.stringify(r.vaccineIds) : '[]',
        description: r.description ?? '',
        sourceRefsJson: r.sourceRefs ? JSON.stringify(r.sourceRefs) : '[]',
      })),
    });
  }

  // ── 7. DevelopmentMilestones ────────────────────────────────────────
  const milestones: any[] = milestonesData.milestones ?? milestonesData;
  console.log(`🌱 Creating ${milestones.length} DevelopmentMilestones...`);
  await prisma.developmentMilestone.createMany({
    data: milestones.map((m: any) => ({
      milestoneId: m.id,
      category: m.category ?? 'cognitive',
      originalDomain: m.originalDomain ?? null,
      title: m.title,
      description: m.description ?? m.title,
      assessmentAgeMonths: m.assessmentAgeMonths ?? 0,
      ageRangeEarliestMonth: m.ageRange?.earliestMonth ?? null,
      ageRangeMedianMonth: m.ageRange?.medianMonth ?? null,
      ageRangeLatestMonth: m.ageRange?.latestMonth ?? null,
      criterionType: m.criterion?.type ?? null,
      criterionThreshold: m.criterion?.threshold ?? null,
      criterionDescription: m.criterion?.description ?? null,
      observationMethod: m.observationMethod ?? null,
      requiresProfessionalAssessment: m.requiresProfessionalAssessment ?? false,
      sourceSystem: m.sourceSystem ?? null,
      sourceRefsJson: m.sourceRefs ? JSON.stringify(m.sourceRefs) : '[]',
    })),
  });

  // ── 8. DevelopmentWarningSigns ──────────────────────────────────────
  const redFlags: any[] = milestonesData.developmentRedFlags ?? [];
  console.log(`🚩 Creating ${redFlags.length} DevelopmentWarningSigns...`);
  if (redFlags.length > 0) {
    await prisma.developmentWarningSign.createMany({
      data: redFlags.map((f: any) => ({
        warningSignId: f.id,
        ageMonths: f.ageMonths,
        category: f.category ?? 'language',
        description: f.description ?? '',
        recommendedAction: f.recommendedAction ?? '',
        urgency: f.urgency ?? 'routine_evaluation',
        sourceRefsJson: f.sourceRefs ? JSON.stringify(f.sourceRefs) : '[]',
      })),
    });
  }

  // ── 9. FeedingGuidelines ────────────────────────────────────────────
  const feedingGuidelines: any[] = foodsData.feedingGuidelines ?? [];
  console.log(`🍼 Creating ${feedingGuidelines.length} FeedingGuidelines...`);
  if (feedingGuidelines.length > 0) {
    await prisma.feedingGuideline.createMany({
      data: feedingGuidelines.map((g: any) => ({
        ageMinMonths: g.ageMinMonths,
        ageMaxMonths: g.ageMaxMonths,
        mealFrequency: g.mealFrequency ?? null,
        milkGuidance: g.milkGuidance ?? null,
        textureJson: g.texture ? JSON.stringify(g.texture) : '[]',
        foodDiversityJson: g.foodDiversity ? JSON.stringify(g.foodDiversity) : '[]',
        responsiveFeedingJson: g.responsiveFeeding ? JSON.stringify(g.responsiveFeeding) : '[]',
        safetyJson: g.safety ? JSON.stringify(g.safety) : '[]',
        sourceRefsJson: g.sourceRefs ? JSON.stringify(g.sourceRefs) : '[]',
      })),
    });
  }

  // ── 10. FoodItems ───────────────────────────────────────────────────
  const foodItems: any[] = foodsData.foodItems ?? [];
  console.log(`🥦 Creating ${foodItems.length} FoodItems...`);
  if (foodItems.length > 0) {
    await prisma.foodItem.createMany({
      data: foodItems.map((f: any) => ({
        foodId: f.id,
        name: f.name,
        icon: f.icon ?? '🍽️',
        category: f.category ?? 'other',
        foodGroup: f.foodGroup ?? null,
        recommendedFromMonth: f.introduction?.recommendedFromMonth ?? null,
        recommendedToMonth: f.introduction?.recommendedToMonth ?? null,
        exactMonthEvidence: f.introduction?.exactMonthEvidence ?? false,
        guidance: f.introduction?.guidance ?? null,
        isCommonAllergen: f.allergen?.isCommonAllergen ?? null,
        allergenIntroductionGuidance: f.allergen?.introductionGuidance ?? null,
        highRiskInfantNeedsMedicalAdvice: f.allergen?.highRiskInfantNeedsMedicalAdvice ?? null,
        chokingRisk: f.chokingRisk ?? false,
        chokingNotes: f.chokingNotes ?? null,
        preparationJson: f.preparation ? JSON.stringify(f.preparation) : '[]',
        avoidBeforeMonths: f.avoidBeforeMonths ?? null,
        nutritionJson: f.nutrition ? JSON.stringify(f.nutrition) : '[]',
        textureByAgeJson: f.textureByAge ? JSON.stringify(f.textureByAge) : '[]',
        notes: f.notes ?? null,
        sourceRefsJson: f.sourceRefs ? JSON.stringify(f.sourceRefs) : '[]',
      })),
    });
  }

  // ── 11. Books ───────────────────────────────────────────────────────
  console.log(`📖 Creating ${books.length} Books...`);
  await prisma.book.createMany({
    data: books.map((b: any) => ({
      bookId: b.id,
      title: b.title,
      originalTitle: b.originalTitle ?? null,
      authorJson: b.author ? JSON.stringify(b.author) : '[]',
      illustratorJson: b.illustrator ? JSON.stringify(b.illustrator) : null,
      translatorJson: b.translator ? JSON.stringify(b.translator) : null,
      publisher: b.publisher ?? null,
      isbn: b.isbn ?? null,
      editionYear: b.editionYear ?? null,
      language: b.language ?? null,
      origin: b.origin ?? null,
      ageMinMonths: b.ageMinMonths ?? null,
      ageMaxMonths: b.ageMaxMonths ?? null,
      categoriesJson: b.categories ? JSON.stringify(b.categories) : '[]',
      bookFormat: b.bookFormat ?? null,
      description: b.description ?? null,
      interactionSuggestionsJson: b.interactionSuggestions ? JSON.stringify(b.interactionSuggestions) : null,
      whyAgeAppropriate: b.whyAgeAppropriate ?? null,
      ratingScore: b.rating?.score ?? null,
      ratingCount: b.rating?.count ?? null,
      ratingSource: b.rating?.source ?? null,
      ratingRetrievedDate: b.rating?.retrievedDate ?? null,
      coverColor: b.coverColor ?? null,
      sourceRefsJson: b.sourceRefs ? JSON.stringify(b.sourceRefs) : '[]',
    })),
  });

  // ── 12. ActivityRecommendations ─────────────────────────────────────
  console.log(`🎯 Creating ${activities.length} ActivityRecommendations...`);
  await prisma.activityRecommendation.createMany({
    data: activities.map((a: any) => ({
      activityId: a.id,
      title: a.title,
      categoriesJson: a.categories ? JSON.stringify(a.categories) : '[]',
      ageMinMonths: a.ageMinMonths ?? null,
      ageMaxMonths: a.ageMaxMonths ?? null,
      targetMonthMin: a.ageMinMonths ?? null,
      targetMonthMax: a.ageMaxMonths ?? null,
      developmentGoalsJson: a.developmentGoals ? JSON.stringify(a.developmentGoals) : '[]',
      materialsJson: a.materials ? JSON.stringify(a.materials) : '[]',
      stepsJson: a.steps ? JSON.stringify(a.steps) : '[]',
      durationMinutes: a.durationMinutes ?? null,
      frequency: a.frequency ?? null,
      difficulty: a.difficulty ?? null,
      supervision: a.supervision ?? null,
      safetyJson: a.safety ? JSON.stringify(a.safety) : '[]',
      stopConditionsJson: a.stopConditions ? JSON.stringify(a.stopConditions) : '[]',
      evidenceType: a.evidenceType ?? null,
      medicalTreatment: a.medicalTreatment ?? false,
      notes: a.notes ?? null,
      sourceRefsJson: a.sourceRefs ? JSON.stringify(a.sourceRefs) : '[]',
    })),
  });

  // ── 13. Baby ────────────────────────────────────────────────────────
  // 宝宝信息由用户在首次使用时通过 /onboarding 自行填写创建,
  // 这里不再硬编码默认宝宝。
  console.log('👶 Baby record: 由用户初始化时创建(未创建)');

  console.log('✅ Seed complete!');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
