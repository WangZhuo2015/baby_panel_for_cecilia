// ===== User & Family Types =====
export interface User {
  id: string;
  username: string;
  displayName: string;
}

export interface Family {
  id: string;
  name: string;
  inviteCode: string;
}

export interface FamilyMember {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  role: string;
  relation: string;
  joinedAt: string;
}

// ===== Baby Types =====
export interface Baby {
  id: string;
  familyId?: string;
  nickname: string;
  gender: 'female' | 'male';
  birthDate: string; // ISO date
  avatarUrl?: string;
  gestationalAge?: number; // weeks at birth, for preterm correction
}

// ===== Record Types =====
export type FeedingType = 'breast' | 'formula' | 'mixed';
export type SleepType = 'night' | 'day';
export type DiaperType = 'pee' | 'poop' | 'both';
export type PoopColor = 'yellow' | 'green' | 'brown' | 'other';
export type PoopConsistency = 'loose' | 'paste' | 'formed';

export interface FeedingRecord {
  id: string;
  timestamp: string;
  type: FeedingType;
  amountMl?: number;
  leftMinutes?: number;
  rightMinutes?: number;
  spitUp: boolean;
  notes?: string;
}

export interface SleepRecord {
  id: string;
  startTime: string;
  endTime: string;
  type: SleepType;
  nightWakingCount: number;
  notes?: string;
}

export interface DiaperRecord {
  id: string;
  timestamp: string;
  type: DiaperType;
  poopColor?: PoopColor;
  poopConsistency?: PoopConsistency;
  notes?: string;
}

// ===== Growth Types =====
export interface GrowthMeasurement {
  id: string;
  date: string;
  ageInMonths: number;
  ageLabel: string;
  weightKg?: number;
  heightCm?: number;
  headCircumferenceCm?: number;
  percentile?: number;
}

// ===== Food Types =====
export type FoodStatus = 'tried' | 'to_try';

export interface FoodItem {
  id: string;
  foodId: string;
  name: string;
  icon: string;
  category: string;
  foodGroup?: string;
  firstAddedDate?: string;
  acceptance: number;
  status: FoodStatus;
  recommendedFromMonth?: number | null;
  recommendedToMonth?: number | null;
  exactMonthEvidence: boolean;
  guidance?: string;
  isCommonAllergen?: boolean | null;
  allergenIntroductionGuidance?: string | null;
  highRiskInfantNeedsMedicalAdvice?: boolean | null;
  chokingRisk: boolean;
  chokingNotes?: string | null;
  preparation: string[];
  avoidBeforeMonths?: number | null;
  nutrition: string[];
  textureByAge: Array<{ ageMinMonths: number; ageMaxMonths: number; texture: string }>;
  notes?: string | null;
  sourceRefs: string[];
}

export interface FeedingGuideline {
  id: string;
  ageMinMonths: number;
  ageMaxMonths: number;
  mealFrequency?: string | null;
  milkGuidance?: string | null;
  texture: string[];
  foodDiversity: string[];
  responsiveFeeding: string[];
  safety: string[];
  sourceRefs: string[];
}

export interface FoodPlan {
  id: string;
  date: string;
  name: string;
  tags: string[];
  nutrition: string;
  ingredients: string[];
  steps: string[];
}

export interface FoodLogRecord {
  id: string;
  date: string;
  time: string;
  foods: string[];
  portion: 'little' | 'half' | 'most' | 'all';
  acceptance: number;
  babyState: 'happy' | 'neutral' | 'rejected';
  hasAbnormal: boolean;
  abnormalNotes?: string;
}

// ===== Development Types =====
export type DevelopmentCategory = 'gross_motor' | 'cognitive' | 'language' | 'fine_motor' | 'social_emotional';

export interface DevelopmentMilestone {
  id: string;
  milestoneId: string;
  category: DevelopmentCategory;
  originalDomain?: string;
  title: string;
  description: string;
  assessmentAgeMonths: number;
  ageRangeEarliestMonth?: number | null;
  ageRangeMedianMonth?: number | null;
  ageRangeLatestMonth?: number | null;
  criterionType?: string;
  criterionThreshold?: string;
  criterionDescription?: string;
  observationMethod?: string;
  requiresProfessionalAssessment: boolean;
  sourceSystem?: string;
  sourceRefs: string[];
}

export interface DevelopmentWarningSign {
  id: string;
  warningSignId: string;
  ageMonths: number;
  category: string;
  description: string;
  recommendedAction: string;
  urgency: string;
  sourceRefs: string[];
}

export interface ActivityRecommendation {
  id: string;
  activityId: string;
  title: string;
  categories: string[];
  ageMinMonths?: number | null;
  ageMaxMonths?: number | null;
  developmentGoals: string[];
  materials: string[];
  steps: Array<{ order: number; instruction: string }>;
  targetMonthMin?: number | null;
  targetMonthMax?: number | null;
  goal?: string;
  durationMinutes?: number | null;
  frequency?: string | null;
  difficulty?: string;
  supervision?: string;
  safety: string[];
  stopConditions: string[];
  evidenceType?: string;
  medicalTreatment: boolean;
  notes?: string | null;
  sourceRefs: string[];
}

