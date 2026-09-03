import assert from "node:assert/strict";
import test from "node:test";
import {
  convertVitaminDToIU,
  convertVitaminDToMcg,
  convertVitaminAToMcgRAE,
  calculateDryPowderGrams,
  getFormulaNutrientsForAmount,
  getSupplementNutrients,
  calculateDailyNutrition,
  checkSupplementConflict,
  calculateMultiDayNutritionTrend,
} from "./engine";
import { PRESET_FORMULA_PRODUCTS, PRESET_SUPPLEMENT_PRODUCTS } from "./presets";
import { getDRIForAge, getAgeGroup } from "./dris";
import { getBreastMilkNutrientsForVolume, estimateNursingVolumeMl } from "./breastmilk";
import type { FormulaProduct, SupplementProduct, SupplementRecord } from "@/types/nutrition";
import type { FeedingRecord } from "@/types";

test("DRIs: should match correct age groups and standards", () => {
  assert.equal(getAgeGroup(3), "0-6m");
  assert.equal(getAgeGroup(8), "6-12m");
  assert.equal(getAgeGroup(18), "1-3y");

  const dri0_6 = getDRIForAge(4);
  assert.equal(dri0_6.nutrients.vitamin_d.ai, 400);
  assert.equal(dri0_6.nutrients.vitamin_d.ul, 800);
  assert.equal(dri0_6.nutrients.calcium.ai, 200);
  assert.equal(dri0_6.nutrients.iron.ai, 0.3);

  const dri6_12 = getDRIForAge(9);
  assert.equal(dri6_12.nutrients.iron.rni, 10);
  assert.equal(dri6_12.nutrients.zinc.rni, 3.5);
  assert.equal(dri6_12.nutrients.calcium.ai, 250);

  const dri1_3 = getDRIForAge(24);
  assert.equal(dri1_3.nutrients.calcium.rni, 600);
  assert.equal(dri1_3.nutrients.vitamin_d.ul, 1600);
});

test("Unit Conversions: Vit D and Vit A units", () => {
  // Vit D: 10 mcg = 400 IU
  assert.equal(convertVitaminDToIU(10, "mcg"), 400);
  assert.equal(convertVitaminDToIU(10, "μg"), 400);
  assert.equal(convertVitaminDToIU(400, "IU"), 400);
  assert.equal(convertVitaminDToMcg(400, "IU"), 10);

  // Vit A: 1000 IU = 300 mcg RAE
  assert.equal(convertVitaminAToMcgRAE(1000, "IU"), 300);
  assert.equal(convertVitaminAToMcgRAE(450, "mcg RAE"), 450);
});

test("Formula: Dry powder grams calculation", () => {
  const aptamil1: FormulaProduct = {
    id: "f1",
    familyId: "fam1",
    name: "爱他美1段",
    brand: "爱他美",
    scoopWeightG: 4.3,
    waterPerScoopMl: 30.0,
    reconstitutionRatio: 0.135,
    servingSizeUnit: "per_100g",
    isActive: true,
    nutrients: {
      vitamin_d: { amount: 380, unit: "IU" },
      calcium: { amount: 340, unit: "mg" },
      iron: { amount: 5.2, unit: "mg" },
    },
  };

  // 120ml milk with 0.135 ratio = 16.2g dry powder
  const powderGrams = calculateDryPowderGrams(120, aptamil1);
  assert.equal(powderGrams, 16.2);

  // Nutrients for 120ml
  const nutrients = getFormulaNutrientsForAmount(120, aptamil1);
  // Vit D: 380 * 16.2 / 100 = 61.56 IU
  assert.ok(Math.abs((nutrients.vitamin_d?.amount || 0) - 61.56) < 0.1);
  // Calcium: 340 * 16.2 / 100 = 55.08 mg
  assert.ok(Math.abs((nutrients.calcium?.amount || 0) - 55.08) < 0.1);
});

