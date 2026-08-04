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
  FoodPlan,
  Book,
  VaccineRecord,
  DevelopmentMilestone,
  ActivityRecommendation,
  WeatherData,
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
  foodPlans: FoodPlan[];
  books: Book[];
  vaccines: VaccineRecord[];
  milestones: DevelopmentMilestone[];
  activities: ActivityRecommendation[];
  aiTips: string[];

  // Actions - fetch from API
  fetchBaby: () => Promise<void>;
  fetchFeedingRecords: (date?: string) => Promise<void>;
  fetchSleepRecords: () => Promise<void>;
  fetchDiaperRecords: () => Promise<void>;
  fetchFoodLogRecords: (date?: string) => Promise<void>;
  fetchGrowthMeasurements: () => Promise<void>;
  fetchDailySummary: (date?: string) => Promise<void>;
  fetchTimeline: (date?: string) => Promise<void>;
  fetchWeather: (city?: string) => Promise<void>;
  fetchFoodItems: (status?: string) => Promise<void>;
  fetchFoodPlans: (date?: string) => Promise<void>;
  fetchBooks: (tab?: string) => Promise<void>;
  fetchVaccines: () => Promise<void>;
  fetchMilestones: (category?: string, month?: number) => Promise<void>;
  fetchActivities: () => Promise<void>;
  fetchAiTips: () => Promise<void>;

  // Actions - update
  updateBook: (id: string, data: Partial<Book>) => Promise<void>;
  updateMilestone: (id: string, data: Partial<DevelopmentMilestone>) => Promise<void>;

  // Actions - create records
  addFeedingRecord: (record: Partial<FeedingRecord>) => Promise<void>;
  addSleepRecord: (record: Partial<SleepRecord>) => Promise<void>;
  addDiaperRecord: (record: Partial<DiaperRecord>) => Promise<void>;
  addFoodLogRecord: (record: Partial<FoodLogRecord>) => Promise<void>;
  addGrowthMeasurement: (measurement: Partial<GrowthMeasurement>) => Promise<void>;
}

