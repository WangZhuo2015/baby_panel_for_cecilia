"use client";

import { create } from "zustand";
import type {
  User,
  Family,
  FamilyMember,
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
} from "@/types";

interface BabyStore {
  // Auth & Family
  user: User | null;
  family: Family | null;
  familyMembers: FamilyMember[];
  authLoading: boolean;

  // Data
  baby: Baby | null;
  medicalReports: MedicalReport[];
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
  aiError: string | null;

  // Actions - Auth
  fetchUser: () => Promise<User | null>;
  login: (data: { username: string; password: string }) => Promise<void>;
  register: (data: {
    username: string;
    password: string;
    displayName?: string;
    inviteCode?: string;
    relation?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  joinFamily: (inviteCode: string, relation?: string) => Promise<void>;
  fetchFamilyMembers: () => Promise<void>;

  // Actions - fetch from API
  fetchBaby: () => Promise<void>;
  saveBaby: (data: { nickname: string; birthDate: string; gender: string; gestationalAge?: number; avatarUrl?: string }) => Promise<void>;
  fetchFeedingRecords: (date?: string) => Promise<void>;
  fetchSleepRecords: () => Promise<void>;
  fetchDiaperRecords: () => Promise<void>;
  fetchFoodLogRecords: (date?: string) => Promise<void>;
  fetchGrowthMeasurements: () => Promise<void>;
  fetchDailySummary: (date?: string) => Promise<void>;
  fetchTimeline: (date?: string) => Promise<void>;
  fetchWeather: (lat?: number, lon?: number, city?: string) => Promise<void>;
  fetchFoodItems: (status?: string) => Promise<void>;
  fetchFeedingGuidelines: () => Promise<void>;
  fetchFoodPlans: (date?: string) => Promise<void>;
  fetchBooks: (tab?: string) => Promise<void>;
  fetchVaccines: (regionCode?: string) => Promise<void>;
  fetchMilestones: (category?: string, month?: number) => Promise<void>;
  fetchWarningSigns: () => Promise<void>;
  fetchActivities: () => Promise<void>;
  fetchAiTips: () => Promise<void>;
  fetchMedicalReports: (category?: string) => Promise<void>;

  // Actions - update
  updateBook: (id: string, data: Partial<Book>) => Promise<void>;

  // Actions - create records
  addFeedingRecord: (record: Partial<FeedingRecord>) => Promise<void>;
  addSleepRecord: (record: Partial<SleepRecord>) => Promise<void>;
  addDiaperRecord: (record: Partial<DiaperRecord>) => Promise<void>;
  addFoodLogRecord: (record: Partial<FoodLogRecord>) => Promise<void>;
  addGrowthMeasurement: (measurement: Partial<GrowthMeasurement>) => Promise<void>;
  addMedicalReport: (report: Partial<MedicalReport> & { growthData?: any }) => Promise<MedicalReport>;
  deleteMedicalReport: (id: string) => Promise<void>;
}

type UnauthorizedHandler = () => void;
let _onUnauthorized: UnauthorizedHandler | null = null;

export function setOnUnauthorized(handler: UnauthorizedHandler) {
  _onUnauthorized = handler;
}

class AuthError extends Error {
  constructor(message: string = "Unauthorized") {
    super(message);
    this.name = "AuthError";
    Object.setPrototypeOf(this, AuthError.prototype);
  }
}

export function isAuthError(e: any): boolean {
  return e?.name === "AuthError" || e instanceof AuthError;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    if (res.status === 401) {
      if (_onUnauthorized) {
        _onUnauthorized();
      }
      throw new AuthError("Unauthorized");
    }
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return res.json();
}




/* ── Fetch caching / deduplication ────────────────────────── */
const STALE_MS = 30_000; // 30 seconds before data is considered stale
const _fetchedAt: Record<string, number> = {};
const _inflight: Record<string, Promise<void> | undefined> = {};

/** Returns true if the key was fetched less than STALE_MS ago */
function isFresh(key: string): boolean {
  return Date.now() - (_fetchedAt[key] || 0) < STALE_MS;
}

/** Mark a key as freshly fetched */
function markFetched(key: string): void {
  _fetchedAt[key] = Date.now();
}

/** Explicitly invalidate cache keys */
function invalidateCache(prefix?: string): void {
  if (!prefix) {
    for (const k in _fetchedAt) delete _fetchedAt[k];
    return;
  }
  for (const k in _fetchedAt) {
    if (k === prefix || k.startsWith(`${prefix}:`)) {
      delete _fetchedAt[k];
    }
  }
}

/** Deduplicate: if an identical request is already in-flight, return it */
function dedup(key: string, fn: () => Promise<void>): Promise<void> {
  if (_inflight[key]) return _inflight[key]!;
  const p = fn().finally(() => { _inflight[key] = undefined; });
  _inflight[key] = p;
  return p;
}


export const useBabyStore = create<BabyStore>((set, get) => ({
  // Initial state
  user: null,
  family: null,
  familyMembers: [],
  authLoading: true,

  baby: null,
  medicalReports: [],
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
  aiError: null,

  // ===== Auth Actions =====

  fetchUser: async () => {
    if (isFresh("user")) {
      set({ authLoading: false });
      return get().user;
    }
    return dedup("user", async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (!res.ok) {
          set({ user: null, family: null, baby: null, authLoading: false });
          markFetched("user");
          return;
        }
        const data = await res.json();
        set({
          user: data.user || null,
          family: data.family || null,
          baby: data.baby || (data.user ? get().baby : null),
          authLoading: false,
        });
        markFetched("user");
      } catch {
        set({ user: null, family: null, baby: null, authLoading: false });
        markFetched("user");
      }
    }).then(() => get().user);
  },



  login: async (credentials) => {
    const data = await request<{ user: User; family: Family; baby: Baby | null }>("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    });
    set({
      user: data.user,
      family: data.family,
      baby: data.baby,
    });
  },

  register: async (registerData) => {
    const data = await request<{ user: User; family: Family; baby: Baby | null }>("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(registerData),
    });
    set({
      user: data.user,
      family: data.family,
      baby: data.baby,
    });
  },

  logout: async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      invalidateCache();
      set({
        user: null,
        family: null,
        familyMembers: [],
        baby: null,
        medicalReports: [],
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
        aiError: null,
        authLoading: false,
      });
    }
  },


