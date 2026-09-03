import type {
  DailyNutritionAnalysis,
  NutrientIntakeItem,
  NutrientSourceContribution,
  ConflictCheckResult,
  MultiDayNutritionSummary,
  MultiDayTrendItem,
  FormulaProduct,
  SupplementProduct,
  SupplementRecord,
  NutrientsMap,
  AgeGroup,
} from "@/types/nutrition";
import type { FeedingRecord } from "@/types";
import { getAgeGroup, getDRIForAge, getNutrientDefinition, ALL_NUTRIENT_IDS, CORE_NUTRIENT_IDS, NUTRIENT_NAMES_CN } from "./dris";
import { getBreastMilkNutrientsForVolume, estimateNursingVolumeMl } from "./breastmilk";
import { PRESET_FORMULA_PRODUCTS, PRESET_SUPPLEMENT_PRODUCTS } from "./presets";

/**
 * 营养素单位标准化与转换工具
 */
export function convertVitaminDToIU(val: number, unit: string): number {
  if (!val || !Number.isFinite(val) || val <= 0) return 0;
  const u = (unit || "").toLowerCase().trim();
  if (u === "mcg" || u === "μg" || u === "ug" || u === "微克") {
    return Number((val * 40).toFixed(2));
  }
  return Number(val.toFixed(2));
}

export function convertVitaminDToMcg(val: number, unit: string): number {
  if (!val || !Number.isFinite(val) || val <= 0) return 0;
  const u = (unit || "").toLowerCase().trim();
  if (u === "iu" || u === "单位") {
    return Number((val / 40).toFixed(2));
  }
  return Number(val.toFixed(2));
}

export function convertVitaminAToMcgRAE(val: number, unit: string): number {
  if (!val || !Number.isFinite(val) || val <= 0) return 0;
  const u = (unit || "").toLowerCase().trim();
  if (u === "iu" || u === "单位") {
    return Number((val * 0.3).toFixed(2));
  }
  return Number(val.toFixed(2));
}

/**
 * 确定配方奶干粉克重折算
 * 标准冲调比例：干粉克重 / (加水量 + 粉体积) ≈ 13.5% (或每30ml水加4.3g奶粉)
 */
export function calculateDryPowderGrams(amountMl: number, formulaProduct?: FormulaProduct | null): number {
  if (!amountMl || amountMl <= 0 || !Number.isFinite(amountMl)) return 0;
  if (formulaProduct) {
    if (
      formulaProduct.reconstitutionRatio &&
      formulaProduct.reconstitutionRatio > 0 &&
      Number.isFinite(formulaProduct.reconstitutionRatio)
    ) {
      return Number((amountMl * formulaProduct.reconstitutionRatio).toFixed(2));
    }
    if (
      formulaProduct.scoopWeightG &&
      formulaProduct.waterPerScoopMl &&
      formulaProduct.waterPerScoopMl > 0 &&
      formulaProduct.scoopWeightG > 0 &&
      Number.isFinite(formulaProduct.scoopWeightG) &&
      Number.isFinite(formulaProduct.waterPerScoopMl)
    ) {
      return Number(((amountMl / formulaProduct.waterPerScoopMl) * formulaProduct.scoopWeightG).toFixed(2));
    }
  }
  // 默认标准浓度：13.5% (0.135 g/ml)
  return Number((amountMl * 0.135).toFixed(2));
}

/**
 * 解析配方奶粉中的全量营养素（按干粉克重）
 */
export function getFormulaNutrientsForAmount(amountMl: number, formulaProduct?: FormulaProduct | null): NutrientsMap {
  if (amountMl <= 0) return {};
  const powderGrams = calculateDryPowderGrams(amountMl, formulaProduct);
  const nutrientsSource = formulaProduct?.nutrients || (PRESET_FORMULA_PRODUCTS[0]?.nutrients as NutrientsMap);
  if (!nutrientsSource) return {};

  const factor = powderGrams / 100; // 成分表通常基于 100g 干粉
  const result: NutrientsMap = {};

  for (const [key, val] of Object.entries(nutrientsSource)) {
    if (!val || typeof val.amount !== "number") continue;
    let convertedAmount = val.amount * factor;
    let unit = val.unit;

    if (key === "vitamin_d") {
      convertedAmount = convertVitaminDToIU(convertedAmount, unit);
      unit = "IU";
    } else if (key === "vitamin_a") {
      convertedAmount = convertVitaminAToMcgRAE(convertedAmount, unit);
      unit = "mcg RAE";
    }

    result[key] = {
      amount: Number(convertedAmount.toFixed(3)),
      unit,
    };
  }

  return result;
}