export const useBabyStore = create<BabyStore>((set, get) => ({
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
  foodPlans: [],
  books: [],
  vaccines: [],
  milestones: [],
  activities: [],
  aiTips: [],

  // ===== Fetch actions =====

  fetchBaby: async () => {
    try {
      const res = await fetch("/api/baby");
      const data = await res.json();
      if (data) set({ baby: data });
    } catch (e) {
      console.error("Failed to fetch baby:", e);
    }
  },

  fetchFeedingRecords: async (date?: string) => {
    try {
      const params = date ? `?date=${date}` : "";
      const res = await fetch(`/api/records/feeding${params}`);
      const data = await res.json();
      set({ feedingRecords: data || [] });
    } catch (e) {
      console.error("Failed to fetch feeding records:", e);
    }
  },

  fetchSleepRecords: async () => {
    try {
      const res = await fetch("/api/records/sleep");
      const data = await res.json();
      set({ sleepRecords: data || [] });
    } catch (e) {
      console.error("Failed to fetch sleep records:", e);
    }
  },

  fetchDiaperRecords: async () => {
    try {
      const res = await fetch("/api/records/diaper");
      const data = await res.json();
      set({ diaperRecords: data || [] });
    } catch (e) {
      console.error("Failed to fetch diaper records:", e);
    }
  },

  fetchFoodLogRecords: async (date?: string) => {
    try {
      const params = date ? `?date=${date}` : "";
      const res = await fetch(`/api/records/food${params}`);
      const data = await res.json();
      set({ foodLogRecords: data || [] });
    } catch (e) {
      console.error("Failed to fetch food log records:", e);
    }
  },

  fetchGrowthMeasurements: async () => {
    try {
      const res = await fetch("/api/growth");
      const data = await res.json();
      set({ growthMeasurements: data || [] });
    } catch (e) {
      console.error("Failed to fetch growth measurements:", e);
    }
  },

  fetchDailySummary: async (date?: string) => {
    try {
      const params = date ? `?date=${date}` : "";
      const res = await fetch(`/api/records/daily-summary${params}`);
      const data = await res.json();
      set({ dailySummary: data });
    } catch (e) {
      console.error("Failed to fetch daily summary:", e);
    }
  },

  fetchTimeline: async (date?: string) => {
    try {
      const params = date ? `?date=${date}` : "";
      const res = await fetch(`/api/records/timeline${params}`);
      const data = await res.json();
      set({ timeline: data || [] });
    } catch (e) {
      console.error("Failed to fetch timeline:", e);
    }
  },

  fetchWeather: async (city?: string) => {
    try {
      const params = city ? `?city=${city}` : "";
      const res = await fetch(`/api/weather${params}`);
      const data = await res.json();
      set({ weather: data });
    } catch (e) {
      console.error("Failed to fetch weather:", e);
    }
  },

  fetchFoodItems: async (status?: string) => {
    try {
      const params = status ? `?status=${status}` : "";
      const res = await fetch(`/api/food/items${params}`);
      const data = await res.json();
      set({ foodItems: data || [] });
    } catch (e) {
      console.error("Failed to fetch food items:", e);
    }
  },

  fetchFoodPlans: async (date?: string) => {
    try {
      const params = date ? `?date=${date}` : "";
      const res = await fetch(`/api/food/plans${params}`);
      const data = await res.json();
      set({ foodPlans: data || [] });
    } catch (e) {
      console.error("Failed to fetch food plans:", e);
    }
  },

  fetchBooks: async (tab?: string) => {
    try {
      const params = tab ? `?tab=${tab}` : "";
      const res = await fetch(`/api/books${params}`);
      const data = await res.json();
      set({ books: data || [] });
    } catch (e) {
      console.error("Failed to fetch books:", e);
    }
  },

  fetchVaccines: async () => {
    try {
      const res = await fetch("/api/vaccines");
      const data = await res.json();
      set({ vaccines: data || [] });
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
      const res = await fetch(`/api/development/milestones${qs ? `?${qs}` : ""}`);
      const data = await res.json();
      set({ milestones: data || [] });
    } catch (e) {
      console.error("Failed to fetch milestones:", e);
    }
  },

  fetchActivities: async () => {
    try {
      const res = await fetch("/api/development/activities");
      const data = await res.json();
      set({ activities: data || [] });
    } catch (e) {
      console.error("Failed to fetch activities:", e);
    }
  },

  fetchAiTips: async () => {
    try {
      const res = await fetch("/api/ai/tips");
      const data = await res.json();
      set({ aiTips: data || [] });
    } catch (e) {
      console.error("Failed to fetch AI tips:", e);
    }
  },

  // ===== Update actions =====

  updateBook: async (id, data) => {
    try {
      const res = await fetch("/api/books", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...data }),
      });
      const updated = await res.json();
      set((state) => ({
        books: state.books.map((b) => (b.id === id ? { ...b, ...updated } : b)),
      }));
    } catch (e) {
      console.error("Failed to update book:", e);
    }
  },

  updateMilestone: async (id, data) => {
    try {
      const res = await fetch(`/api/development/milestones/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const updated = await res.json();
      set((state) => ({
        milestones: state.milestones.map((m) =>
          m.id === id ? { ...m, ...updated } : m
        ),
      }));
    } catch (e) {
      console.error("Failed to update milestone:", e);
    }
  },

  // ===== Create actions =====

  addFeedingRecord: async (record) => {
    try {
      const res = await fetch("/api/records/feeding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record),
      });
      const newRecord = await res.json();
      set((state) => ({
        feedingRecords: [newRecord, ...state.feedingRecords],
      }));
    } catch (e) {
      console.error("Failed to add feeding record:", e);
    }
  },

  addSleepRecord: async (record) => {
    try {
      const res = await fetch("/api/records/sleep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record),
      });
      const newRecord = await res.json();
      set((state) => ({
        sleepRecords: [newRecord, ...state.sleepRecords],
      }));
    } catch (e) {
      console.error("Failed to add sleep record:", e);
    }
  },

  addDiaperRecord: async (record) => {
    try {
      const res = await fetch("/api/records/diaper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record),
      });
      const newRecord = await res.json();
      set((state) => ({
        diaperRecords: [newRecord, ...state.diaperRecords],
      }));
    } catch (e) {
      console.error("Failed to add diaper record:", e);
    }
  },

  addFoodLogRecord: async (record) => {
    try {
      const res = await fetch("/api/records/food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record),
      });
      const newRecord = await res.json();
      set((state) => ({
        foodLogRecords: [newRecord, ...state.foodLogRecords],
      }));
    } catch (e) {
      console.error("Failed to add food log record:", e);
    }
  },

  addGrowthMeasurement: async (measurement) => {
    try {
      const res = await fetch("/api/growth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(measurement),
      });
      const newMeasurement = await res.json();
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