test("Breastmilk: reference nutrients and nursing volume estimation", () => {
  const bm100 = getBreastMilkNutrientsForVolume(100);
  assert.equal(bm100.energy_kcal.amount, 67);
  assert.equal(bm100.calcium.amount, 30);
  assert.equal(bm100.protein.amount, 1.1);
  assert.equal(bm100.vitamin_d.amount, 10); // Native breastmilk Vit D is only 10 IU

  // Nursing 15 min left + 15 min right = 30 min -> ~115ml
  const estimated = estimateNursingVolumeMl(15, 15);
  assert.ok(estimated >= 90 && estimated <= 130, `expected estimated volume ~115ml, got ${estimated}`);
});

test("Supplements: Compound formulation multi-nutrient penetration", () => {
  // Ostelin Liquid Calcium has Calcium 100mg + Vit D3 200 IU + Vit K2 5mcg per 1ml
  const ostelin: SupplementProduct = {
    id: "s1",
    familyId: "fam1",
    name: "Ostelin 婴幼儿液体乳钙",
    brand: "Ostelin",
    dosageForm: "liquid_ml",
    unitName: "ml",
    defaultDose: 1.0,
    isActive: true,
    nutrients: {
      calcium: { amount: 100, unit: "mg" },
      vitamin_d: { amount: 200, unit: "IU" },
      vitamin_k: { amount: 5, unit: "mcg" },
    },
  };

  const parsed = getSupplementNutrients(ostelin, 1.5); // 1.5 ml dose
  assert.equal(parsed.calcium.amount, 150);
  assert.equal(parsed.vitamin_d.amount, 300);
  assert.equal(parsed.vitamin_k.amount, 7.5);
});

test("Engine: Combined daily multi-source accumulation (Formula + Breastmilk + Supplement)", () => {
  const formulaProduct: FormulaProduct = {
    id: "f_aptamil",
    familyId: "fam1",
    name: "爱他美卓萃 1段",
    brand: "爱他美",
    scoopWeightG: 4.3,
    waterPerScoopMl: 30.0,
    reconstitutionRatio: 0.135,
    servingSizeUnit: "per_100g",
    isActive: true,
    nutrients: {
      energy_kcal: { amount: 485, unit: "kcal" },
      protein: { amount: 9.8, unit: "g" },
      vitamin_d: { amount: 380, unit: "IU" },
      calcium: { amount: 340, unit: "mg" },
      iron: { amount: 5.2, unit: "mg" },
    },
  };

  const d3Supplement: SupplementProduct = {
    id: "s_d3",
    familyId: "fam1",
    name: "星鲨 维生素D3",
    brand: "星鲨",
    dosageForm: "capsule",
    unitName: "粒",
    defaultDose: 1.0,
    isActive: true,
    nutrients: {
      vitamin_d: { amount: 400, unit: "IU" },
    },
  };

  const feedings: FeedingRecord[] = [
    {
      id: "feed_1",
      timestamp: "2026-08-31T08:00:00.000Z",
      type: "formula",
      amountMl: 400, // 400ml * 0.135 = 54g powder -> Vit D: 380 * 0.54 = 205.2 IU, Calcium: 340 * 0.54 = 183.6 mg
      spitUp: false,
      formulaProductId: "f_aptamil",
    },
    {
      id: "feed_2",
      timestamp: "2026-08-31T14:00:00.000Z",
      type: "bottle_breast",
      amountMl: 200, // 200ml BM -> Vit D: 20 IU, Calcium: 60 mg, Protein: 2.2g
      spitUp: false,
    },
  ];

  const supplements: SupplementRecord[] = [
    {
      id: "supp_1",
      babyId: "baby1",
      productId: "s_d3",
      date: "2026-08-31",
      time: "09:00",
      dose: 1.0, // 400 IU Vit D
    },
  ];

  const analysis = calculateDailyNutrition({
    date: "2026-08-31",
    babyAgeMonths: 4,
    feedings,
    supplements,
    formulaProductsMap: { [formulaProduct.id]: formulaProduct },
    supplementProductsMap: { [d3Supplement.id]: d3Supplement },
  });

  assert.equal(analysis.totalFeedingMl, 600);
  assert.equal(analysis.formulaMl, 400);
  assert.equal(analysis.breastMl, 200);
  assert.equal(analysis.supplementCount, 1);

  // Vit D: Formula (205.2) + BM (20) + Supplement (400) = 625.2 IU
  const vitD = analysis.coreMetrics.vitaminD;
  assert.ok(Math.abs(vitD.totalAmount - 625.2) < 1.0, `Vit D expected ~625.2, got ${vitD.totalAmount}`);
  assert.equal(vitD.sources.length, 3);
  assert.equal(vitD.isOverLimit, false); // 0-6m UL is 800 IU, 625.2 is safe

  // Calcium: Formula (183.6) + BM (60) = 243.6 mg
  const calcium = analysis.coreMetrics.calcium;
  assert.ok(Math.abs(calcium.totalAmount - 243.6) < 1.0);
  assert.ok((calcium.achievementRate || 0) >= 100); // 0-6m AI is 200mg
});

