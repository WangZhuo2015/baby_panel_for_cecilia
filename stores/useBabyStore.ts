"use client";

import { create } from "zustand";
import { createAuthSlice } from "./slices/auth";
import { createRecordsSlice } from "./slices/records";
import { createGrowthSlice } from "./slices/growth";
import { setOnUnauthorized as setHelperOnUnauthorized } from "./slices/helpers";
import { invalidateCache } from "@/lib/fetch-cache";
export { invalidateCache } from "@/lib/fetch-cache";
export { isAuthError } from "./slices/helpers";
import type {
  User,
  Family,
  FamilyMember,
  BabyMember,
  Baby,
  FeedingRecord,
  SleepRecord,
  DiaperRecord,
  FoodLogRecord,
  GrowthMeasurement,
  DailySummary,
  TimelineEntry,
  FoodItem,
  FeedingGuideline,
  FoodPlan,
  Book,
  Vaccine,
  VaccineStrategyGroup,
  VaccineScheduleEntry,
  ScheduleEngineRule,
  VaccineRecord,
  DevelopmentMilestone,
  DevelopmentWarningSign,
  ActivityRecommendation,
  WeatherData,
  DataRelease,
  MedicalReport,
  AiDailySummaryResult,
} from "@/types";

interface BabyStore {
  user: User | null;
  family: Family | null;
  familyMembers: FamilyMember[];
  babyMembers: BabyMember[];
  babyMembersSupported: boolean;
  families: Family[];
  babies: Baby[];
  selectedBabyId: string | null;
  authLoading: boolean;
  baby: Baby | null;
  medicalReports: MedicalReport[];
  feedingRecords: FeedingRecord[];
  sleepRecords: SleepRecord[];
  diaperRecords: DiaperRecord[];
  foodLogRecords: FoodLogRecord[];
  growthMeasurements: GrowthMeasurement[];
  dailySummary: DailySummary | null;
  aiDailySummary: AiDailySummaryResult | null;
  aiDailySummaryLoading: boolean;
  aiDailySummaryError: string | null;
  timeline: TimelineEntry[];
  weather: WeatherData | null;
  foodItems: FoodItem[];
  feedingGuidelines: FeedingGuideline[];
  foodPlans: FoodPlan[];
  books: Book[];
  vaccines: VaccineRecord[];
  vaccineData: {
    national: Vaccine[];
    nonProgram: Vaccine[];
    provincial: Vaccine[];
    strategyGroups: VaccineStrategyGroup[];
    schedule: VaccineScheduleEntry[];
    engineRules: ScheduleEngineRule[];
    dataRelease: DataRelease | null;
  } | null;
  milestones: DevelopmentMilestone[];
  warningSigns: DevelopmentWarningSign[];
  activities: ActivityRecommendation[];
  aiTips: string[];
  aiError: string | null;
  fetchUser: () => Promise<User | null>;
  login: (data: { username: string; password: string }) => Promise<void>;
  register: (data: { username: string; password: string; displayName?: string; inviteCode?: string; relation?: string }) => Promise<void>;
  logout: () => Promise<void>;
  joinFamily: (inviteCode: string, relation?: string) => Promise<{ message?: string }>;
  fetchFamilyMembers: () => Promise<void>;
  fetchBabyMembers: (babyId: string) => Promise<void>;
  grantBabyMember: (babyId: string, userId: string, role?: BabyMember["role"]) => Promise<void>;
  revokeBabyMember: (babyId: string, userId: string) => Promise<void>;
  selectBaby: (babyId: string) => Promise<void>;
  createFamilyInvite: (expiresInDays?: number) => Promise<{ inviteCode: string; expiresAt: string }>;
  fetchBaby: (force?: boolean) => Promise<void>;
  saveBaby: (data: { nickname: string; birthDate: string; gender: string; familyId?: string; gestationalAge?: number; gestationalDays?: number; avatarUrl?: string | null }) => Promise<void>;
  fetchFeedingRecords: (date?: string, force?: boolean) => Promise<void>;
  fetchSleepRecords: (force?: boolean) => Promise<void>;
  fetchDiaperRecords: (force?: boolean) => Promise<void>;
  fetchFoodLogRecords: (date?: string, force?: boolean) => Promise<void>;
  fetchGrowthMeasurements: (force?: boolean) => Promise<void>;
  fetchDailySummary: (date?: string, force?: boolean) => Promise<void>;
  fetchAiDailySummary: (date?: string, force?: boolean) => Promise<AiDailySummaryResult | null>;
  fetchTimeline: (date?: string, force?: boolean) => Promise<void>;
  fetchWeather: (lat?: number, lon?: number, city?: string, force?: boolean) => Promise<void>;
  fetchFoodItems: (status?: string, force?: boolean) => Promise<void>;
  fetchFeedingGuidelines: (force?: boolean) => Promise<void>;
  fetchFoodPlans: (date?: string, force?: boolean) => Promise<void>;
  fetchBooks: (tab?: string, force?: boolean) => Promise<void>;
  fetchVaccines: (regionCode?: string, force?: boolean) => Promise<void>;
  fetchMilestones: (category?: string, month?: number, force?: boolean) => Promise<void>;
  fetchWarningSigns: (force?: boolean) => Promise<void>;
  fetchActivities: (force?: boolean) => Promise<void>;
  fetchAiTips: (force?: boolean) => Promise<void>;
  fetchMedicalReports: (category?: string, force?: boolean) => Promise<void>;
  invalidateCache: (prefix?: string) => void;
  refreshAll: (date?: string) => Promise<void>;
  pollActiveData: (date?: string) => Promise<void>;
  updateBook: (id: string, data: Partial<Book>) => Promise<void>;
  addFeedingRecord: (record: Partial<FeedingRecord>) => Promise<void>;
  addSleepRecord: (record: Partial<SleepRecord>) => Promise<void>;
  addDiaperRecord: (record: Partial<DiaperRecord>) => Promise<void>;
  addFoodLogRecord: (record: Partial<FoodLogRecord>) => Promise<void>;
  addGrowthMeasurement: (measurement: Partial<GrowthMeasurement>) => Promise<void>;
  deleteGrowthMeasurement: (id: string) => Promise<void>;
  addMedicalReport: (report: Partial<MedicalReport> & { growthData?: any }) => Promise<MedicalReport>;
  deleteMedicalReport: (id: string) => Promise<void>;
  updateTimelineRecord: (type: TimelineEntry['type'], id: string, patch: Record<string, unknown>) => Promise<void>;
  deleteTimelineRecord: (type: TimelineEntry['type'], id: string) => Promise<void>;
}

