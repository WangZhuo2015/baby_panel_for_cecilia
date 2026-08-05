"use client";

import { create } from "zustand";
import type {
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
} from "@/types";

interface BabyStore {
  // Data
  baby: Baby | null;
  feedingRecords: FeedingRecord[];
  sleepRecords: SleepRecord[];
  diaperRecords: DiaperRecord[];
  foodLogRecords: FoodLogRecord[];
  growthMeasurements: GrowthMeasurement[];
  dailySummary: DailySummary | null;
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

  // Actions - fetch from API
  fetchBaby: () => Promise<void>;
  saveBaby: (data: { nickname: string; birthDate: string; gender: string }) => Promise<void>;
  fetchFeedingRecords: (date?: string) => Promise<void>;
  fetchSleepRecords: () => Promise<void>;
  fetchDiaperRecords: () => Promise<void>;
  fetchFoodLogRecords: (date?: string) => Promise<void>;
  fetchGrowthMeasurements: () => Promise<void>;
  fetchDailySummary: (date?: string) => Promise<void>;
  fetchTimeline: (date?: string) => Promise<void>;
  fetchWeather: () => Promise<void>;
  fetchFoodItems: (status?: string) => Promise<void>;
  fetchFeedingGuidelines: () => Promise<void>;
  fetchFoodPlans: (date?: string) => Promise<void>;
  fetchBooks: (tab?: string) => Promise<void>;
  fetchVaccines: (regionCode?: string) => Promise<void>;
  fetchMilestones: (category?: string, month?: number) => Promise<void>;
  fetchWarningSigns: () => Promise<void>;
  fetchActivities: () => Promise<void>;
  fetchAiTips: () => Promise<void>;

  // Actions - update
  updateBook: (id: string, data: Partial<Book>) => Promise<void>;

  // Actions - create records
  addFeedingRecord: (record: Partial<FeedingRecord>) => Promise<void>;
  addSleepRecord: (record: Partial<SleepRecord>) => Promise<void>;
  addDiaperRecord: (record: Partial<DiaperRecord>) => Promise<void>;
  addFoodLogRecord: (record: Partial<FoodLogRecord>) => Promise<void>;
  addGrowthMeasurement: (measurement: Partial<GrowthMeasurement>) => Promise<void>;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json()
}