/**
 * 解析补剂单次摄入营养素（穿透复合补剂的多营养素）
 */
export function getSupplementNutrients(supplementProduct: SupplementProduct, dose: number = 1.0): NutrientsMap {
  if (!supplementProduct || !supplementProduct.nutrients || dose <= 0) return {};
  const result: NutrientsMap = {};

  for (const [key, val] of Object.entries(supplementProduct.nutrients)) {
    if (!val || typeof val.amount !== "number") continue;
    let convertedAmount = val.amount * dose;
    let unit = val.unit;

    if (key === "vitamin_d") {
      convertedAmount = convertVitaminDToIU(convertedAmount, unit);
      unit = "IU";
    } else if (key === "vitamin_a") {
      convertedAmount = convertVitaminAToMcgRAE(convertedAmount, unit);
      unit = "mcg RAE";
    }

    result[key] = {
      amount: Number(convertedAmount.toFixed(3)),
      unit,
    };
  }

  return result;
}

export interface EngineInput {
  date: string;
  babyAgeMonths: number;
  feedings: FeedingRecord[];
  supplements: SupplementRecord[];
  formulaProductsMap?: Record<string, FormulaProduct>;
  supplementProductsMap?: Record<string, SupplementProduct>;
}

/**
 * 确定性单日全量营养素摄入汇总与 DRIs 对比分析
 */