// Re-export for external callers that previously imported from useBabyStore
export function setOnUnauthorized(handler: () => void) {
  setHelperOnUnauthorized(handler);
}

export const useBabyStore = create<BabyStore>((set, get) => ({
  ...createAuthSlice(set as any, get as any),
  ...createRecordsSlice(set as any, get as any),
  ...createGrowthSlice(set as any, get as any),
  invalidateCache: (prefix?: string) => invalidateCache(prefix),
  // refreshAll is already from records slice; growth slice doesn't override.
}));

// ===== 离线快照：按账号命名空间与过期策略隔离，避免跨用户恢复 =====
export const SNAPSHOT_KEY_PREFIX = "baby-panel-snapshot-v2:";
export const SNAPSHOT_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 天过期

export interface StoreSnapshot {
  userId: string;
  user: unknown;
  family: unknown;
  baby: unknown;
  dailySummary: unknown;
  timeline: unknown;
  savedAt: number;
  version: 2;
}

export function saveSnapshot(userId: string, state: { user: unknown; family: unknown; baby: unknown; dailySummary: unknown; timeline: unknown }): void {
  try {
    const payload: StoreSnapshot = {
      userId,
      user: state.user,
      family: state.family,
      baby: state.baby,
      dailySummary: state.dailySummary,
      timeline: state.timeline,
      savedAt: Date.now(),
      version: 2,
    };
    localStorage.setItem(`${SNAPSHOT_KEY_PREFIX}${userId}`, JSON.stringify(payload));
    try { localStorage.removeItem("baby-panel-snapshot-v1"); } catch {}
  } catch {}
}

if (typeof window !== "undefined") {
  let snapshotTimer: ReturnType<typeof setTimeout> | undefined;
  useBabyStore.subscribe((state) => {
    if (snapshotTimer) clearTimeout(snapshotTimer);
    snapshotTimer = setTimeout(() => {
      const u = state.user as { id?: string } | null;
      if (u?.id) {
        saveSnapshot(u.id, {
          user: state.user,
          family: state.family,
          baby: state.baby,
          dailySummary: state.dailySummary,
          timeline: state.timeline,
        });
      }
    }, 500);
  });
}

setHelperOnUnauthorized(() => {
  const state = useBabyStore.getState();
  if (state.user) {
    useBabyStore.setState({ user: null, family: null, families: [], babies: [], selectedBabyId: null, familyMembers: [], babyMembers: [], babyMembersSupported: false, baby: null, authLoading: false } as any);
  }
});