// ===== Book Types =====
export interface Book {
  id: string;
  bookId: string;
  title: string;
  originalTitle?: string;
  author: string[];
  illustrator?: string[];
  translator?: string[];
  publisher?: string;
  isbn?: string;
  editionYear?: number;
  language?: string;
  origin?: string;
  ageMinMonths?: number | null;
  ageMaxMonths?: number | null;
  categories: string[];
  bookFormat?: string;
  description?: string;
  interactionSuggestions?: string[];
  whyAgeAppropriate?: string;
  readCount: number;
  isFavorite: boolean;
  ratingScore?: number | null;
  ratingCount?: number | null;
  ratingSource?: string | null;
  ratingRetrievedDate?: string | null;
  coverColor?: string | null;
  sourceRefs: string[];
}

// ===== Vaccine Types =====
export type ProgramType = 'national_immunization_program' | 'non_program' | 'provincial_immunization_program';

export interface VaccineDose {
  id: string;
  doseNumber: number;
  doseLabel: string;
  recommendedAgeMonths?: number | null;
  minimumAgeDays?: number | null;
  maximumAgeDays?: number | null;
  recommendedAgeMaxMonths?: number | null;
  minimumIntervalDaysFromPrevious?: number | null;
  maximumIntervalDaysFromPrevious?: number | null;
  route?: string;
  site?: string;
  doseVolumeMl?: number;
  notes?: string;
  sourceRefs: string[];
}

export interface Vaccine {
  id: string;
  vaccineId: string;
  name: string;
  shortName: string;
  englishName?: string;
  programType: ProgramType;
  legacyLabel?: string;
  sexRestriction: string;
  chinaNational: boolean;
  diseases: string[];
  targetPopulation?: string;
  policyEffectiveDate?: string;
  policyVersion?: string;
  routineHealthyChildOption: boolean;
  manualReviewRequired: boolean;
  marketStatus?: string;
  productBrandName?: string;
  productManufacturer?: string;
  productApprovalNumber?: string;
  jiangsuNotes?: string;
  suzhouNotes?: string;
  catchUpSupported: boolean;
  catchUpRules: string[];
  simultaneousVaccination?: string;
  substitutionRules: string[];
  contraindications: string[];
  precautions: string[];
  specialPopulations: string[];
  regionalOverrides: RegionalOverride[];
  regimenOptions: any[];
  sourceRefsJson: string[];
  doses: VaccineDose[];
  // Applied after regional override
  feeType?: string;
  regionalOverride?: RegionalOverride;
}

export interface RegionalOverride {
  regionCode: string;
  regionName: string;
  programType: string;
  feeType: string;
  effectiveDate: string;
  sourceRefs: string[];
}

export interface VaccineStrategyGroup {
  id: string;
  strategyId: string;
  name: string;
  scope?: string;
  baseProgram?: string;
  optionsJson: any[];
  sourceRefsJson: string[];
}

export interface VaccineScheduleEntry {
  id: string;
  ageMonths?: number;
  ageDays?: number;
  ageLabel?: string;
  vaccineId: string;
  doseNumber: number;
  priority: string;
  isOptional: boolean;
  action?: string;
  selectionGroup?: string;
  notes?: string;
  sourceRefs: string[];
}

export interface ScheduleEngineRule {
  id: string;
  ruleId: string;
  type: string;
  vaccineIds: string[];
  description: string;
  sourceRefs: string[];
}

export interface VaccineRecord {
  id: string;
  name: string;
  dose: string;
  scheduledDate: string;
  completedDate?: string;
  isCompleted: boolean;
  countdownDays?: number;
}

// ===== Data Version Types =====
export interface DataRelease {
  id: string;
  title: string;
  asOf: string;
  sources: SourceRef[];
}

export interface SourceRef {
  id: string;
  sourceId: string;
  title: string;
  organization: string;
  year?: number;
  publicationDate?: string;
  url?: string;
  sourceLevel?: string;
  sourceType?: string;
  accessedDate?: string;
  notes?: string;
}

// ===== Weather Types =====
export interface WeatherData {
  city: string;
  temperature: number;
  condition: string;
  uv: number;
  rainProbability: number;
  humidity: number;
  airQuality: string;
  outdoorAdvice: string;
  hourlyForecast: HourlyForecast[];
}

export interface HourlyForecast {
  time: string;
  temperature: number;
  condition: string;
}

// ===== Timeline Types =====
export interface TimelineEntry {
  id: string;
  time: string;
  type: 'feeding' | 'sleep' | 'diaper' | 'food';
  title: string;
  detail?: string;
  icon: string;
}

// ===== Daily Summary =====
export interface DailySummary {
  totalFeedingMl: number;
  totalSleepMinutes: number;
  diaperCount: number;
  foodCount: number;
}
