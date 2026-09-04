import type { NutrientsMap } from "@/types/nutrition";

/**
 * 婴幼儿常用辅食单次标准份量营养素参考基准 (Standard Infant Serving Nutrients)
 *
 * 制定依据：
 * 1. 中国营养学会《中国居民膳食指南 (2022)》婴幼儿喂养指南
 * 2. 《中国食物成分表 (标准版第6版)》
 * 3. 婴幼儿谷类辅助食品国家标准 (GB 10769)
 *
 * 基准份量定义 (以6-12月龄单餐辅食平均标准摄入量为基准)：
 * - 婴儿强化米粉：单次约 20-25g 干粉 (冲调为一小碗细腻米糊)
 * - 蛋黄/鸡蛋：单次约 1 个蛋黄或小半颗全蛋 (~25g)
 * - 肉泥/肝泥：单次约 20-25g
 * - 深海鱼泥：单次约 20-25g
 * - 蔬菜/果泥：单次约 30g
 * - 辅食油：单次约 1.5-2g
 */
export const STANDARD_FOOD_NUTRIENTS: Record<string, NutrientsMap> = {
  // ─── 谷物与强化米粉 (Grains & Iron-fortified cereals) ──────────────────────────
  food_iron_cereal: {
    energy_kcal: { amount: 95, unit: "kcal" },
    protein: { amount: 2.0, unit: "g" },
    carbohydrate: { amount: 19.5, unit: "g" },
    iron: { amount: 5.0, unit: "mg" }, // 高铁米粉核心强化
    zinc: { amount: 1.2, unit: "mg" },
    calcium: { amount: 100, unit: "mg" },
    vitamin_b1: { amount: 0.15, unit: "mg" },
    vitamin_c: { amount: 15, unit: "mg" },
  },
  food_little_freddie_iron_rice_cereal: {
    energy_kcal: { amount: 96, unit: "kcal" },
    protein: { amount: 2.1, unit: "g" },
    carbohydrate: { amount: 19.8, unit: "g" },
    iron: { amount: 5.5, unit: "mg" },
    zinc: { amount: 1.3, unit: "mg" },
    calcium: { amount: 90, unit: "mg" },
    vitamin_b1: { amount: 0.18, unit: "mg" },
  },
  food_little_freddie_quinoa_rice_cereal: {
    energy_kcal: { amount: 98, unit: "kcal" },
    protein: { amount: 2.5, unit: "g" },
    dietary_fiber: { amount: 0.8, unit: "g" },
    carbohydrate: { amount: 19.2, unit: "g" },
    iron: { amount: 5.2, unit: "mg" },
    zinc: { amount: 1.4, unit: "mg" },
    calcium: { amount: 85, unit: "mg" },
    vitamin_b1: { amount: 0.16, unit: "mg" },
  },
  food_little_freddie_oatmeal_cereal: {
    energy_kcal: { amount: 100, unit: "kcal" },
    protein: { amount: 2.8, unit: "g" },
    dietary_fiber: { amount: 1.2, unit: "g" },
    carbohydrate: { amount: 18.5, unit: "g" },
    iron: { amount: 5.0, unit: "mg" },
    zinc: { amount: 1.3, unit: "mg" },
    calcium: { amount: 95, unit: "mg" },
    vitamin_b1: { amount: 0.18, unit: "mg" },
  },
  food_little_freddie_prune_apple_cereal: {
    energy_kcal: { amount: 94, unit: "kcal" },
    protein: { amount: 1.8, unit: "g" },
    dietary_fiber: { amount: 1.0, unit: "g" },
    carbohydrate: { amount: 20.2, unit: "g" },
    iron: { amount: 5.0, unit: "mg" },
    calcium: { amount: 80, unit: "mg" },
    vitamin_c: { amount: 12, unit: "mg" },
  },
  food_little_freddie_multigrain_blueberry_cereal: {
    energy_kcal: { amount: 97, unit: "kcal" },
    protein: { amount: 2.4, unit: "g" },
    dietary_fiber: { amount: 1.1, unit: "g" },
    carbohydrate: { amount: 19.0, unit: "g" },
    iron: { amount: 5.0, unit: "mg" },
    zinc: { amount: 1.2, unit: "mg" },
    calcium: { amount: 85, unit: "mg" },
  },
  food_little_freddie_spinach_beef_cereal: {
    energy_kcal: { amount: 98, unit: "kcal" },
    protein: { amount: 3.2, unit: "g" },
    carbohydrate: { amount: 18.0, unit: "g" },
    iron: { amount: 5.8, unit: "mg" },
    zinc: { amount: 1.6, unit: "mg" },
    calcium: { amount: 90, unit: "mg" },
    vitamin_a: { amount: 60, unit: "mcg RAE" },
  },
  food_rice_porridge: {
    energy_kcal: { amount: 45, unit: "kcal" },
    protein: { amount: 1.0, unit: "g" },
    carbohydrate: { amount: 9.8, unit: "g" },
    iron: { amount: 0.2, unit: "mg" },
    zinc: { amount: 0.3, unit: "mg" },
    calcium: { amount: 5, unit: "mg" },
  },
  food_oats: {
    energy_kcal: { amount: 75, unit: "kcal" },
    protein: { amount: 2.8, unit: "g" },
    dietary_fiber: { amount: 1.5, unit: "g" },
    carbohydrate: { amount: 13.5, unit: "g" },
    iron: { amount: 0.9, unit: "mg" },
    zinc: { amount: 0.8, unit: "mg" },
    calcium: { amount: 15, unit: "mg" },
  },
  food_noodles: {
    energy_kcal: { amount: 60, unit: "kcal" },
    protein: { amount: 1.8, unit: "g" },
    carbohydrate: { amount: 12.0, unit: "g" },
    iron: { amount: 0.3, unit: "mg" },
    zinc: { amount: 0.3, unit: "mg" },
  },

  // ─── 蛋白质、肉类与禽蛋 (Protein, Meats, Poultry & Eggs) ────────────────────────
  food_egg: {
    energy_kcal: { amount: 72, unit: "kcal" },
    protein: { amount: 6.3, unit: "g" },
    fat: { amount: 4.8, unit: "g" },
    iron: { amount: 1.1, unit: "mg" },
    zinc: { amount: 0.7, unit: "mg" },
    calcium: { amount: 28, unit: "mg" },
    vitamin_a: { amount: 110, unit: "mcg RAE" },
    vitamin_d: { amount: 40, unit: "IU" },
    dha: { amount: 18, unit: "mg" },
    choline: { amount: 125, unit: "mg" },
  },
  food_beef: {
    energy_kcal: { amount: 48, unit: "kcal" },
    protein: { amount: 5.5, unit: "g" },
    fat: { amount: 2.6, unit: "g" },
    iron: { amount: 1.5, unit: "mg" }, // 高生物利用度血红素铁
    zinc: { amount: 1.8, unit: "mg" },
    calcium: { amount: 4, unit: "mg" },
    vitamin_b12: { amount: 0.5, unit: "mcg" },
  },
  food_pork: {
    energy_kcal: { amount: 50, unit: "kcal" },
    protein: { amount: 5.2, unit: "g" },
    fat: { amount: 3.0, unit: "g" },
    iron: { amount: 0.9, unit: "mg" },
    zinc: { amount: 1.1, unit: "mg" },
    vitamin_b1: { amount: 0.12, unit: "mg" },
  },
  food_chicken: {
    energy_kcal: { amount: 42, unit: "kcal" },
    protein: { amount: 5.8, unit: "g" },
    fat: { amount: 1.8, unit: "g" },
    iron: { amount: 0.4, unit: "mg" },
    zinc: { amount: 0.6, unit: "mg" },
  },
  food_liver: {
    energy_kcal: { amount: 25, unit: "kcal" },
    protein: { amount: 3.8, unit: "g" },
    fat: { amount: 0.8, unit: "g" },
    iron: { amount: 3.5, unit: "mg" }, // 极佳高铁来源
    zinc: { amount: 0.9, unit: "mg" },
    vitamin_a: { amount: 750, unit: "mcg RAE" }, // 丰富维生素A
    folate: { amount: 35, unit: "mcg DFE" },
  },
  food_salmon: {
    energy_kcal: { amount: 45, unit: "kcal" },
    protein: { amount: 5.0, unit: "g" },
    fat: { amount: 2.6, unit: "g" },
    dha: { amount: 150, unit: "mg" }, // 优质脑发育DHA
    vitamin_d: { amount: 120, unit: "IU" },
    iron: { amount: 0.3, unit: "mg" },
    zinc: { amount: 0.4, unit: "mg" },
  },
  food_shrimp: {
    energy_kcal: { amount: 26, unit: "kcal" },
    protein: { amount: 5.2, unit: "g" },
    fat: { amount: 0.3, unit: "g" },
    calcium: { amount: 35, unit: "mg" },
    zinc: { amount: 0.8, unit: "mg" },
    iron: { amount: 0.5, unit: "mg" },
  },
  food_tofu: {
    energy_kcal: { amount: 28, unit: "kcal" },
    protein: { amount: 2.8, unit: "g" },
    fat: { amount: 1.2, unit: "g" },
    calcium: { amount: 45, unit: "mg" }, // 良好植物钙来源
    iron: { amount: 0.6, unit: "mg" },
    zinc: { amount: 0.3, unit: "mg" },
  },
  food_peanut_butter_thin: {
    energy_kcal: { amount: 35, unit: "kcal" },
    protein: { amount: 1.5, unit: "g" },
    fat: { amount: 3.0, unit: "g" },
    zinc: { amount: 0.2, unit: "mg" },
  },

  // ─── 蔬菜泥 (Vegetables) ───────────────────────────────────────────────────────
  food_broccoli: {
    energy_kcal: { amount: 11, unit: "kcal" },
    protein: { amount: 0.9, unit: "g" },
    dietary_fiber: { amount: 0.8, unit: "g" },
    calcium: { amount: 16, unit: "mg" },
    iron: { amount: 0.3, unit: "mg" },
    vitamin_c: { amount: 15, unit: "mg" },
    folate: { amount: 20, unit: "mcg DFE" },
    vitamin_a: { amount: 30, unit: "mcg RAE" },
  },
  food_spinach: {
    energy_kcal: { amount: 9, unit: "kcal" },
    protein: { amount: 0.8, unit: "g" },
    dietary_fiber: { amount: 0.7, unit: "g" },
    calcium: { amount: 22, unit: "mg" },
    iron: { amount: 0.8, unit: "mg" },
    vitamin_c: { amount: 8, unit: "mg" },
    vitamin_a: { amount: 85, unit: "mcg RAE" },
    folate: { amount: 25, unit: "mcg DFE" },
  },
  food_carrot: {
    energy_kcal: { amount: 12, unit: "kcal" },
    carbohydrate: { amount: 2.6, unit: "g" },
    dietary_fiber: { amount: 0.8, unit: "g" },
    vitamin_a: { amount: 220, unit: "mcg RAE" }, // 丰富β-胡萝卜素
    potassium: { amount: 60, unit: "mg" },
    calcium: { amount: 10, unit: "mg" },
  },
  food_pumpkin: {
    energy_kcal: { amount: 15, unit: "kcal" },
    carbohydrate: { amount: 3.2, unit: "g" },
    dietary_fiber: { amount: 0.6, unit: "g" },
    vitamin_a: { amount: 110, unit: "mcg RAE" },
    potassium: { amount: 55, unit: "mg" },
  },
  food_sweet_potato: {
    energy_kcal: { amount: 28, unit: "kcal" },
    carbohydrate: { amount: 6.5, unit: "g" },
    dietary_fiber: { amount: 0.8, unit: "g" },
    vitamin_a: { amount: 80, unit: "mcg RAE" },
    potassium: { amount: 75, unit: "mg" },
    vitamin_c: { amount: 4, unit: "mg" },
  },
  food_potato: {
    energy_kcal: { amount: 24, unit: "kcal" },
    carbohydrate: { amount: 5.4, unit: "g" },
    dietary_fiber: { amount: 0.5, unit: "g" },
    potassium: { amount: 95, unit: "mg" },
    vitamin_c: { amount: 4, unit: "mg" },
  },
  food_tomato: {
    energy_kcal: { amount: 8, unit: "kcal" },
    carbohydrate: { amount: 1.6, unit: "g" },
    vitamin_c: { amount: 6, unit: "mg" },
    potassium: { amount: 50, unit: "mg" },
  },

  // ─── 水果泥 (Fruits) ──────────────────────────────────────────────────────────
  food_apple: {
    energy_kcal: { amount: 18, unit: "kcal" },
    carbohydrate: { amount: 4.4, unit: "g" },
    dietary_fiber: { amount: 0.6, unit: "g" },
    potassium: { amount: 35, unit: "mg" },
    vitamin_c: { amount: 2, unit: "mg" },
  },
  food_pear: {
    energy_kcal: { amount: 17, unit: "kcal" },
    carbohydrate: { amount: 4.2, unit: "g" },
    dietary_fiber: { amount: 0.8, unit: "g" },
    potassium: { amount: 30, unit: "mg" },
  },
  food_banana: {
    energy_kcal: { amount: 28, unit: "kcal" },
    carbohydrate: { amount: 6.8, unit: "g" },
    dietary_fiber: { amount: 0.6, unit: "g" },
    potassium: { amount: 80, unit: "mg" },
    vitamin_b6: { amount: 0.1, unit: "mg" },
  },
  food_avocado: {
    energy_kcal: { amount: 45, unit: "kcal" },
    fat: { amount: 4.2, unit: "g" }, // 丰富单不饱和脂肪酸
    dietary_fiber: { amount: 1.5, unit: "g" },
    potassium: { amount: 120, unit: "mg" },
    folate: { amount: 20, unit: "mcg DFE" },
  },
  food_orange: {
    energy_kcal: { amount: 16, unit: "kcal" },
    carbohydrate: { amount: 3.8, unit: "g" },
    vitamin_c: { amount: 12, unit: "mg" },
    potassium: { amount: 45, unit: "mg" },
  },
  food_grape: {
    energy_kcal: { amount: 15, unit: "kcal" },
    carbohydrate: { amount: 3.7, unit: "g" },
    potassium: { amount: 30, unit: "mg" },
  },

  // ─── 辅食油脂类 (Baby Oils) ───────────────────────────────────────────────────
  food_little_freddie_walnut_oil: {
    energy_kcal: { amount: 18, unit: "kcal" },
    fat: { amount: 2.0, unit: "g" },
    alpha_linolenic_acid: { amount: 220, unit: "mg" }, // Omega-3
    linoleic_acid: { amount: 1100, unit: "mg" }, // Omega-6
    vitamin_e: { amount: 0.5, unit: "mg α-TE" },
  },
  food_little_freddie_flaxseed_oil: {
    energy_kcal: { amount: 18, unit: "kcal" },
    fat: { amount: 2.0, unit: "g" },
    alpha_linolenic_acid: { amount: 950, unit: "mg" }, // 高达 50%+ α-亚麻酸
    vitamin_e: { amount: 0.4, unit: "mg α-TE" },
  },
  food_little_freddie_avocado_oil: {
    energy_kcal: { amount: 18, unit: "kcal" },
    fat: { amount: 2.0, unit: "g" },
    vitamin_e: { amount: 0.6, unit: "mg α-TE" },
  },
  food_little_freddie_olive_oil: {
    energy_kcal: { amount: 18, unit: "kcal" },
    fat: { amount: 2.0, unit: "g" },
    vitamin_e: { amount: 0.4, unit: "mg α-TE" },
  },

  // ─── 乳制品与酸奶 (Dairy) ─────────────────────────────────────────────────────
  food_yogurt_plain: {
    energy_kcal: { amount: 32, unit: "kcal" },
    protein: { amount: 1.8, unit: "g" },
    fat: { amount: 1.5, unit: "g" },
    calcium: { amount: 65, unit: "mg" },
  },
};