test("Conflict Guard: Overdose alert when Vit D exceeds UL", () => {
  const d3Product: SupplementProduct = {
    id: "s_d3",
    familyId: "fam1",
    name: "星鲨 维生素D3",
    brand: "星鲨",
    dosageForm: "capsule",
    unitName: "粒",
    defaultDose: 1.0,
    isActive: true,
    nutrients: {
      vitamin_d: { amount: 400, unit: "IU" },
    },
  };

  const adProduct: SupplementProduct = {
    id: "s_ad",
    familyId: "fam1",
    name: "伊可新 维生素AD",
    brand: "伊可新",
    dosageForm: "capsule",
    unitName: "粒",
    defaultDose: 1.0,
    isActive: true,
    nutrients: {
      vitamin_a: { amount: 450, unit: "mcg RAE" },
      vitamin_d: { amount: 500, unit: "IU" },
    },
  };

  // Baby has already taken AD (500 IU) and 600ml formula (300 IU) -> Total current = 800 IU
  const existingSupplements: SupplementRecord[] = [
    {
      id: "rec_ad",
      babyId: "baby1",
      productId: "s_ad",
      date: "2026-08-31",
      time: "08:00",
      dose: 1.0,
      product: adProduct,
    },
  ];

  // Now caregiver tries to give 星鲨 D3 (400 IU) on top of AD -> Projected Vit D = 900+ IU > 800 IU UL
  const conflict = checkSupplementConflict({
    babyAgeMonths: 5,
    incomingSupplement: d3Product,
    incomingDose: 1.0,
    existingRecordsToday: existingSupplements,
    supplementProductsMap: { [d3Product.id]: d3Product, [adProduct.id]: adProduct },
  });

  assert.equal(conflict.hasConflict, true);
  assert.ok(conflict.warnings.some((w) => w.includes("重复摄入") || w.includes("过量拦截")));
  const vitDDetail = conflict.details.find((d) => d.nutrientId === "vitamin_d");
  assert.ok(vitDDetail);
  assert.equal(vitDDetail?.isExceeded, true);
});

