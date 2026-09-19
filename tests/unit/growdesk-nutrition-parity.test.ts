import assert from "node:assert/strict";
import test from "node:test";
import {
  formatSupplementAmount,
  parseSupplementAmount,
  extractProductIdFromNotes,
  encodeProductIdInNotes,
  toGrowDeskFormulaCreatePayload,
  toGrowDeskFormulaUpdatePayload,
  fromGrowDeskFormulaProduct,
  fromGrowDeskSupplementRecordEnriched,
  extractSupplementStateFromFoodPlan,
  mergeSupplementStateIntoFoodPlan,
  type GrowDeskFormulaProduct,
  type GrowDeskSupplementRecord,
} from "@/lib/growdesk/nutrition-compat";
import { isBridgedMethod } from "@/lib/growdesk/bridge-policy";
import { checkSupplementConflict, calculateDailyNutrition, calculateMultiDayNutritionTrend } from "@/lib/nutrition/engine";
import { PRESET_FORMULA_PRODUCTS, PRESET_SUPPLEMENT_PRODUCTS } from "@/lib/nutrition/presets";
import type { FormulaProduct, SupplementProduct, SupplementRecord } from "@/types/nutrition";

test("SH-04NUTRITION: Nutrition Parity & Compat Unit Tests", async (t) => {
  await t.test("1. Bridge Policy Method Allowlist for Nutrition", () => {
    assert.equal(isBridgedMethod("/api/nutrition/products", "GET"), true);
    assert.equal(isBridgedMethod("/api/nutrition/products", "POST"), true);
    assert.equal(isBridgedMethod("/api/nutrition/products", "PUT"), true);
    assert.equal(isBridgedMethod("/api/nutrition/products", "DELETE"), true);
    assert.equal(isBridgedMethod("/api/nutrition/products", "PATCH"), false);

    assert.equal(isBridgedMethod("/api/nutrition/schedules", "GET"), true);
    assert.equal(isBridgedMethod("/api/nutrition/schedules", "POST"), true);
    assert.equal(isBridgedMethod("/api/nutrition/schedules", "DELETE"), true);
    assert.equal(isBridgedMethod("/api/nutrition/schedules", "PUT"), false);

    assert.equal(isBridgedMethod("/api/nutrition/records", "GET"), true);
    assert.equal(isBridgedMethod("/api/nutrition/records", "POST"), true);
    assert.equal(isBridgedMethod("/api/nutrition/records", "DELETE"), true);

    assert.equal(isBridgedMethod("/api/nutrition/analysis", "GET"), true);
    assert.equal(isBridgedMethod("/api/nutrition/analysis", "POST"), false);
  });

  await t.test("2. Amount and Dose Parsing & Formatting", () => {
    assert.equal(formatSupplementAmount(1, "滴"), "1 滴");
    assert.equal(formatSupplementAmount(400, "IU"), "400 IU");
    assert.equal(formatSupplementAmount(1.5, "ml"), "1.5 ml");
    assert.equal(formatSupplementAmount(0, "粒"), "1 粒"); // Fallback to 1.0

    assert.deepEqual(parseSupplementAmount("1 滴"), { dose: 1, unitName: "滴" });
    assert.deepEqual(parseSupplementAmount("400 IU"), { dose: 400, unitName: "IU" });
    assert.deepEqual(parseSupplementAmount("2.5 ml"), { dose: 2.5, unitName: "ml" });
    assert.deepEqual(parseSupplementAmount("100"), { dose: 100, unitName: "滴" });
    assert.deepEqual(parseSupplementAmount(""), { dose: 1, unitName: "滴" });
    assert.deepEqual(parseSupplementAmount(null), { dose: 1, unitName: "滴" });
  });

  await t.test("3. Product ID Tag in Notes Encoding & Extraction", () => {
    const tagged = encodeProductIdInNotes("ostelin_d3", "早起随餐服用");
    assert.equal(tagged, "[productId:ostelin_d3] 早起随餐服用");

    const parsed = extractProductIdFromNotes(tagged);
    assert.equal(parsed.productId, "ostelin_d3");
    assert.equal(parsed.cleanNotes, "早起随餐服用");

    const tagOnly = encodeProductIdInNotes("bio_island_zinc", "");
    assert.equal(tagOnly, "[productId:bio_island_zinc]");
    const parsedTagOnly = extractProductIdFromNotes(tagOnly);
    assert.equal(parsedTagOnly.productId, "bio_island_zinc");
    assert.equal(parsedTagOnly.cleanNotes, null);

    const noTag = extractProductIdFromNotes("纯手工备注无标签");
    assert.equal(noTag.productId, null);
    assert.equal(noTag.cleanNotes, "纯手工备注无标签");
  });

  await t.test("4. Formula Product Payload Conversion & Preset Enrichment", () => {
    // Validation failures
    assert.throws(() => toGrowDeskFormulaCreatePayload({ name: "" }), /奶粉名称必填/);
    assert.throws(
      () => toGrowDeskFormulaCreatePayload({ name: "测试", scoopWeightG: -1 }),
      /单勺克重必须为大于 0 的有效数值/
    );
    assert.throws(
      () => toGrowDeskFormulaCreatePayload({ name: "测试", scoopWeightG: 4.3, waterPerScoopMl: 0 }),
      /每勺加水量必须为大于 0 的有效数值/
    );

    // Successful Create Payload
    const createPayload = toGrowDeskFormulaCreatePayload({
      name: "德国爱他美白金版 Profutura 1段 (0-6个月)",
      brand: "Aptamil/爱他美(德版)",
      stage: 1,
      scoopWeightG: 4.6,
      waterPerScoopMl: 30.0,
    });
    assert.equal(createPayload.name, "德国爱他美白金版 Profutura 1段 (0-6个月)");
    assert.equal(createPayload.brand, "Aptamil/爱他美(德版)");
    assert.equal(createPayload.stage, "1");
    assert.equal(createPayload.scoopGrams, "4.6");
    assert.equal(createPayload.waterMlPerScoop, "30");

    // Update Payload
    const updatePayload = toGrowDeskFormulaUpdatePayload({
      name: "新版爱他美",
      isActive: false,
    });
    assert.equal(updatePayload.name, "新版爱他美");
    assert.equal(updatePayload.isArchived, true);

    // Enrichment from GrowDesk raw item
    const rawItem: GrowDeskFormulaProduct = {
      id: "f-123",
      familyId: "fam-456",
      brand: "Aptamil/爱他美(德版)",
      name: "德国爱他美白金版 Profutura 1段 (0-6个月)",
      stage: "1",
      scoopGrams: "4.60000",
      waterMlPerScoop: "30.00000",
      isArchived: false,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    };

    const enriched = fromGrowDeskFormulaProduct(rawItem, { defaultFormulaId: "f-123" });
    assert.equal(enriched.id, "f-123");
    assert.equal(enriched.isDefault, true);
    assert.equal(enriched.isActive, true);
    assert.equal(enriched.scoopWeightG, 4.6);
    assert.equal(enriched.waterPerScoopMl, 30.0);
    // Verified standard nutrients enriched from preset
    assert.ok(enriched.nutrients.vitamin_d);
    assert.equal(enriched.nutrients.vitamin_d.amount, 400);
    assert.equal(enriched.nutrients.calcium.amount, 400);
  });

  await t.test("5. Supplement Record Enrichment with Product Matching", () => {
    const testProducts: SupplementProduct[] = [
      {
        id: "ostelin_vd3",
        familyId: "fam-1",
        name: "Ostelin 婴幼儿小太阳 Vitamin D3 滴剂",
        brand: "Ostelin",
        dosageForm: "drops",
        unitName: "滴",
        defaultDose: 1.0,
        nutrients: {
          vitamin_d: { amount: 400, unit: "IU" },
        },
        isActive: true,
      },
    ];

    const rawSupp: GrowDeskSupplementRecord = {
      id: "sr-100",
      familyId: "fam-1",
      babyId: "baby-1",
      supplementName: "Ostelin 婴幼儿小太阳 Vitamin D3 滴剂",
      occurredAt: "2026-09-14T01:30:00.000Z", // 09:30 Shanghai
      amount: "1 滴",
      notes: "[productId:ostelin_vd3] 早餐后服用",
      version: "1",
      createdAt: "2026-09-14T01:30:00.000Z",
      updatedAt: "2026-09-14T01:30:00.000Z",
    };

    const enriched = fromGrowDeskSupplementRecordEnriched(rawSupp, testProducts);
    assert.equal(enriched.id, "sr-100");
    assert.equal(enriched.productId, "ostelin_vd3");
    assert.equal(enriched.dose, 1);
    assert.equal(enriched.unitName, "滴");
    assert.equal(enriched.date, "2026-09-14");
    assert.equal(enriched.time, "09:30");
    assert.equal(enriched.notes, "早餐后服用");
    assert.equal(enriched.product?.name, "Ostelin 婴幼儿小太阳 Vitamin D3 滴剂");
  });

  await t.test("6. Food Plan Supplement State Merging & Isolation", () => {
    const initialPlanData = {
      foodPlan: { name: "7月龄第一周辅食计划", tags: ["高铁米粉"] },
    };

    const merged1 = mergeSupplementStateIntoFoodPlan(initialPlanData, {
      defaultFormulaId: "f-formula-1",
      supplementProducts: [
        {
          id: "custom_supp_1",
          familyId: "fam-1",
          name: "自制益生菌滴剂",
          brand: "自研",
          dosageForm: "drops",
          unitName: "滴",
          defaultDose: 5,
          nutrients: {},
          isActive: true,
        },
      ],
    });

    const state1 = extractSupplementStateFromFoodPlan(merged1);
    assert.equal(state1.defaultFormulaId, "f-formula-1");
    assert.equal(state1.supplementProducts.length, 1);
    assert.equal(state1.supplementProducts[0].name, "自制益生菌滴剂");
    // Ensure original foodPlan key is untouched
    assert.deepEqual((merged1 as any).foodPlan, { name: "7月龄第一周辅食计划", tags: ["高铁米粉"] });

    // Update schedules without wiping products
    const merged2 = mergeSupplementStateIntoFoodPlan(merged1, {
      supplementSchedules: [
        {
          id: "sched-1",
          babyId: "baby-1",
          productId: "custom_supp_1",
          frequency: "daily",
          targetDose: 5,
          isActive: true,
        },
      ],
    });

    const state2 = extractSupplementStateFromFoodPlan(merged2);
    assert.equal(state2.supplementProducts.length, 1);
    assert.equal(state2.supplementSchedules.length, 1);
    assert.equal(state2.defaultFormulaId, "f-formula-1");
  });

  await t.test("7. Supplement Conflict Guard Detection", () => {
    const babyAgeMonths = 6;
    const testProduct: SupplementProduct = {
      id: "vd3",
      familyId: "fam-1",
      name: "D3 补剂",
      brand: "Brand",
      dosageForm: "drops",
      unitName: "滴",
      defaultDose: 1.0,
      nutrients: {
        vitamin_d: { amount: 800, unit: "IU" },
      },
      isActive: true,
    };

    const existingRecord: SupplementRecord = {
      id: "rec-1",
      babyId: "baby-1",
      productId: "vd3",
      product: testProduct,
      date: "2026-09-14",
      time: "08:00",
      dose: 1.0,
      unitName: "滴",
    };

    // Second check-in on the same day exceeds recommended/conflict threshold
    const conflict = checkSupplementConflict({
      babyAgeMonths,
      incomingSupplement: testProduct,
      incomingDose: 1.0,
      existingRecordsToday: [existingRecord],
      feedingsToday: [],
      formulaProductsMap: {},
      supplementProductsMap: { vd3: testProduct },
    });

    assert.equal(conflict.hasConflict, true);
    assert.ok(conflict.warnings.length > 0);
  });

  await t.test("8. Deterministic Nutrition Engine: Formula, Breastmilk, Food & Trends", () => {
    const today = "2026-09-14";
    const formulaProduct: FormulaProduct = {
      id: "f-aptamil",
      familyId: "fam-1",
      name: "Aptamil 1段",
      brand: "Aptamil",
      scoopWeightG: 4.6,
      waterPerScoopMl: 30.0,
      reconstitutionRatio: 0.138,
      servingSizeUnit: "per_100g",
      nutrients: {
        vitamin_d: { amount: 400, unit: "IU" },
        calcium: { amount: 400, unit: "mg" },
        iron: { amount: 4.0, unit: "mg" },
      },
      isActive: true,
      isDefault: true,
    };

    const suppProduct: SupplementProduct = {
      id: "s-d3",
      familyId: "fam-1",
      name: "Ostelin D3",
      brand: "Ostelin",
      dosageForm: "drops",
      unitName: "滴",
      defaultDose: 1.0,
      nutrients: {
        vitamin_d: { amount: 400, unit: "IU" },
      },
      isActive: true,
    };

    const feedings = [
      // 100ml formula
      {
        id: "feed-1",
        timestamp: `${today}T08:00:00.000Z`,
        type: "formula" as const,
        amountMl: 100,
        formulaProductId: "f-aptamil",
        spitUp: false,
      },
      // 20 mins breast (left 10, right 10) -> ~90ml
      {
        id: "feed-2",
        timestamp: `${today}T12:00:00.000Z`,
        type: "breast" as const,
        leftMinutes: 10,
        rightMinutes: 10,
        spitUp: false,
      },
      // Mixed feeding: 50ml formula + 10 mins breast -> no double counting!
      {
        id: "feed-3",
        timestamp: `${today}T16:00:00.000Z`,
        type: "mixed" as const,
        amountMl: 50,
        formulaProductId: "f-aptamil",
        leftMinutes: 5,
        rightMinutes: 5,
        spitUp: false,
      },
    ];

    const supplements = [
      {
        id: "supp-rec-1",
        babyId: "baby-1",
        productId: "s-d3",
        product: suppProduct,
        date: today,
        time: "09:00",
        dose: 1.0,
        unitName: "滴",
      },
    ];

    const foodLogs = [
      {
        id: "fl-1",
        date: today,
        time: "11:30",
        foods: ["高铁米粉", "苹果泥"],
        portion: "all",
        acceptance: 5,
        babyState: "happy",
      },
    ];

    const analysis = calculateDailyNutrition({
      date: today,
      babyAgeMonths: 6,
      feedings,
      supplements,
      foodLogs,
      formulaProductsMap: { "f-aptamil": formulaProduct },
      supplementProductsMap: { "s-d3": suppProduct },
    });

    assert.ok(analysis.totalFeedingMl > 200, `totalFeedingMl should be > 200, got ${analysis.totalFeedingMl}`);
    assert.equal(analysis.formulaMl, 150); // 100ml + 50ml
    assert.ok(analysis.breastMl > 100);
    assert.equal(analysis.supplementCount, 1);
    assert.equal(analysis.foodCount, 1);
    assert.ok(analysis.foodsTried.includes("高铁米粉"));

    // Vitamin D total = supplement (400 IU) + formula contribution (>0)
    assert.ok(analysis.coreMetrics.vitaminD.supplementAmount === 400);
    assert.ok(analysis.coreMetrics.vitaminD.formulaAmount > 0);
    assert.ok(analysis.coreMetrics.vitaminD.totalAmount > 400);

    // Multi-day summary trend
    const trendSummary = calculateMultiDayNutritionTrend({
      babyAgeMonths: 6,
      dailyDataList: [
        {
          date: today,
          feedings,
          supplements,
          foodLogs,
        },
      ],
      formulaProductsMap: { "f-aptamil": formulaProduct },
      supplementProductsMap: { "s-d3": suppProduct },
    });

    assert.equal(trendSummary.dailyTrends.length, 1);
    assert.equal(trendSummary.dailyTrends[0].date, today);
    assert.equal(trendSummary.dailyTrends[0].formulaMl, 150);
  });
});