/**
 * 进食量份量折算系数 (Portion Multipliers)
 */
export const PORTION_MULTIPLIERS: Record<string, number> = {
  little: 0.3, // 少量尝味
  half: 0.5,   // 半碗
  most: 0.8,   // 大部分 (约80%)
  all: 1.0,    // 全部吃完 (100%)
};

export const PORTION_LABELS: Record<string, string> = {
  little: "少量",
  half: "半碗",
  most: "大部分",
  all: "全部",
};

/**
 * 食材类别兜底均值 (Category Fallback Nutrients)
 * 当用户自定义录入了食材库中未预置具体单品的数据时，按类别给出安全保守的估算
 */
export const CATEGORY_FALLBACK_NUTRIENTS: Record<string, NutrientsMap> = {
  grain: {
    energy_kcal: { amount: 60, unit: "kcal" },
    protein: { amount: 1.5, unit: "g" },
    carbohydrate: { amount: 13.0, unit: "g" },
    iron: { amount: 0.5, unit: "mg" },
  },
  protein: {
    energy_kcal: { amount: 45, unit: "kcal" },
    protein: { amount: 5.0, unit: "g" },
    fat: { amount: 2.0, unit: "g" },
    iron: { amount: 0.8, unit: "mg" },
    zinc: { amount: 0.8, unit: "mg" },
  },
  vegetable: {
    energy_kcal: { amount: 15, unit: "kcal" },
    carbohydrate: { amount: 2.8, unit: "g" },
    dietary_fiber: { amount: 0.7, unit: "g" },
    vitamin_c: { amount: 6, unit: "mg" },
    potassium: { amount: 60, unit: "mg" },
  },
  fruit: {
    energy_kcal: { amount: 20, unit: "kcal" },
    carbohydrate: { amount: 4.8, unit: "g" },
    dietary_fiber: { amount: 0.6, unit: "g" },
    vitamin_c: { amount: 4, unit: "mg" },
  },
  dairy: {
    energy_kcal: { amount: 30, unit: "kcal" },
    protein: { amount: 1.6, unit: "g" },
    calcium: { amount: 55, unit: "mg" },
  },
  oil: {
    energy_kcal: { amount: 18, unit: "kcal" },
    fat: { amount: 2.0, unit: "g" },
  },
  other: {
    energy_kcal: { amount: 20, unit: "kcal" },
    carbohydrate: { amount: 3.0, unit: "g" },
  },
};