export const useBabyStore = create<BabyStore>((set) => ({
  // Initial state
  baby: null,
  feedingRecords: [],
  sleepRecords: [],
  diaperRecords: [],
  foodLogRecords: [],
  growthMeasurements: [],
  dailySummary: null,
  timeline: [],
  weather: null,
  foodItems: [],
  feedingGuidelines: [],
  foodPlans: [],
  books: [],
  vaccines: [],
  vaccineData: null,
  milestones: [],
  warningSigns: [],
  activities: [],
  aiTips: [],

  // ===== Fetch actions =====

  fetchBaby: async () => {
    try {
      const data = await request<Baby>("/api/baby");
      if (data) set({ baby: data });
    } catch (e) {
      console.error("Failed to fetch baby:", e);
    }
  },

  saveBaby: async (data) => {
    try {
      const existing = useBabyStore.getState().baby;
      const updated = await request<Baby>("/api/baby", {
        method: existing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      set({ baby: updated });
    } catch (e) {
      console.error("Failed to save baby:", e);
      throw e;
    }
  },

  fetchFeedingRecords: async (date?: string) => {
    try {
      const params = date ? `?date=${date}` : "";
      const data = await request<FeedingRecord[]>(`/api/records/feeding${params}`);
      set({ feedingRecords: data || [] });
    } catch (e) {
      console.error("Failed to fetch feeding records:", e);
    }
  },

  fetchSleepRecords: async () => {
    try {
      const data = await request<SleepRecord[]>("/api/records/sleep");
      set({ sleepRecords: data || [] });
    } catch (e) {
      console.error("Failed to fetch sleep records:", e);
    }
  },

  fetchDiaperRecords: async () => {
    try {
      const data = await request<DiaperRecord[]>("/api/records/diaper");
      set({ diaperRecords: data || [] });
    } catch (e) {
      console.error("Failed to fetch diaper records:", e);
    }
  },

  fetchFoodLogRecords: async (date?: string) => {
    try {
      const params = date ? `?date=${date}` : "";
      const data = await request<FoodLogRecord[]>(`/api/food/logs${params}`);
      set({ foodLogRecords: data || [] });
    } catch (e) {
      console.error("Failed to fetch food log records:", e);
    }
  },

  fetchGrowthMeasurements: async () => {
    try {
      const data = await request<GrowthMeasurement[]>("/api/growth");
      set({ growthMeasurements: data || [] });
    } catch (e) {
      console.error("Failed to fetch growth measurements:", e);
    }
  },

  fetchDailySummary: async (date?: string) => {
    try {
      const params = date ? `?date=${date}` : "";
      const data = await request<DailySummary>(`/api/records/daily-summary${params}`);
      set({ dailySummary: data });
    } catch (e) {
      console.error("Failed to fetch daily summary:", e);
    }
  },

  fetchTimeline: async (date?: string) => {
    try {
      const params = date ? `?date=${date}` : "";
      const data = await request<TimelineEntry[]>(`/api/records/timeline${params}`);
      set({ timeline: data || [] });
    } catch (e) {
      console.error("Failed to fetch timeline:", e);
    }
  },

  fetchWeather: async () => {
    try {
      const data = await request<WeatherData>("/api/weather");
      set({ weather: data });
    } catch (e) {
      console.error("Failed to fetch weather:", e);
    }
  },

  fetchFoodItems: async (status?: string) => {
    try {
      const params = status ? `?status=${status}` : "";
      const data = await request<FoodItem[]>(`/api/food/items${params}`);
      set({ foodItems: data || [] });
    } catch (e) {
      console.error("Failed to fetch food items:", e);
    }
  },

  fetchFeedingGuidelines: async () => {
    try {
      const data = await request<FeedingGuideline[]>("/api/food/feeding-guidelines");
      set({ feedingGuidelines: data || [] });
    } catch (e) {
      console.error("Failed to fetch feeding guidelines:", e);
    }
  },

  fetchFoodPlans: async (date?: string) => {
    try {
      const params = date ? `?date=${date}` : "";
      const data = await request<FoodPlan[]>(`/api/food/plans${params}`);
      set({ foodPlans: data || [] });
    } catch (e) {
      console.error("Failed to fetch food plans:", e);
    }
  },

  fetchBooks: async (tab?: string) => {
    try {
      const params = tab ? `?tab=${tab}` : "";
      const data = await request<Book[]>(`/api/books${params}`);
      set({ books: data || [] });
    } catch (e) {
      console.error("Failed to fetch books:", e);
    }
  },

  fetchVaccines: async (regionCode?: string) => {
    try {
      const params = regionCode ? `?regionCode=${regionCode}` : "";
      const data = await request<BabyStore["vaccineData"]>(`/api/vaccines${params}`);
      set({ vaccineData: data });
    } catch (e) {
      console.error("Failed to fetch vaccines:", e);
    }
  },

  fetchMilestones: async (category?: string, month?: number) => {
    try {
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (month) params.set("month", String(month));
      const qs = params.toString();
      const data = await request<{ milestones: DevelopmentMilestone[] }>(
        `/api/development/milestones${qs ? `?${qs}` : ""}`
      );
      set({ milestones: data?.milestones || [] });
    } catch (e) {
      console.error("Failed to fetch milestones:", e);
    }
  },

  fetchWarningSigns: async () => {
    try {
      const data = await request<DevelopmentWarningSign[]>(
        "/api/development/warning-signs"
      );
      set({ warningSigns: Array.isArray(data) ? data : [] });
    } catch (e) {
      console.error("Failed to fetch warning signs:", e);
    }
  },

  fetchActivities: async () => {
    try {
      const data = await request<ActivityRecommendation[]>(
        "/api/development/activities"
      );
      set({ activities: data || [] });
    } catch (e) {
      console.error("Failed to fetch activities:", e);
    }
  },

  fetchAiTips: async () => {
    try {
      const data = await request<string[]>("/api/ai/tips");
      set({ aiTips: Array.isArray(data) ? data : [] });
    } catch (e) {
      console.error("Failed to fetch AI tips:", e);
    }
  },

  // ===== Update actions =====

  updateBook: async (id, data) => {
    try {
      const updated = await request<Book>("/api/books", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...data }),
      });
      set((state) => ({
        books: state.books.map((b) => (b.id === id ? { ...b, ...updated } : b)),
      }));
    } catch (e) {
      console.error("Failed to update book:", e);
    }
  },

  // ===== Create actions =====

  addFeedingRecord: async (record) => {
    try {
      const newRecord = await request<FeedingRecord>("/api/records/feeding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record),
      });
      set((state) => ({
        feedingRecords: [newRecord, ...state.feedingRecords],
      }));
    } catch (e) {
      console.error("Failed to add feeding record:", e);
    }
  },

  addSleepRecord: async (record) => {
    try {
      const newRecord = await request<SleepRecord>("/api/records/sleep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record),
      });
      set((state) => ({
        sleepRecords: [newRecord, ...state.sleepRecords],
      }));
    } catch (e) {
      console.error("Failed to add sleep record:", e);
    }
  },

  addDiaperRecord: async (record) => {
    try {
      const newRecord = await request<DiaperRecord>("/api/records/diaper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record),
      });
      set((state) => ({
        diaperRecords: [newRecord, ...state.diaperRecords],
      }));
    } catch (e) {
      console.error("Failed to add diaper record:", e);
    }
  },

  addFoodLogRecord: async (record) => {
    try {
      const newRecord = await request<FoodLogRecord>("/api/food/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record),
      });
      set((state) => ({
        foodLogRecords: [newRecord, ...state.foodLogRecords],
      }));
    } catch (e) {
      console.error("Failed to add food log record:", e);
    }
  },

  addGrowthMeasurement: async (measurement) => {
    try {
      const newMeasurement = await request<GrowthMeasurement>("/api/growth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(measurement),
      });
      set((state) => ({
        growthMeasurements: [...state.growthMeasurements, newMeasurement].sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
        ),
      }));
    } catch (e) {
      console.error("Failed to add growth measurement:", e);
    }
  },
}));