test("canonical persisted formula metadata takes precedence over guessed presets", () => {
  const raw = { id: "test_formula_persisted", familyId: "test_family", brand: "test_brand", name: "test_formula", stage: "2", scoopGrams: "5", waterMlPerScoop: "30", reconstitutionRatio: "0.2", servingSizeUnit: "per_100ml", nutrientsJson: { energy: { amount: 73, unit: "kcal" } }, notes: "test_actual_notes", isActive: false, isDefault: true, isArchived: false, createdAt: "2026-09-19T00:00:00Z", updatedAt: "2026-09-19T00:00:00Z" };
  const product = fromGrowDeskFormulaProduct(raw);
  assert.deepEqual(product.nutrients, raw.nutrientsJson);
  assert.equal(product.reconstitutionRatio, 0.2);
  assert.equal(product.servingSizeUnit, "per_100ml");
  assert.equal(product.notes, raw.notes);
  assert.equal(product.isActive, false);
  assert.equal(product.isDefault, true);
  assert.deepEqual(fromGrowDeskFormulaProduct(raw, { customNutrients: {} }).nutrients, {}, "an explicitly empty nutrient override must stay empty");
  assert.throws(() => fromGrowDeskFormulaProduct({ ...raw, nutrientsJson: "invalid" }), /格式无效/);
});