/**
 * 名字与食材ID模糊匹配词表
 */
const FOOD_ALIAS_MAP: Record<string, string> = {
  // 婴儿米粉
  米粉: "food_iron_cereal",
  高铁米粉: "food_iron_cereal",
  强化铁婴儿谷物: "food_iron_cereal",
  婴儿米粉: "food_iron_cereal",
  小皮米粉: "food_little_freddie_iron_rice_cereal",
  小皮有机高铁大米粉: "food_little_freddie_iron_rice_cereal",
  小皮有机大米藜麦粉: "food_little_freddie_quinoa_rice_cereal",
  小皮有机大米燕麦粉: "food_little_freddie_oatmeal_cereal",
  大米粉: "food_iron_cereal",
  米糊: "food_iron_cereal",
  大米粥: "food_rice_porridge",
  燕麦: "food_oats",
  燕麦粥: "food_oats",
  面条: "food_noodles",
  软面条: "food_noodles",

  // 蛋肉类
  鸡蛋: "food_egg",
  蛋黄: "food_egg",
  蛋黄泥: "food_egg",
  鸡蛋羹: "food_egg",
  牛肉: "food_beef",
  牛肉泥: "food_beef",
  猪肉: "food_pork",
  猪肉泥: "food_pork",
  鸡肉: "food_chicken",
  鸡肉泥: "food_chicken",
  猪肝: "food_liver",
  鸡肝: "food_liver",
  动物肝脏: "food_liver",
  肝泥: "food_liver",
  猪肝泥: "food_liver",
  三文鱼: "food_salmon",
  三文鱼泥: "food_salmon",
  鳕鱼: "food_salmon",
  鳕鱼泥: "food_salmon",
  虾: "food_shrimp",
  虾泥: "food_shrimp",
  虾仁: "food_shrimp",
  豆腐: "food_tofu",
  豆腐泥: "food_tofu",

  // 蔬菜类
  西兰花: "food_broccoli",
  西兰花泥: "food_broccoli",
  菠菜: "food_spinach",
  菠菜泥: "food_spinach",
  胡萝卜: "food_carrot",
  胡萝卜泥: "food_carrot",
  南瓜: "food_pumpkin",
  南瓜泥: "food_pumpkin",
  红薯: "food_sweet_potato",
  红薯泥: "food_sweet_potato",
  土豆: "food_potato",
  土豆泥: "food_potato",
  番茄: "food_tomato",
  西红柿: "food_tomato",

  // 水果类
  苹果: "food_apple",
  苹果泥: "food_apple",
  梨: "food_pear",
  梨泥: "food_pear",
  香蕉: "food_banana",
  香蕉泥: "food_banana",
  牛油果: "food_avocado",
  牛油果泥: "food_avocado",
  橙子: "food_orange",
  葡萄: "food_grape",

  // 油脂
  核桃油: "food_little_freddie_walnut_oil",
  亚麻籽油: "food_little_freddie_flaxseed_oil",
  牛油果油: "food_little_freddie_avocado_oil",
  橄榄油: "food_little_freddie_olive_oil",
  酸奶: "food_yogurt_plain",
};

