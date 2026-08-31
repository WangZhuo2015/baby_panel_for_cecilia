import type { DRIStandard, DRINutrientDefinition, AgeGroup, NutrientCategory } from "@/types/nutrition";

/**
 * 中国居民膳食营养素参考摄入量 (DRIs 2023 / WS/T 578)
 * 覆盖人群：
 * - 0-6 个月 (0-6m)
 * - 7-12 个月 (6-12m)
 * - 1-3 岁 (1-3y)
 */

export const CORE_NUTRIENT_IDS = [
  "vitamin_d",
  "vitamin_a",
  "calcium",
  "iron",
  "zinc",
  "dha",
  "energy_kcal",
  "protein",
];

export const ALL_NUTRIENT_IDS = [
  // 能量与宏量营养素
  "energy_kcal",
  "energy_kj",
  "protein",
  "fat",
  "carbohydrate",
  "dietary_fiber",
  // 脂肪酸
  "linoleic_acid",
  "alpha_linolenic_acid",
  "dha",
  "ara",
  // 脂溶性维生素
  "vitamin_a",
  "vitamin_d",
  "vitamin_e",
  "vitamin_k",
  // 水溶性维生素
  "vitamin_b1",
  "vitamin_b2",
  "vitamin_b6",
  "vitamin_b12",
  "vitamin_c",
  "folate",
  "niacin",
  "pantothenic_acid",
  "biotin",
  "choline",
  // 常量与微量元素
  "calcium",
  "phosphorus",
  "potassium",
  "sodium",
  "magnesium",
  "iron",
  "zinc",
  "copper",
  "manganese",
  "iodine",
  "selenium",
  // 其它重要有益成分
  "taurine",
  "nucleotides",
  "lutein",
];

export const NUTRIENT_NAMES_CN: Record<string, { name: string; unit: string; category: NutrientCategory }> = {
  energy_kcal: { name: "能量", unit: "kcal", category: "macro" },
  energy_kj: { name: "能量(千焦)", unit: "kJ", category: "macro" },
  protein: { name: "蛋白质", unit: "g", category: "macro" },
  fat: { name: "脂肪", unit: "g", category: "macro" },
  carbohydrate: { name: "碳水化合物", unit: "g", category: "macro" },
  dietary_fiber: { name: "膳食纤维", unit: "g", category: "macro" },

  linoleic_acid: { name: "亚油酸", unit: "mg", category: "fatty_acid" },
  alpha_linolenic_acid: { name: "α-亚麻酸", unit: "mg", category: "fatty_acid" },
  dha: { name: "DHA (二十二碳六烯酸)", unit: "mg", category: "fatty_acid" },
  ara: { name: "ARA (花生四烯酸)", unit: "mg", category: "fatty_acid" },

  vitamin_a: { name: "维生素A", unit: "mcg RAE", category: "vitamin" },
  vitamin_d: { name: "维生素D", unit: "IU", category: "vitamin" },
  vitamin_e: { name: "维生素E", unit: "mg α-TE", category: "vitamin" },
  vitamin_k: { name: "维生素K", unit: "mcg", category: "vitamin" },
  vitamin_b1: { name: "维生素B1 (硫胺素)", unit: "mg", category: "vitamin" },
  vitamin_b2: { name: "维生素B2 (核黄素)", unit: "mg", category: "vitamin" },
  vitamin_b6: { name: "维生素B6", unit: "mg", category: "vitamin" },
  vitamin_b12: { name: "维生素B12", unit: "mcg", category: "vitamin" },
  vitamin_c: { name: "维生素C", unit: "mg", category: "vitamin" },
  folate: { name: "叶酸", unit: "mcg DFE", category: "vitamin" },
  niacin: { name: "烟酸", unit: "mg NE", category: "vitamin" },
  pantothenic_acid: { name: "泛酸", unit: "mg", category: "vitamin" },
  biotin: { name: "生物素", unit: "mcg", category: "vitamin" },
  choline: { name: "胆碱", unit: "mg", category: "vitamin" },

  calcium: { name: "钙", unit: "mg", category: "mineral" },
  phosphorus: { name: "磷", unit: "mg", category: "mineral" },
  potassium: { name: "钾", unit: "mg", category: "mineral" },
  sodium: { name: "钠", unit: "mg", category: "mineral" },
  magnesium: { name: "镁", unit: "mg", category: "mineral" },
  iron: { name: "铁", unit: "mg", category: "mineral" },
  zinc: { name: "锌", unit: "mg", category: "mineral" },
  copper: { name: "铜", unit: "mcg", category: "mineral" },
  manganese: { name: "锰", unit: "mg", category: "mineral" },
  iodine: { name: "碘", unit: "mcg", category: "mineral" },
  selenium: { name: "硒", unit: "mcg", category: "mineral" },

  taurine: { name: "牛磺酸", unit: "mg", category: "other" },
  nucleotides: { name: "核苷酸", unit: "mg", category: "other" },
  lutein: { name: "叶黄素", unit: "mcg", category: "other" },
};