  joinFamily: async (inviteCode: string, relation?: string) => {
    const data = await request<{ message: string; family: Family; baby: Baby | null }>("/api/family/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteCode, relation }),
    });
    set({
      family: data.family,
      baby: data.baby,
    });
    get().fetchFamilyMembers();
  },

  fetchFamilyMembers: async () => {
    try {
      const data = await request<{ family: Family; members: FamilyMember[] }>("/api/family/members");
      set({
        family: data.family,
        familyMembers: data.members || [],
      });
    } catch (e) {
      if (!isAuthError(e)) console.error("Failed to fetch family members:", e);
    }
  },

  // ===== Fetch actions =====

  fetchBaby: async () => {
    if (!get().user && !get().authLoading) return;
    if (get().baby && isFresh('baby')) return;
    return dedup('baby', async () => {
      try {
        const data = await request<Baby>("/api/baby");
        if (data) set({ baby: data });
        markFetched('baby');
      } catch (e) {
        if (!isAuthError(e)) console.error("Failed to fetch baby:", e);
      }
    });
  },

  saveBaby: async (data) => {
    try {
      const existing = get().baby;
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
    if (!get().user && !get().authLoading) return;
    const key = `feedingRecords:${date || ''}`;
    if (get().feedingRecords.length > 0 && isFresh(key)) return;
    return dedup(key, async () => {
      try {
        const params = date ? `?date=${date}` : "";
        const data = await request<FeedingRecord[]>(`/api/records/feeding${params}`);
        set({ feedingRecords: data || [] });
        markFetched(key);
      } catch (e) {
        if (!isAuthError(e)) console.error("Failed to fetch feeding records:", e);
      }
    });
  },

  fetchSleepRecords: async () => {
    if (!get().user && !get().authLoading) return;
    if (get().sleepRecords.length > 0 && isFresh('sleepRecords')) return;
    return dedup('sleepRecords', async () => {
      try {
        const data = await request<SleepRecord[]>("/api/records/sleep");
        set({ sleepRecords: data || [] });
        markFetched('sleepRecords');
      } catch (e) {
        if (!isAuthError(e)) console.error("Failed to fetch sleep records:", e);
      }
    });
  },

  fetchDiaperRecords: async () => {
    if (!get().user && !get().authLoading) return;
    if (get().diaperRecords.length > 0 && isFresh('diaperRecords')) return;
    return dedup('diaperRecords', async () => {
      try {
        const data = await request<DiaperRecord[]>("/api/records/diaper");
        set({ diaperRecords: data || [] });
        markFetched('diaperRecords');
      } catch (e) {
        if (!isAuthError(e)) console.error("Failed to fetch diaper records:", e);
      }
    });
  },

  fetchFoodLogRecords: async (date?: string) => {
    if (!get().user && !get().authLoading) return;
    try {
      const params = date ? `?date=${date}` : "";
      const data = await request<FoodLogRecord[]>(`/api/food/logs${params}`);
      set({ foodLogRecords: data || [] });
    } catch (e) {
      if (!isAuthError(e)) console.error("Failed to fetch food log records:", e);
    }
  },

  fetchGrowthMeasurements: async () => {
    if (!get().user && !get().authLoading) return;
    if (get().growthMeasurements.length > 0 && isFresh('growthMeasurements')) return;
    return dedup('growthMeasurements', async () => {
      try {
        const data = await request<GrowthMeasurement[]>("/api/growth");
        set({ growthMeasurements: data || [] });
        markFetched('growthMeasurements');
      } catch (e) {
        if (!isAuthError(e)) console.error("Failed to fetch growth measurements:", e);
      }
    });
  },

  fetchDailySummary: async (date?: string) => {
    if (!get().user && !get().authLoading) return;
    const key = `dailySummary:${date || ''}`;
    if (get().dailySummary && isFresh(key)) return;
    return dedup(key, async () => {
      try {
        const params = date ? `?date=${date}` : "";
        const data = await request<DailySummary>(`/api/records/daily-summary${params}`);
        set({ dailySummary: data });
        markFetched(key);
      } catch (e) {
        if (!isAuthError(e)) console.error("Failed to fetch daily summary:", e);
      }
    });
  },

  fetchTimeline: async (date?: string) => {
    if (!get().user && !get().authLoading) return;

    const key = `timeline:${date || ''}`;
    if (get().timeline.length > 0 && isFresh(key)) return;
    return dedup(key, async () => {
      try {
        const params = date ? `?date=${date}` : "";
        const data = await request<TimelineEntry[]>(`/api/records/timeline${params}`);
        set({ timeline: data || [] });
        markFetched(key);
      } catch (e) {
        if (!isAuthError(e)) console.error("Failed to fetch timeline:", e);
      }
    });
  },

  fetchWeather: async (lat?: number, lon?: number, city?: string) => {
    // Weather changes slowly — cache for 5 minutes
    if (get().weather && Date.now() - (_fetchedAt['weather'] || 0) < 300_000) return;
    return dedup('weather', async () => {
      try {
        let finalLat = lat;
        let finalLon = lon;

        // Try browser geolocation if not provided
        if (finalLat === undefined && typeof window !== "undefined" && "geolocation" in navigator) {
          try {
            const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
              navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 3000 });
            });
            finalLat = pos.coords.latitude;
            finalLon = pos.coords.longitude;
          } catch {
            // Geolocation denied or timed out, fallback to defaults
          }
        }

        const params = new URLSearchParams();
        if (finalLat !== undefined) params.set("lat", String(finalLat));
        if (finalLon !== undefined) params.set("lon", String(finalLon));
        if (city) params.set("city", city);

        const qs = params.toString();
        const data = await request<WeatherData>(`/api/weather${qs ? `?${qs}` : ""}`);
        set({ weather: data });
        markFetched('weather');
      } catch (e) {
        if (!isAuthError(e)) console.error("Failed to fetch weather:", e);
      }
    });
  },

  fetchFoodItems: async (status?: string) => {
    try {
      const params = status ? `?status=${status}` : "";
      const data = await request<FoodItem[]>(`/api/food/items${params}`);
      set({ foodItems: data || [] });
    } catch (e) {
      if (!isAuthError(e)) console.error("Failed to fetch food items:", e);
    }
  },

  fetchFeedingGuidelines: async () => {
    try {
      const data = await request<FeedingGuideline[]>("/api/food/feeding-guidelines");
      set({ feedingGuidelines: data || [] });
    } catch (e) {
      if (!isAuthError(e)) console.error("Failed to fetch feeding guidelines:", e);
    }
  },

  fetchFoodPlans: async (date?: string) => {
    try {
      const params = date ? `?date=${date}` : "";
      const data = await request<FoodPlan[]>(`/api/food/plans${params}`);
      set({ foodPlans: data || [] });
    } catch (e) {
      if (!isAuthError(e)) console.error("Failed to fetch food plans:", e);
    }
  },

  fetchBooks: async (tab?: string) => {
    try {
      const params = tab ? `?tab=${tab}` : "";
      const data = await request<Book[]>(`/api/books${params}`);
      set({ books: data || [] });
    } catch (e) {
      if (!isAuthError(e)) console.error("Failed to fetch books:", e);
    }
  },

  fetchVaccines: async (regionCode?: string) => {
    try {
      const params = regionCode ? `?regionCode=${regionCode}` : "";
      const data = await request<BabyStore["vaccineData"]>(`/api/vaccines${params}`);
      set({ vaccineData: data });
    } catch (e) {
      if (!isAuthError(e)) console.error("Failed to fetch vaccines:", e);
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
      if (!isAuthError(e)) console.error("Failed to fetch milestones:", e);
    }
  },

  fetchWarningSigns: async () => {
    try {
      const data = await request<DevelopmentWarningSign[]>(
        "/api/development/warning-signs"
      );
      set({ warningSigns: Array.isArray(data) ? data : [] });
    } catch (e) {
      if (!isAuthError(e)) console.error("Failed to fetch warning signs:", e);
    }
  },

  fetchActivities: async () => {
    try {
      const data = await request<ActivityRecommendation[]>(
        "/api/development/activities"
      );
      set({ activities: data || [] });
    } catch (e) {
      if (!isAuthError(e)) console.error("Failed to fetch activities:", e);
    }
  },

  fetchAiTips: async () => {
    // AI tips are expensive — cache for 2 minutes
    if (get().aiTips.length > 0 && !get().aiError && Date.now() - (_fetchedAt['aiTips'] || 0) < 120_000) return;
    return dedup('aiTips', async () => {
      try {
        set({ aiError: null });
        const res = await fetch("/api/ai/tips");
        const data = await res.json();
        if (!res.ok) {
          set({ aiTips: [], aiError: data?.error || "AI 育儿建议服务暂时不可用" });
          return;
        }
        set({ aiTips: Array.isArray(data) ? data : [], aiError: null });
        markFetched('aiTips');
      } catch (e: any) {
        if (!isAuthError(e)) console.error("Failed to fetch AI tips:", e);
        set({ aiTips: [], aiError: e?.message || "AI 育儿建议连接失败" });
      }
    });
  },

  // ===== Update actions =====

  updateBook: async (id, data) => {
    try {
      const updated = await request<Book>(`/api/books/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      set((state) => ({
        books: state.books.map((b) => (b.id === id || b.bookId === id ? { ...b, ...updated } : b)),
      }));
    } catch (e) {
      console.error("Failed to update book:", e);
      throw e;
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
      invalidateCache("dailySummary");
      invalidateCache("timeline");
      set((state) => ({
        feedingRecords: [newRecord, ...state.feedingRecords],
      }));
      get().fetchDailySummary();
      get().fetchTimeline();
    } catch (e) {
      console.error("Failed to add feeding record:", e);
      throw e;
    }
  },

  addSleepRecord: async (record) => {
    try {
      const newRecord = await request<SleepRecord>("/api/records/sleep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record),
      });
      invalidateCache("dailySummary");
      invalidateCache("timeline");
      set((state) => ({
        sleepRecords: [newRecord, ...state.sleepRecords],
      }));
      get().fetchDailySummary();
      get().fetchTimeline();
    } catch (e) {
      console.error("Failed to add sleep record:", e);
      throw e;
    }
  },

  addDiaperRecord: async (record) => {
    try {
      const newRecord = await request<DiaperRecord>("/api/records/diaper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record),
      });
      invalidateCache("dailySummary");
      invalidateCache("timeline");
      set((state) => ({
        diaperRecords: [newRecord, ...state.diaperRecords],
      }));
      get().fetchDailySummary();
      get().fetchTimeline();
    } catch (e) {
      console.error("Failed to add diaper record:", e);
      throw e;
    }
  },

  addFoodLogRecord: async (record) => {
    try {
      const newRecord = await request<FoodLogRecord>("/api/food/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record),
      });
      invalidateCache("dailySummary");
      invalidateCache("timeline");
      set((state) => ({
        foodLogRecords: [newRecord, ...state.foodLogRecords],
      }));
      get().fetchDailySummary();
      get().fetchTimeline();
    } catch (e) {
      console.error("Failed to add food log record:", e);
      throw e;
    }
  },


  fetchMedicalReports: async (category?: string) => {
    if (!get().user && !get().authLoading) return;
    try {
      const params = category && category !== "all" ? `?category=${category}` : "";
      const data = await request<MedicalReport[]>(`/api/medical/reports${params}`);
      set({ medicalReports: data || [] });
    } catch (e) {
      if (!isAuthError(e)) console.error("Failed to fetch medical reports:", e);
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
      throw e;
    }
  },

  addMedicalReport: async (report) => {
    try {
      const newReport = await request<MedicalReport>("/api/medical/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(report),
      });
      set((state) => ({
        medicalReports: [newReport, ...state.medicalReports.filter((r) => r.id !== newReport.id)],
      }));
      if (report.growthData) {
        get().fetchGrowthMeasurements();
      }
      return newReport;
    } catch (e) {
      console.error("Failed to add medical report:", e);
      throw e;
    }
  },

  deleteMedicalReport: async (id: string) => {
    try {
      await request<{ success: boolean }>(`/api/medical/reports/${id}`, {
        method: "DELETE",
      });
      set((state) => ({
        medicalReports: state.medicalReports.filter((r) => r.id !== id),
      }));
    } catch (e) {
      console.error("Failed to delete medical report:", e);
      throw e;
    }
  },
}));

setOnUnauthorized(() => {
  // Only reset state if we had a logged-in user (session expired).
  // During cold start, user is null and 401s are expected — don't interfere.
  const state = useBabyStore.getState();
  if (state.user) {
    useBabyStore.setState({ user: null, family: null, baby: null, authLoading: false });
  }
});