test("Multi-day trend calculation: 7-day average and trends", () => {
  const d3Product: SupplementProduct = {
    id: "s_d3",
    familyId: "fam1",
    name: "Ddrops D3",
    brand: "Ddrops",
    dosageForm: "drops",
    unitName: "滴",
    defaultDose: 1.0,
    isActive: true,
    nutrients: {
      vitamin_d: { amount: 400, unit: "IU" },
    },
  };

  const dailyDataList = [
    {
      date: "2026-08-25",
      feedings: [{ id: "1", timestamp: "2026-08-25T08:00:00Z", type: "formula" as const, amountMl: 700, spitUp: false }],
      supplements: [{ id: "s1", babyId: "b1", productId: "s_d3", date: "2026-08-25", time: "09:00", dose: 1.0 }],
    },
    {
      date: "2026-08-26",
      feedings: [{ id: "2", timestamp: "2026-08-26T08:00:00Z", type: "formula" as const, amountMl: 750, spitUp: false }],
      supplements: [{ id: "s2", babyId: "b1", productId: "s_d3", date: "2026-08-26", time: "09:00", dose: 1.0 }],
    },
  ];

  const summary = calculateMultiDayNutritionTrend({
    babyAgeMonths: 5,
    dailyDataList,
    supplementProductsMap: { [d3Product.id]: d3Product },
  });

  assert.equal(summary.daysCount, 2);
  assert.equal(summary.dailyTrends.length, 2);
  assert.ok(summary.averageIntakes.vitamin_d.averageAmount > 400);
});

test("Formula Selection: honors specific product even if archived, and falls back to default active formula when null", () => {
  const archivedFormula1: FormulaProduct = {
    id: "f_archived_1",
    familyId: "fam1",
    name: "老版爱他美1段(已归档)",
    brand: "爱他美",
    scoopWeightG: 4.3,
    waterPerScoopMl: 30.0,
    reconstitutionRatio: 0.135,
    servingSizeUnit: "per_100g",
    isActive: false, // 已归档
    isDefault: false,
    nutrients: {
      protein: { amount: 10.0, unit: "g" },
      calcium: { amount: 300, unit: "mg" },
    },
  };

  const activeDefaultFormula: FormulaProduct = {
    id: "f_active_default_2",
    familyId: "fam1",
    name: "新版爱他美2段(主力)",
    brand: "爱他美",
    scoopWeightG: 4.5,
    waterPerScoopMl: 30.0,
    reconstitutionRatio: 0.145,
    servingSizeUnit: "per_100g",
    isActive: true,
    isDefault: true, // 主力默认
    nutrients: {
      protein: { amount: 15.0, unit: "g" },
      calcium: { amount: 600, unit: "mg" },
    },
  };

  const formulaMap: Record<string, FormulaProduct> = {
    // 故意让归档的放在最前面，测试系统是否会盲选 [0]
    [archivedFormula1.id]: archivedFormula1,
    [activeDefaultFormula.id]: activeDefaultFormula,
  };

  // Case A: 历史记录显式关联了归档奶粉 -> 必须依然准确使用归档奶粉的配方，历史数据不被篡改
  const resHistorical = calculateDailyNutrition({
    date: "2026-05-01",
    babyAgeMonths: 3,
    feedings: [
      { id: "feed_old", timestamp: "2026-05-01T08:00:00Z", type: "formula", amountMl: 200, formulaProductId: "f_archived_1", spitUp: false },
    ],
    supplements: [],
    formulaProductsMap: formulaMap,
  });
  // 200ml * 0.135 = 27g dry powder. 27g * (10g / 100g) = 2.7g protein.
  assert.equal(resHistorical.coreMetrics.protein?.formulaAmount, 2.7);

  // Case B: 未指定奶粉的记录 (null) -> 必须精准兜底到 active & default 的新版2段，而不是盲选 [0] 的归档1段！
  const resUnassigned = calculateDailyNutrition({
    date: "2026-09-01",
    babyAgeMonths: 7,
    feedings: [
      { id: "feed_new", timestamp: "2026-09-01T08:00:00Z", type: "formula", amountMl: 200, formulaProductId: null, spitUp: false },
    ],
    supplements: [],
    formulaProductsMap: formulaMap,
  });
  // 200ml * 0.145 = 29g dry powder. 29g * (15g / 100g) = 4.35g protein.
  assert.equal(resUnassigned.coreMetrics.protein?.formulaAmount, 4.35);
  // 来源列表中明确标明来源是主力奶粉
  assert.ok(resUnassigned.coreMetrics.protein?.sources.some((s) => s.sourceId === "f_active_default_2"));
});
