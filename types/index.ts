// ===== Baby Types =====
export interface Baby {
  id: string;
  nickname: string;
  gender: 'female' | 'male';
  birthDate: string; // ISO date
  avatarUrl?: string;
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
  // Formula
  amountMl?: number;
  // Breast
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
export type FoodAcceptance = 'loved' | 'liked' | 'neutral' | 'disliked' | 'rejected';
export type FoodStatus = 'tried' | 'to_try';

export interface FoodItem {
  id: string;
  name: string;
  icon: string;
  firstAddedDate?: string;
  acceptance: number; // 1-5
  status: FoodStatus;
  category?: string;
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
  acceptance: number; // 1-5
  babyState: 'happy' | 'neutral' | 'rejected';
  hasAbnormal: boolean;
  abnormalNotes?: string;
}

// ===== Development Types =====
export type DevelopmentCategory = 'gross_motor' | 'cognitive' | 'language' | 'fine_motor';

export interface DevelopmentMilestone {
  id: string;
  category: DevelopmentCategory;
  month: number;
  title: string;
  description: string;
  status: 'achieved' | 'practicing' | 'upcoming';
}

export interface ActivityRecommendation {
  id: string;
  title: string;
  tag: string;
  materials: string[];
  steps: string[];
}

// ===== Book Types =====
export interface Book {
  id: string;
  title: string;
  author: string;
  rating: number;
  readCount: number;
  isFavorite: boolean;
  coverColor: string;
  ageRange: string;
}

// ===== Vaccine Types =====
export interface VaccineRecord {
  id: string;
  name: string;
  dose: string;
  scheduledDate: string;
  completedDate?: string;
  isCompleted: boolean;
  countdownDays?: number;
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