/**
 * 根据食材标识/名称及进食份量，计算单次摄入的微量与宏量营养素
 *
 * @param foodNameOrId 食材ID（如 food_egg）或食材名称（如 鸡蛋、胡萝卜泥）
 * @param portion 进食分量：little(少量), half(半碗), most(大部分), all(全部)
 * @param categoryHint 可选的分类提示 (grain, protein, vegetable, fruit, dairy, oil)
 */
export function getFoodNutrients(
  foodNameOrId: string,
  portion: string = "most",
  categoryHint?: string
): NutrientsMap {
  if (!foodNameOrId || typeof foodNameOrId !== "string") return {};

  const cleanName = foodNameOrId.trim();
  const normalizedKey = cleanName.toLowerCase();

  // 1. 精确匹配食材ID
  let standardNutrients = STANDARD_FOOD_NUTRIENTS[cleanName];

  // 2. 别名与常用名匹配
  if (!standardNutrients) {
    const matchedId = FOOD_ALIAS_MAP[cleanName] || FOOD_ALIAS_MAP[normalizedKey];
    if (matchedId) {
      standardNutrients = STANDARD_FOOD_NUTRIENTS[matchedId];
    }
  }

  // 3. 包含关键词模糊匹配
  if (!standardNutrients) {
    for (const [alias, id] of Object.entries(FOOD_ALIAS_MAP)) {
      if (cleanName.includes(alias) || (cleanName.length >= 2 && alias.includes(cleanName))) {
        standardNutrients = STANDARD_FOOD_NUTRIENTS[id];
        break;
      }
    }
  }

  // 4. 类别兜底
  if (!standardNutrients) {
    const cat = (categoryHint || inferCategory(cleanName)).toLowerCase();
    standardNutrients = CATEGORY_FALLBACK_NUTRIENTS[cat] || CATEGORY_FALLBACK_NUTRIENTS.other;
  }

  // 计算分量乘数
  const factor = PORTION_MULTIPLIERS[portion] ?? 0.8;
  const result: NutrientsMap = {};

  for (const [key, val] of Object.entries(standardNutrients)) {
    if (!val || typeof val.amount !== "number") continue;
    result[key] = {
      amount: Number((val.amount * factor).toFixed(2)),
      unit: val.unit,
    };
  }

  return result;
}

/**
 * 辅助推断未匹配食材的大类
 */
function inferCategory(name: string): string {
  if (/(米粉|谷物|粥|麦|面|米|粮)/.test(name)) return "grain";
  if (/(肉|鸡|鸭|猪|牛|羊|鱼|虾|蛋|肝|豆腐|豆)/.test(name)) return "protein";
  if (/(菜|西兰花|胡萝卜|南瓜|红薯|薯|瓜|茄|笋)/.test(name)) return "vegetable";
  if (/(果|苹果|香蕉|梨|莓|桃|橘|橙)/.test(name)) return "fruit";
  if (/(油)/.test(name)) return "oil";
  if (/(奶|酸奶|酪)/.test(name)) return "dairy";
  return "other";
}
