import type { NutrientsMap } from "@/types/nutrition";

/**
 * 中国成熟母乳营养素成分参考基准 (每 100ml / 100g 熟乳)
 * 参考来源：中国营养学会《中国居民膳食指南 (2022)》母乳成分数据库、WS/T 578
 */
export const BREASTMILK_COMPOSITION_PER_100ML: Record<string, { amount: number; unit: string }> = {
  energy_kcal: { amount: 67, unit: "kcal" },
  energy_kj: { amount: 280, unit: "kJ" },
  protein: { amount: 1.1, unit: "g" },
  fat: { amount: 3.5, unit: "g" },
  carbohydrate: { amount: 7.2, unit: "g" },

  linoleic_acid: { amount: 550, unit: "mg" },
  alpha_linolenic_acid: { amount: 50, unit: "mg" },
  dha: { amount: 18, unit: "mg" },
  ara: { amount: 20, unit: "mg" },

  vitamin_a: { amount: 50, unit: "mcg RAE" },
  // 母乳中天然维生素D含量极低，每100ml约 0.25mcg (10 IU)，因此纯母乳宝宝必须每日额外补充 400 IU 维D
  vitamin_d: { amount: 10, unit: "IU" },
  vitamin_e: { amount: 0.3, unit: "mg α-TE" },
  vitamin_k: { amount: 0.25, unit: "mcg" },
  vitamin_b1: { amount: 0.02, unit: "mg" },
  vitamin_b2: { amount: 0.04, unit: "mg" },
  vitamin_b6: { amount: 0.015, unit: "mg" },
  vitamin_b12: { amount: 0.05, unit: "mcg" },
  vitamin_c: { amount: 5.0, unit: "mg" },
  folate: { amount: 8.5, unit: "mcg DFE" },
  niacin: { amount: 0.2, unit: "mg NE" },
  pantothenic_acid: { amount: 0.25, unit: "mg" },
  biotin: { amount: 0.6, unit: "mcg" },
  choline: { amount: 16, unit: "mg" },

  calcium: { amount: 30, unit: "mg" }, // 300mg/L，吸收率高达 60%-70%
  phosphorus: { amount: 15, unit: "mg" },
  potassium: { amount: 55, unit: "mg" },
  sodium: { amount: 17, unit: "mg" },
  magnesium: { amount: 3.5, unit: "mg" },
  iron: { amount: 0.05, unit: "mg" }, // 含量低但生物利用度高达 50%
  zinc: { amount: 0.15, unit: "mg" },
  copper: { amount: 35, unit: "mcg" },
  manganese: { amount: 0.005, unit: "mg" },
  iodine: { amount: 11, unit: "mcg" },
  selenium: { amount: 2.0, unit: "mcg" },

  taurine: { amount: 5.0, unit: "mg" },
  nucleotides: { amount: 2.5, unit: "mg" },
};

/**
 * 根据母乳容量（毫升）计算摄入的各项营养素绝对量
 */
export function getBreastMilkNutrientsForVolume(volumeMl: number): NutrientsMap {
  if (volumeMl <= 0) return {};
  const factor = volumeMl / 100;
  const result: NutrientsMap = {};
  for (const [key, val] of Object.entries(BREASTMILK_COMPOSITION_PER_100ML)) {
    result[key] = {
      amount: Number((val.amount * factor).toFixed(3)),
      unit: val.unit,
    };
  }
  return result;
}

/**
 * 亲喂时长估算奶量（毫升）：
 * 临床经验常规模型：宝宝有效吸吮每分钟约产奶 3-5ml，双侧活跃进食 15-20 分钟约 70-100ml
 */
export function estimateNursingVolumeMl(leftMinutes: number = 0, rightMinutes: number = 0): number {
  const totalMinutes = Math.max(0, leftMinutes) + Math.max(0, rightMinutes);
  if (totalMinutes === 0) return 0;
  // 前5分钟流速最快（~5ml/min），之后逐步放缓（~2.5-3ml/min），单次喂养上限一般 150-180ml
  if (totalMinutes <= 10) {
    return Math.min(60, Math.round(totalMinutes * 5));
  }
  if (totalMinutes <= 20) {
    return Math.min(110, Math.round(50 + (totalMinutes - 10) * 4));
  }
  return Math.min(160, Math.round(90 + (totalMinutes - 20) * 2.5));
}