export const DRIS_DATA: Record<AgeGroup, DRIStandard> = {
  "0-6m": {
    ageGroup: "0-6m",
    ageRangeLabel: "0-6 个月 (乳儿期)",
    nutrients: {
      energy_kcal: { id: "energy_kcal", name: "能量", unit: "kcal", category: "macro", ai: 500, description: "按需喂养，母乳/配方奶全量供应" },
      protein: { id: "protein", name: "蛋白质", unit: "g", category: "macro", ai: 9.0, description: "主要来自乳清蛋白与酪蛋白" },
      fat: { id: "fat", name: "脂肪", unit: "g", category: "macro", ai: 27.0 },
      carbohydrate: { id: "carbohydrate", name: "碳水化合物", unit: "g", category: "macro", ai: 60.0 },

      dha: { id: "dha", name: "DHA", unit: "mg", category: "fatty_acid", ai: 100, description: "支持神经大脑与视网膜发育" },
      ara: { id: "ara", name: "ARA", unit: "mg", category: "fatty_acid", ai: 100 },

      vitamin_d: { id: "vitamin_d", name: "维生素D", unit: "IU", category: "vitamin", ai: 400, ul: 800, description: "促进钙吸收与骨骼发育 (400 IU = 10 mcg，UL为 800 IU)" },
      vitamin_a: { id: "vitamin_a", name: "维生素A", unit: "mcg RAE", category: "vitamin", ai: 300, ul: 600, description: "维持视力与黏膜免疫，UL为 600 mcg RAE (2000 IU)" },
      vitamin_e: { id: "vitamin_e", name: "维生素E", unit: "mg α-TE", category: "vitamin", ai: 3.0 },
      vitamin_k: { id: "vitamin_k", name: "维生素K", unit: "mcg", category: "vitamin", ai: 2.0 },
      vitamin_c: { id: "vitamin_c", name: "维生素C", unit: "mg", category: "vitamin", ai: 40 },
      vitamin_b1: { id: "vitamin_b1", name: "维生素B1", unit: "mg", category: "vitamin", ai: 0.2 },
      vitamin_b2: { id: "vitamin_b2", name: "维生素B2", unit: "mg", category: "vitamin", ai: 0.4 },
      vitamin_b6: { id: "vitamin_b6", name: "维生素B6", unit: "mg", category: "vitamin", ai: 0.1 },
      vitamin_b12: { id: "vitamin_b12", name: "维生素B12", unit: "mcg", category: "vitamin", ai: 0.4 },
      folate: { id: "folate", name: "叶酸", unit: "mcg DFE", category: "vitamin", ai: 65 },
      niacin: { id: "niacin", name: "烟酸", unit: "mg NE", category: "vitamin", ai: 2.0 },
      pantothenic_acid: { id: "pantothenic_acid", name: "泛酸", unit: "mg", category: "vitamin", ai: 1.7 },
      biotin: { id: "biotin", name: "生物素", unit: "mcg", category: "vitamin", ai: 5.0 },
      choline: { id: "choline", name: "胆碱", unit: "mg", category: "vitamin", ai: 120 },

      calcium: { id: "calcium", name: "钙", unit: "mg", category: "mineral", ai: 200, ul: 1000, description: "骨骼与牙胚发育，充足奶量无需盲目补钙" },
      phosphorus: { id: "phosphorus", name: "磷", unit: "mg", category: "mineral", ai: 100 },
      potassium: { id: "potassium", name: "钾", unit: "mg", category: "mineral", ai: 400 },
      sodium: { id: "sodium", name: "钠", unit: "mg", category: "mineral", ai: 170 },
      magnesium: { id: "magnesium", name: "镁", unit: "mg", category: "mineral", ai: 30 },
      iron: { id: "iron", name: "铁", unit: "mg", category: "mineral", ai: 0.3, ul: 25, description: "足月儿自带储铁，纯母乳0-6月按需，早产儿需遵医嘱补铁" },
      zinc: { id: "zinc", name: "锌", unit: "mg", category: "mineral", ai: 2.0, ul: 8.0, description: "支持免疫与生长" },
      copper: { id: "copper", name: "铜", unit: "mcg", category: "mineral", ai: 200 },
      iodine: { id: "iodine", name: "碘", unit: "mcg", category: "mineral", ai: 85, ul: 200 },
      selenium: { id: "selenium", name: "硒", unit: "mcg", category: "mineral", ai: 15, ul: 55 },
    },
  },

  "6-12m": {
    ageGroup: "6-12m",
    ageRangeLabel: "7-12 个月 (辅食添加期)",
    nutrients: {
      energy_kcal: { id: "energy_kcal", name: "能量", unit: "kcal", category: "macro", ai: 650, description: "奶量保证 600-800ml，辅食逐步引入" },
      protein: { id: "protein", name: "蛋白质", unit: "g", category: "macro", rni: 20.0, description: "肉蛋奶豆多元蛋白质供给" },
      fat: { id: "fat", name: "脂肪", unit: "g", category: "macro", ai: 30.0 },
      carbohydrate: { id: "carbohydrate", name: "碳水化合物", unit: "g", category: "macro", ai: 85.0 },
      dietary_fiber: { id: "dietary_fiber", name: "膳食纤维", unit: "g", category: "macro", ai: 5.0 },

      dha: { id: "dha", name: "DHA", unit: "mg", category: "fatty_acid", ai: 100, description: "支持视力与神经髓鞘化" },
      ara: { id: "ara", name: "ARA", unit: "mg", category: "fatty_acid", ai: 100 },

      vitamin_d: { id: "vitamin_d", name: "维生素D", unit: "IU", category: "vitamin", ai: 400, ul: 800, description: "每日补充 400 IU (10 mcg)，UL 800 IU" },
      vitamin_a: { id: "vitamin_a", name: "维生素A", unit: "mcg RAE", category: "vitamin", ai: 350, ul: 700, description: "维持上皮完整性与免疫" },
      vitamin_e: { id: "vitamin_e", name: "维生素E", unit: "mg α-TE", category: "vitamin", ai: 4.0 },
      vitamin_k: { id: "vitamin_k", name: "维生素K", unit: "mcg", category: "vitamin", ai: 5.0 },
      vitamin_c: { id: "vitamin_c", name: "维生素C", unit: "mg", category: "vitamin", ai: 40, description: "促进辅食中植物性铁吸收" },
      vitamin_b1: { id: "vitamin_b1", name: "维生素B1", unit: "mg", category: "vitamin", ai: 0.3 },
      vitamin_b2: { id: "vitamin_b2", name: "维生素B2", unit: "mg", category: "vitamin", ai: 0.5 },
      vitamin_b6: { id: "vitamin_b6", name: "维生素B6", unit: "mg", category: "vitamin", ai: 0.3 },
      vitamin_b12: { id: "vitamin_b12", name: "维生素B12", unit: "mcg", category: "vitamin", ai: 0.5 },
      folate: { id: "folate", name: "叶酸", unit: "mcg DFE", category: "vitamin", ai: 80 },
      niacin: { id: "niacin", name: "烟酸", unit: "mg NE", category: "vitamin", ai: 3.0 },
      pantothenic_acid: { id: "pantothenic_acid", name: "泛酸", unit: "mg", category: "vitamin", ai: 2.0 },
      biotin: { id: "biotin", name: "生物素", unit: "mcg", category: "vitamin", ai: 6.0 },
      choline: { id: "choline", name: "胆碱", unit: "mg", category: "vitamin", ai: 150 },

      calcium: { id: "calcium", name: "钙", unit: "mg", category: "mineral", ai: 250, ul: 1500, description: "每日 250mg，充足奶量基本能满足" },
      phosphorus: { id: "phosphorus", name: "磷", unit: "mg", category: "mineral", ai: 160 },
      potassium: { id: "potassium", name: "钾", unit: "mg", category: "mineral", ai: 700 },
      sodium: { id: "sodium", name: "钠", unit: "mg", category: "mineral", ai: 350, description: "1岁内辅食无需额外加盐" },
      magnesium: { id: "magnesium", name: "镁", unit: "mg", category: "mineral", ai: 60 },
      iron: { id: "iron", name: "铁", unit: "mg", category: "mineral", rni: 10.0, ul: 25, description: "6月龄后母体储铁耗尽，需强化高铁米粉与红肉泥" },
      zinc: { id: "zinc", name: "锌", unit: "mg", category: "mineral", rni: 3.5, ul: 8.0, description: "红肉、肝脏、海产为优质来源" },
      copper: { id: "copper", name: "铜", unit: "mcg", category: "mineral", ai: 300 },
      iodine: { id: "iodine", name: "碘", unit: "mcg", category: "mineral", ai: 90, ul: 250 },
      selenium: { id: "selenium", name: "硒", unit: "mcg", category: "mineral", ai: 17, ul: 80 },
    },
  },

  "1-3y": {
    ageGroup: "1-3y",
    ageRangeLabel: "1-3 岁 (幼儿期)",
    nutrients: {
      energy_kcal: { id: "energy_kcal", name: "能量", unit: "kcal", category: "macro", ai: 1050, description: "一日三餐加点心，奶量 300-500ml" },
      protein: { id: "protein", name: "蛋白质", unit: "g", category: "macro", rni: 25.0 },
      fat: { id: "fat", name: "脂肪", unit: "g", category: "macro", ai: 35.0 },
      carbohydrate: { id: "carbohydrate", name: "碳水化合物", unit: "g", category: "macro", ai: 130.0 },
      dietary_fiber: { id: "dietary_fiber", name: "膳食纤维", unit: "g", category: "macro", ai: 9.0 },

      dha: { id: "dha", name: "DHA", unit: "mg", category: "fatty_acid", ai: 100 },
      ara: { id: "ara", name: "ARA", unit: "mg", category: "fatty_acid", ai: 100 },

      vitamin_d: { id: "vitamin_d", name: "维生素D", unit: "IU", category: "vitamin", ai: 400, ul: 1600, description: "继续保持每日 400-600 IU 补充，UL 1600 IU" },
      vitamin_a: { id: "vitamin_a", name: "维生素A", unit: "mcg RAE", category: "vitamin", rni: 310, ul: 700 },
      vitamin_e: { id: "vitamin_e", name: "维生素E", unit: "mg α-TE", category: "vitamin", ai: 5.0, ul: 200 },
      vitamin_k: { id: "vitamin_k", name: "维生素K", unit: "mcg", category: "vitamin", ai: 9.0 },
      vitamin_c: { id: "vitamin_c", name: "维生素C", unit: "mg", category: "vitamin", rni: 40, ul: 400 },
      vitamin_b1: { id: "vitamin_b1", name: "维生素B1", unit: "mg", category: "vitamin", rni: 0.6 },
      vitamin_b2: { id: "vitamin_b2", name: "维生素B2", unit: "mg", category: "vitamin", rni: 0.6 },
      vitamin_b6: { id: "vitamin_b6", name: "维生素B6", unit: "mg", category: "vitamin", rni: 0.5 },
      vitamin_b12: { id: "vitamin_b12", name: "维生素B12", unit: "mcg", category: "vitamin", rni: 0.9 },
      folate: { id: "folate", name: "叶酸", unit: "mcg DFE", category: "vitamin", rni: 140, ul: 300 },
      niacin: { id: "niacin", name: "烟酸", unit: "mg NE", category: "vitamin", rni: 6.0, ul: 10 },
      pantothenic_acid: { id: "pantothenic_acid", name: "泛酸", unit: "mg", category: "vitamin", ai: 2.5 },
      biotin: { id: "biotin", name: "生物素", unit: "mcg", category: "vitamin", ai: 9.0 },
      choline: { id: "choline", name: "胆碱", unit: "mg", category: "vitamin", ai: 200, ul: 1000 },

      calcium: { id: "calcium", name: "钙", unit: "mg", category: "mineral", rni: 600, ul: 1500, description: "推荐每日 600mg，通过奶制品与绿叶菜、豆制品摄入" },
      phosphorus: { id: "phosphorus", name: "磷", unit: "mg", category: "mineral", rni: 260, ul: 3000 },
      potassium: { id: "potassium", name: "钾", unit: "mg", category: "mineral", ai: 900 },
      sodium: { id: "sodium", name: "钠", unit: "mg", category: "mineral", ai: 700, ul: 1300 },
      magnesium: { id: "magnesium", name: "镁", unit: "mg", category: "mineral", rni: 140, description: "推荐每日 140mg (仅补剂来源UL为65mg)" },
      iron: { id: "iron", name: "铁", unit: "mg", category: "mineral", rni: 9.0, ul: 25 },
      zinc: { id: "zinc", name: "锌", unit: "mg", category: "mineral", rni: 4.0, ul: 12.0 },
      copper: { id: "copper", name: "铜", unit: "mcg", category: "mineral", rni: 400, ul: 1000 },
      iodine: { id: "iodine", name: "碘", unit: "mcg", category: "mineral", rni: 90, ul: 300 },
      selenium: { id: "selenium", name: "硒", unit: "mcg", category: "mineral", rni: 25, ul: 120 },
    },
  },
};

export function getAgeGroup(ageMonths: number): AgeGroup {
  if (ageMonths < 6) return "0-6m";
  if (ageMonths < 12) return "6-12m";
  return "1-3y";
}

export function getDRIForAge(ageMonths: number): DRIStandard {
  const group = getAgeGroup(ageMonths);
  return DRIS_DATA[group];
}

export function getNutrientDefinition(nutrientId: string, ageMonths: number): DRINutrientDefinition | null {
  const dri = getDRIForAge(ageMonths);
  if (dri.nutrients[nutrientId]) {
    return dri.nutrients[nutrientId];
  }
  const meta = NUTRIENT_NAMES_CN[nutrientId];
  if (meta) {
    return {
      id: nutrientId,
      name: meta.name,
      unit: meta.unit,
      category: meta.category,
    };
  }
  return null;
}