export function calculateDailyNutrition(input: EngineInput): DailyNutritionAnalysis {
  const { date, babyAgeMonths, feedings = [], supplements = [], formulaProductsMap = {}, supplementProductsMap = {} } = input;
  const ageGroup = getAgeGroup(babyAgeMonths);
  const dri = getDRIForAge(babyAgeMonths);

  let formulaMl = 0;
  let breastMl = 0;

  // 记录各营养素的多源累加
  const intakeAggregates: Record<
    string,
    {
      formula: number;
      supplement: number;
      breastmilk: number;
      food: number;
      sources: NutrientSourceContribution[];
    }
  > = {};

  const ensureNutrientSlot = (id: string) => {
    if (!intakeAggregates[id]) {
      intakeAggregates[id] = { formula: 0, supplement: 0, breastmilk: 0, food: 0, sources: [] };
    }
  };

  // 找出当前主力/默认奶粉（用于历史未指定奶粉记录的精准兜底，避免盲选 [0]）
  const allFormulaProducts = Object.values(formulaProductsMap);
  const defaultFormulaProduct =
    allFormulaProducts.find((p) => p.isActive && p.isDefault) ||
    allFormulaProducts.find((p) => p.isActive) ||
    allFormulaProducts[0] ||
    null;

  // 1. 处理喂养记录 (Formula & Breastmilk)
  for (const feeding of feedings) {
    if (feeding.type === "formula") {
      const ml = feeding.amountMl || 0;
      formulaMl += ml;
      const product = feeding.formulaProductId
        ? formulaProductsMap[feeding.formulaProductId] || defaultFormulaProduct
        : defaultFormulaProduct;
      const formulaNutrients = getFormulaNutrientsForAmount(ml, product);
      const productName = product ? product.name : "配方奶粉";

      for (const [nId, val] of Object.entries(formulaNutrients)) {
        ensureNutrientSlot(nId);
        intakeAggregates[nId].formula += val.amount;
        intakeAggregates[nId].sources.push({
          sourceId: product?.id || "formula_default",
          sourceName: `${productName} (${ml}ml)`,
          sourceType: "formula",
          amount: val.amount,
          unit: val.unit,
        });
      }
    } else if (feeding.type === "bottle_breast") {
      const ml = feeding.amountMl || 0;
      breastMl += ml;
      const bmNutrients = getBreastMilkNutrientsForVolume(ml);

      for (const [nId, val] of Object.entries(bmNutrients)) {
        ensureNutrientSlot(nId);
        intakeAggregates[nId].breastmilk += val.amount;
        intakeAggregates[nId].sources.push({
          sourceId: "breastmilk_bottle",
          sourceName: `瓶喂母乳 (${ml}ml)`,
          sourceType: "breastmilk",
          amount: val.amount,
          unit: val.unit,
        });
      }
    } else if (feeding.type === "breast") {
      const left = feeding.leftMinutes || 0;
      const right = feeding.rightMinutes || 0;
      const estimatedMl = feeding.amountMl || estimateNursingVolumeMl(left, right);
      breastMl += estimatedMl;
      const bmNutrients = getBreastMilkNutrientsForVolume(estimatedMl);

      for (const [nId, val] of Object.entries(bmNutrients)) {
        ensureNutrientSlot(nId);
        intakeAggregates[nId].breastmilk += val.amount;
        intakeAggregates[nId].sources.push({
          sourceId: "breastmilk_direct",
          sourceName: `母乳亲喂 (估约${estimatedMl}ml)`,
          sourceType: "breastmilk",
          amount: val.amount,
          unit: val.unit,
        });
      }
    } else if (feeding.type === "mixed") {
      // 混合喂养：按记录的 formula 奶量 + 亲喂时长
      const ml = feeding.amountMl || 0;
      formulaMl += ml;
      const product = feeding.formulaProductId
        ? formulaProductsMap[feeding.formulaProductId] || defaultFormulaProduct
        : defaultFormulaProduct;
      const formulaNutrients = getFormulaNutrientsForAmount(ml, product);

      for (const [nId, val] of Object.entries(formulaNutrients)) {
        ensureNutrientSlot(nId);
        intakeAggregates[nId].formula += val.amount;
        intakeAggregates[nId].sources.push({
          sourceId: product?.id || "formula_mixed",
          sourceName: `${product?.name || "混合配方奶"} (${ml}ml)`,
          sourceType: "formula",
          amount: val.amount,
          unit: val.unit,
        });
      }

      const left = feeding.leftMinutes || 0;
      const right = feeding.rightMinutes || 0;
      const nursingMl = estimateNursingVolumeMl(left, right);
      breastMl += nursingMl;
      const bmNutrients = getBreastMilkNutrientsForVolume(nursingMl);

      for (const [nId, val] of Object.entries(bmNutrients)) {
        ensureNutrientSlot(nId);
        intakeAggregates[nId].breastmilk += val.amount;
        intakeAggregates[nId].sources.push({
          sourceId: "breastmilk_mixed",
          sourceName: `混合亲喂 (估约${nursingMl}ml)`,
          sourceType: "breastmilk",
          amount: val.amount,
          unit: val.unit,
        });
      }
    }
  }

  // 2. 处理补剂打卡记录 (Supplements - 复合穿透)
  for (const suppRecord of supplements) {
    let product = supplementProductsMap[suppRecord.productId];
    if (!product) {
      // 从预置库按名称或ID匹配 fallback
      const found = PRESET_SUPPLEMENT_PRODUCTS.find((p) => p.name === (suppRecord as any).product?.name);
      if (found) {
        product = { ...found, id: suppRecord.productId, familyId: "" };
      }
    }
    if (!product && (suppRecord as any).product) {
      product = (suppRecord as any).product;
    }

    if (product) {
      const dose = suppRecord.dose || 1.0;
      const suppNutrients = getSupplementNutrients(product, dose);

      for (const [nId, val] of Object.entries(suppNutrients)) {
        ensureNutrientSlot(nId);
        intakeAggregates[nId].supplement += val.amount;
        intakeAggregates[nId].sources.push({
          sourceId: product.id || suppRecord.productId,
          sourceName: `${product.name} (${dose}${suppRecord.unitName || product.unitName || "剂"})`,
          sourceType: "supplement",
          amount: val.amount,
          unit: val.unit,
        });
      }
    }
  }

  // 3. 构建所有营养素的明细与达标计算
  const allNutrientsMap: Record<string, NutrientIntakeItem> = {};
  const alerts: DailyNutritionAnalysis["alerts"] = [];

  for (const nId of ALL_NUTRIENT_IDS) {
    const def = getNutrientDefinition(nId, babyAgeMonths);
    if (!def) continue;

    const data = intakeAggregates[nId] || { formula: 0, supplement: 0, breastmilk: 0, food: 0, sources: [] };
    const totalAmount = Number((data.formula + data.supplement + data.breastmilk + data.food).toFixed(2));
    const targetAmount = def.rni ?? def.ai;
    const targetType = def.rni ? "RNI" : def.ai ? "AI" : undefined;
    const achievementRate = targetAmount && targetAmount > 0 ? Number(((totalAmount / targetAmount) * 100).toFixed(1)) : undefined;

    const ul = def.ul;
    const isOverLimit = !!(ul && ul > 0 && totalAmount > ul);
    const isNearLimit = !!(ul && ul > 0 && totalAmount >= ul * 0.85 && totalAmount <= ul);

    const item: NutrientIntakeItem = {
      nutrientId: nId,
      name: def.name,
      unit: def.unit,
      category: def.category,
      formulaAmount: Number(data.formula.toFixed(2)),
      supplementAmount: Number(data.supplement.toFixed(2)),
      breastmilkAmount: Number(data.breastmilk.toFixed(2)),
      foodAmount: Number(data.food.toFixed(2)),
      totalAmount,
      targetAmount,
      targetType,
      achievementRate,
      ul,
      isOverLimit,
      isNearLimit,
      sources: data.sources,
    };

    allNutrientsMap[nId] = item;

    // 警示触发逻辑
    if (isOverLimit) {
      alerts.push({
        type: "danger",
        nutrientId: nId,
        title: `${def.name} 超过安全耐受上限 (UL)`,
        message: `今日 ${def.name} 累计摄入 ${totalAmount} ${def.unit}，超过中国居民膳食安全上限 ${ul} ${def.unit}。请注意避免长期过量蓄积！`,
      });
    } else if (isNearLimit) {
      alerts.push({
        type: "warning",
        nutrientId: nId,
        title: `${def.name} 接近安全上限`,
        message: `今日 ${def.name} 累计摄入 ${totalAmount} ${def.unit}，已达到安全上限 (${ul} ${def.unit}) 的 85% 以上，请勿重复补给。`,
      });
    }
  }

  // 4. 专属儿科常规警示 (维生素D摄入不足提示)
  const vitD = allNutrientsMap["vitamin_d"];
  if (vitD && vitD.totalAmount < 200 && breastMl > 0) {
    alerts.push({
      type: "info",
      nutrientId: "vitamin_d",
      title: "维生素D 今日未充分补充",
      message: "母乳中天然维生素D含量极低，儿科指南推荐每日补充 400 IU 维生素D3，以预防佝偻病与促进钙吸收。",
    });
  }

  // 5. 核心指标聚合
  const coreMetrics = {
    vitaminD: allNutrientsMap["vitamin_d"] || createEmptyNutrientItem("vitamin_d", "维生素D", "IU", "vitamin"),
    vitaminA: allNutrientsMap["vitamin_a"],
    calcium: allNutrientsMap["calcium"] || createEmptyNutrientItem("calcium", "钙", "mg", "mineral"),
    iron: allNutrientsMap["iron"] || createEmptyNutrientItem("iron", "铁", "mg", "mineral"),
    zinc: allNutrientsMap["zinc"],
    dha: allNutrientsMap["dha"],
    energy: allNutrientsMap["energy_kcal"],
    protein: allNutrientsMap["protein"],
  };

  const allNutrientsList = Object.values(allNutrientsMap).sort((a, b) => {
    // 核心指标优先排在前面
    const aCore = CORE_NUTRIENT_IDS.indexOf(a.nutrientId);
    const bCore = CORE_NUTRIENT_IDS.indexOf(b.nutrientId);
    if (aCore !== -1 && bCore !== -1) return aCore - bCore;
    if (aCore !== -1) return -1;
    if (bCore !== -1) return 1;
    return 0;
  });

  return {
    date,
    babyAgeMonths,
    ageGroup,
    totalFeedingMl: formulaMl + breastMl,
    formulaMl,
    breastMl,
    supplementCount: supplements.length,
    coreMetrics,
    allNutrients: allNutrientsList,
    alerts,
  };
}

