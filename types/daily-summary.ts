export interface DailyFeedingDetail {
  id: string;
  time: string;
  type: string;
  typeName: string;
  amountMl?: number | null;
  leftMinutes?: number | null;
  rightMinutes?: number | null;
  spitUp: boolean;
  notes?: string | null;
}

export interface DailySleepDetail {
  id: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  type: "night" | "day";
  nightWakingCount: number;
  notes?: string | null;
}

export interface DailyDiaperDetail {
  id: string;
  time: string;
  type: "pee" | "poop" | "both";
  typeName: string;
  poopColor?: string | null;
  poopConsistency?: string | null;
  notes?: string | null;
}

export interface DailyFoodDetail {
  id: string;
  time: string;
  foods: string[];
  portion: string;
  acceptance: number;
  babyState: string;
  hasAbnormal: boolean;
  abnormalNotes?: string | null;
}

export interface DailySupplementDetail {
  id: string;
  time: string;
  name: string;
  brand?: string;
  dose: number;
  unitName?: string | null;
}

export interface DailyComprehensiveMetrics {
  date: string;
  totalFeedingMl: number;
  totalBreastMinutes: number;
  feedingCount: number;
  formulaCount: number;
  breastCount: number;
  spitUpCount: number;
  feedings: DailyFeedingDetail[];

  totalSleepMinutes: number;
  daySleepMinutes: number;
  nightSleepMinutes: number;
  nightWakingCount: number;
  sleepCount: number;
  sleeps: DailySleepDetail[];

  diaperCount: number;
  peeCount: number;
  poopCount: number;
  poopColors: string[];
  poopConsistencies: string[];
  diapers: DailyDiaperDetail[];

  foodCount: number;
  foodsTried: string[];
  foodLogs: DailyFoodDetail[];

  supplementsCount: number;
  supplements: DailySupplementDetail[];

  hasAbnormal: boolean;
  growthMeasurement?: {
    weightKg?: number | null;
    heightCm?: number | null;
    headCircumferenceCm?: number | null;
    percentile?: number | null;
  } | null;
  medicalReportsCount: number;
}

export interface AiDailySummarySections {
  feeding: string;        // 🍼 喂养与营养摄入评估
  sleep: string;          // 😴 作息与睡眠节律评估
  diaper: string;         // 💩 排便与肠胃舒适度
  growthAndCare: string;  // 📈 生长发育与补剂守护
  tomorrowTips: string;   // 💡 明日照护贴士与早教互动建议
}

export interface AiDailySummaryResult {
  date: string;
  babyId: string;
  babyName: string;
  babyAvatarUrl?: string | null;
  babyAgeLabel: string;
  isPreterm: boolean;
  correctedAgeLabel?: string;
  overallScore: string; // e.g. "作息规律 🌟" | "状态极佳 ✨" | "平稳达标 👍"
  overallRating: number; // 1 to 5
  statusLevel: "excellent" | "good" | "attention";
  headline: string; // 1-sentence warm summary
  highlights: string[]; // 2-4 highlight tags
  sections: AiDailySummarySections;
  suggestedQuestions: string[]; // 3-4 interactive questions for AI chat
  metrics: DailyComprehensiveMetrics;
  disclaimer: string;
  isAiGenerated: boolean;
  generatedAt: string;
}
