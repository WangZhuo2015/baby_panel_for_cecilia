// ===== Nutrition & Supplement Domain Types =====

export type NutrientCategory = 'macro' | 'vitamin' | 'mineral' | 'fatty_acid' | 'other';

export interface NutrientItemValue {
  amount: number;
  unit: string;
}

export type NutrientsMap = Record<string, NutrientItemValue>;

// ─── Formula Product (奶粉档案) ─────────────────────────────────────────────
export interface FormulaProduct {
  id: string;
  familyId: string;
  name: string;
  brand: string;
  stage?: number | null;
  scoopWeightG: number;
  waterPerScoopMl: number;
  reconstitutionRatio: number;
  servingSizeUnit: string; // 'per_100g' | 'per_100ml' | 'per_100kJ'
  nutrients: NutrientsMap;
  notes?: string | null;
  isActive: boolean;
  isDefault?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// ─── Supplement Product (补剂档案) ──────────────────────────────────────────
export interface SupplementProduct {
  id: string;
  familyId: string;
  name: string;
  brand: string;
  dosageForm: string; // 'drops' | 'capsule' | 'liquid_ml' | 'sachet' | 'tablet'
  unitName: string; // '滴' | '粒' | 'ml' | '袋' | '片'
  defaultDose: number;
  nutrients: NutrientsMap;
  notes?: string | null;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// ─── Supplement Schedule (宝宝补剂计划) ─────────────────────────────────────
export type ScheduleFrequency = 'daily' | 'alternate_day' | 'specific_days';

export interface SupplementSchedule {
  id: string;
  babyId: string;
  productId: string;
  product?: SupplementProduct;
  frequency: ScheduleFrequency;
  customDays?: number[]; // [1, 3, 5] (1=Mon, 7=Sun) or anchor date index
  targetDose: number;
  reminderTime?: string | null;
  isActive: boolean;
  startDate?: string | null;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
  isCompletedToday?: boolean;
}

// ─── Supplement Record (补剂打卡记录) ───────────────────────────────────────
export interface SupplementRecord {
  id: string;
  babyId: string;
  productId: string;
  product?: SupplementProduct;
  clientId?: string | null;
  recordedById?: string | null;
  date: string;
  time: string;
  dose: number;
  unitName?: string | null;
  notes?: string | null;
  createdAt?: string;
}

// ─── DRIs Baseline & Scientific Reference ───────────────────────────────────
export interface DRINutrientDefinition {
  id: string;
  name: string;
  unit: string;
  category: NutrientCategory;
  rni?: number;
  ai?: number;
  ul?: number;
  description?: string;
}

export type AgeGroup = '0-6m' | '6-12m' | '1-3y';

export interface DRIStandard {
  ageGroup: AgeGroup;
  ageRangeLabel: string;
  nutrients: Record<string, DRINutrientDefinition>;
}

// ─── Deterministic Nutrition Calculation Types ──────────────────────────────
export interface NutrientSourceContribution {
  sourceId: string;
  sourceName: string;
  sourceType: 'formula' | 'supplement' | 'breastmilk' | 'food';
  amount: number;
  unit: string;
}

export interface NutrientIntakeItem {
  nutrientId: string;
  name: string;
  unit: string;
  category: NutrientCategory;
  formulaAmount: number;
  supplementAmount: number;
  breastmilkAmount: number;
  foodAmount: number;
  totalAmount: number;
  targetAmount?: number;
  targetType?: 'RNI' | 'AI';
  achievementRate?: number; // 0 - 100%+
  ul?: number;
  isOverLimit: boolean;
  isNearLimit: boolean;
  sources: NutrientSourceContribution[];
}

export interface DailyNutritionAnalysis {
  date: string;
  babyAgeMonths: number;
  ageGroup: AgeGroup;
  totalFeedingMl: number;
  formulaMl: number;
  breastMl: number;
  supplementCount: number;
  coreMetrics: {
    vitaminD: NutrientIntakeItem;
    vitaminA?: NutrientIntakeItem;
    calcium: NutrientIntakeItem;
    iron: NutrientIntakeItem;
    zinc?: NutrientIntakeItem;
    dha?: NutrientIntakeItem;
    energy?: NutrientIntakeItem;
    protein?: NutrientIntakeItem;
  };
  allNutrients: NutrientIntakeItem[];
  alerts: Array<{
    type: 'warning' | 'danger' | 'info';
    nutrientId?: string;
    title: string;
    message: string;
  }>;
}

export interface ConflictCheckResult {
  hasConflict: boolean;
  warnings: string[];
  details: Array<{
    nutrientId: string;
    nutrientName: string;
    currentTotal: number;
    incomingAmount: number;
    projectedTotal: number;
    ul?: number;
    unit: string;
    isExceeded: boolean;
  }>;
}

export interface MultiDayTrendItem {
  date: string;
  formulaMl: number;
  breastMl: number;
  totalFeedingMl: number;
  vitaminD: number;
  vitaminA?: number;
  calcium: number;
  iron: number;
  zinc?: number;
  dha?: number;
}

export interface MultiDayNutritionSummary {
  startDate: string;
  endDate: string;
  daysCount: number;
  dailyTrends: MultiDayTrendItem[];
  averageIntakes: Record<string, {
    name: string;
    averageAmount: number;
    targetAmount?: number;
    unit: string;
    achievementRate?: number;
  }>;
}

// ─── OCR / Multimodal Extraction Result ─────────────────────────────────────
export interface ParsedNutritionLabel {
  type: 'formula' | 'supplement';
  brand: string;
  name: string;
  stage?: number;
  dosageForm?: string;
  unitName?: string;
  defaultDose?: number;
  scoopWeightG?: number;
  waterPerScoopMl?: number;
  reconstitutionRatio?: number;
  servingSizeUnit?: string;
  nutrients: NutrientsMap;
  rawOcrText?: string;
}