function createEmptyNutrientItem(
  id: string,
  name: string,
  unit: string,
  category: "macro" | "vitamin" | "mineral" | "fatty_acid" | "other"
): NutrientIntakeItem {
  return {
    nutrientId: id,
    name,
    unit,
    category,
    formulaAmount: 0,
    supplementAmount: 0,
    breastmilkAmount: 0,
    foodAmount: 0,
    totalAmount: 0,
    isOverLimit: false,
    isNearLimit: false,
    sources: [],
  };
}

/**
 * 补剂冲突与过量前置拦截检测 (Conflict Guard)
 * 当家长准备打卡一项补剂时，预先计算叠加该补剂后是否会导致：
 * 1. 维生素D / 维生素A 严重超标 (超过 UL)
 * 2. 同类成分重复打卡 (例如今日已服用伊可新AD，又准备打卡星鲨D3，或同日服用含D3的液体钙造成D3叠加)
 */
export function checkSupplementConflict(params: {
  babyAgeMonths: number;
  incomingSupplement: SupplementProduct;
  incomingDose?: number;
  existingRecordsToday: SupplementRecord[];
  feedingsToday?: FeedingRecord[];
  formulaProductsMap?: Record<string, FormulaProduct>;
  supplementProductsMap?: Record<string, SupplementProduct>;
}): ConflictCheckResult {
  const {
    babyAgeMonths,
    incomingSupplement,
    incomingDose = 1.0,
    existingRecordsToday = [],
    feedingsToday = [],
    formulaProductsMap = {},
    supplementProductsMap = {},
  } = params;

  // 1. 先计算当前的日摄入现状
  const currentAnalysis = calculateDailyNutrition({
    date: "today",
    babyAgeMonths,
    feedings: feedingsToday,
    supplements: existingRecordsToday,
    formulaProductsMap,
    supplementProductsMap,
  });

  // 2. 计算将要打卡的补剂营养素
  const incomingNutrients = getSupplementNutrients(incomingSupplement, incomingDose);

  const warnings: string[] = [];
  const details: ConflictCheckResult["details"] = [];
  let hasConflict = false;

  // 3. 检查是否有同类重叠品类记录
  const isIncomingD3 = !!incomingNutrients["vitamin_d"] && incomingNutrients["vitamin_d"].amount >= 200;
  const isIncomingAD = !!incomingNutrients["vitamin_a"] && !!incomingNutrients["vitamin_d"];

  for (const existing of existingRecordsToday) {
    const exProduct = supplementProductsMap[existing.productId] || (existing as any).product;
    if (!exProduct) continue;
    const exNutrients = getSupplementNutrients(exProduct, existing.dose);

    // AD + D3 重复服用检测
    const isExAD = !!exNutrients["vitamin_a"] && !!exNutrients["vitamin_d"];
    const isExD3 = !!exNutrients["vitamin_d"] && !exNutrients["vitamin_a"] && exNutrients["vitamin_d"].amount >= 200;

    if (isIncomingAD && isExD3) {
      hasConflict = true;
      warnings.push(`今日已打卡「${exProduct.name}」(含维D)，再次服用「${incomingSupplement.name}」(AD复合制剂) 会导致维生素D重复摄入！`);
    } else if (isIncomingD3 && isExAD) {
      hasConflict = true;
      warnings.push(`今日已打卡「${exProduct.name}」(AD复合)，再次服用「${incomingSupplement.name}」会导致维生素D重复补充！建议遵循隔天轮换或单选其一。`);
    } else if (exProduct.id === incomingSupplement.id) {
      warnings.push(`今日已打卡过「${exProduct.name}」，请确认是否为同一天多次遵医嘱用药。`);
    }
  }

  // 4. 原子级营养素叠加与 UL 判定
  for (const [nId, inVal] of Object.entries(incomingNutrients)) {
    const currentItem = currentAnalysis.allNutrients.find((n) => n.nutrientId === nId);
    const currentTotal = currentItem ? currentItem.totalAmount : 0;
    const projectedTotal = Number((currentTotal + inVal.amount).toFixed(2));
    const def = getNutrientDefinition(nId, babyAgeMonths);
    const ul = def?.ul;
    const isExceeded = !!(ul && ul > 0 && projectedTotal > ul);

    if (isExceeded) {
      hasConflict = true;
      warnings.push(`【过量拦截】叠加后 ${def?.name || nId} 预计达到 ${projectedTotal} ${inVal.unit}，已超过安全上限 (UL: ${ul} ${inVal.unit})！`);
    }

    details.push({
      nutrientId: nId,
      nutrientName: def?.name || nId,
      currentTotal,
      incomingAmount: inVal.amount,
      projectedTotal,
      ul,
      unit: inVal.unit,
      isExceeded,
    });
  }

  return {
    hasConflict,
    warnings,
    details,
  };
}

/**
 * 7天 / 30天 周期趋势统计
 */
export function calculateMultiDayNutritionTrend(params: {
  babyAgeMonths: number;
  dailyDataList: Array<{
    date: string;
    feedings: FeedingRecord[];
    supplements: SupplementRecord[];
  }>;
  formulaProductsMap?: Record<string, FormulaProduct>;
  supplementProductsMap?: Record<string, SupplementProduct>;
}): MultiDayNutritionSummary {
  const { babyAgeMonths, dailyDataList = [], formulaProductsMap = {}, supplementProductsMap = {} } = params;
  if (dailyDataList.length === 0) {
    return {
      startDate: "",
      endDate: "",
      daysCount: 0,
      dailyTrends: [],
      averageIntakes: {},
    };
  }

  const dailyTrends: MultiDayTrendItem[] = [];
  const nutrientTotals: Record<string, { total: number; unit: string; name: string }> = {};

  for (const day of dailyDataList) {
    const analysis = calculateDailyNutrition({
      date: day.date,
      babyAgeMonths,
      feedings: day.feedings,
      supplements: day.supplements,
      formulaProductsMap,
      supplementProductsMap,
    });

    const vitD = analysis.coreMetrics.vitaminD?.totalAmount || 0;
    const vitA = analysis.coreMetrics.vitaminA?.totalAmount;
    const calcium = analysis.coreMetrics.calcium?.totalAmount || 0;
    const iron = analysis.coreMetrics.iron?.totalAmount || 0;
    const zinc = analysis.coreMetrics.zinc?.totalAmount;
    const dha = analysis.coreMetrics.dha?.totalAmount;

    dailyTrends.push({
      date: day.date,
      formulaMl: analysis.formulaMl,
      breastMl: analysis.breastMl,
      totalFeedingMl: analysis.totalFeedingMl,
      vitaminD: vitD,
      vitaminA: vitA,
      calcium,
      iron,
      zinc,
      dha,
    });

    for (const item of analysis.allNutrients) {
      if (!nutrientTotals[item.nutrientId]) {
        nutrientTotals[item.nutrientId] = { total: 0, unit: item.unit, name: item.name };
      }
      nutrientTotals[item.nutrientId].total += item.totalAmount;
    }
  }

  const daysCount = dailyDataList.length;
  const averageIntakes: MultiDayNutritionSummary["averageIntakes"] = {};
  const dri = getDRIForAge(babyAgeMonths);

  for (const [nId, val] of Object.entries(nutrientTotals)) {
    const avg = Number((val.total / daysCount).toFixed(2));
    const target = dri.nutrients[nId]?.rni ?? dri.nutrients[nId]?.ai;
    const rate = target && target > 0 ? Number(((avg / target) * 100).toFixed(1)) : undefined;

    averageIntakes[nId] = {
      name: val.name,
      averageAmount: avg,
      targetAmount: target,
      unit: val.unit,
      achievementRate: rate,
    };
  }

  return {
    startDate: dailyDataList[0]?.date || "",
    endDate: dailyDataList[dailyDataList.length - 1]?.date || "",
    daysCount,
    dailyTrends,
    averageIntakes,
  };
}
