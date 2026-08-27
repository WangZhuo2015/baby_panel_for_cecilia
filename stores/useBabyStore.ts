"use client";

import { create } from "zustand";
import { enqueueOutbox, isRetryableSubmitError } from "@/lib/outbox";
import { STALE_MS, _fetchedAt, isFresh, markFetched, invalidateCache, dedup, toQuery } from "@/lib/fetch-cache";
export { invalidateCache } from "@/lib/fetch-cache";
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
  fetchBaby: (force?: boolean) => Promise<void>;
  saveBaby: (data: { nickname: string; birthDate: string; gender: string; gestationalAge?: number; avatarUrl?: string }) => Promise<void>;
  fetchFeedingRecords: (date?: string, force?: boolean) => Promise<void>;
  fetchSleepRecords: (force?: boolean) => Promise<void>;
  fetchDiaperRecords: (force?: boolean) => Promise<void>;
  fetchFoodLogRecords: (date?: string, force?: boolean) => Promise<void>;
  fetchGrowthMeasurements: (force?: boolean) => Promise<void>;
  fetchDailySummary: (date?: string, force?: boolean) => Promise<void>;
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

  // Actions - refresh & cache
  invalidateCache: (prefix?: string) => void;
  refreshAll: (date?: string) => Promise<void>;

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
  /** 记录修正：更新/删除时间轴四类记录（feeding/sleep/diaper/food） */
  updateTimelineRecord: (type: TimelineEntry['type'], id: string, patch: Record<string, unknown>) => Promise<void>;
  deleteTimelineRecord: (type: TimelineEntry['type'], id: string) => Promise<void>;
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
    const data = await res.json().catch(() => ({}));
    const errorMessage =
      data?.error ||
      (res.status === 401 ? "请先登录" : `请求失败 (${res.status})`);

    if (res.status === 401) {
      if (
        _onUnauthorized &&
        !url.includes("/api/auth/login") &&
        !url.includes("/api/auth/register")
      ) {
        _onUnauthorized();
      }
      throw new AuthError(errorMessage);
    }
    throw new Error(errorMessage);
  }
  return res.json();
}





// Fetch caching extracted to lib/fetch-cache.ts - re-exported above for compat

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
        // 网络失败（离线）时保留/恢复快照会话，避免离线冷启动被"假登出"
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          const snap = loadSnapshot();
          set({
            user: (snap?.user as User | null) ?? null,
            family: (snap?.family as Family | null) ?? null,
            baby: (snap?.baby as Baby | null) ?? null,
            authLoading: false,
          });
        } else {
          set({ user: null, family: null, baby: null, authLoading: false });
        }
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
      try {
        localStorage.removeItem(SNAPSHOT_KEY);
      } catch {}
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

  fetchBaby: async (force?: boolean) => {
    if (!get().user && !get().authLoading) return;
    if (!force && get().baby && isFresh('baby')) return;
    if (force) invalidateCache('baby');
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
      invalidateCache('baby');
    } catch (e) {
      console.error("Failed to save baby:", e);
      throw e;
    }
  },

  fetchFeedingRecords: async (date?: string, force?: boolean) => {
    if (!get().user && !get().authLoading) return;
    const babyId = get().baby?.id;
    const key = `feedingRecords:${babyId || ''}:${date || ''}`;
    if (!force && get().feedingRecords.length > 0 && isFresh(key)) return;
    if (force) invalidateCache(key);
    return dedup(key, async () => {
      try {
        const query = toQuery({ date, babyId });
        const data = await request<FeedingRecord[]>(`/api/records/feeding${query}`);
        set({ feedingRecords: data || [] });
        markFetched(key);
      } catch (e) {
        if (!isAuthError(e)) console.error("Failed to fetch feeding records:", e);
      }
    });
  },

  fetchSleepRecords: async (force?: boolean) => {
    if (!get().user && !get().authLoading) return;
    const babyId = get().baby?.id;
    const key = `sleepRecords:${babyId || ''}`;
    if (!force && get().sleepRecords.length > 0 && isFresh(key)) return;
    if (force) invalidateCache(key);
    return dedup(key, async () => {
      try {
        const query = toQuery({ babyId });
        const data = await request<SleepRecord[]>(`/api/records/sleep${query}`);
        set({ sleepRecords: data || [] });
        markFetched(key);
      } catch (e) {
        if (!isAuthError(e)) console.error("Failed to fetch sleep records:", e);
      }
    });
  },

  fetchDiaperRecords: async (force?: boolean) => {
    if (!get().user && !get().authLoading) return;
    const babyId = get().baby?.id;
    const key = `diaperRecords:${babyId || ''}`;
    if (!force && get().diaperRecords.length > 0 && isFresh(key)) return;
    if (force) invalidateCache(key);
    return dedup(key, async () => {
      try {
        const query = toQuery({ babyId });
        const data = await request<DiaperRecord[]>(`/api/records/diaper${query}`);
        set({ diaperRecords: data || [] });
        markFetched(key);
      } catch (e) {
        if (!isAuthError(e)) console.error("Failed to fetch diaper records:", e);
      }
    });
  },

  fetchFoodLogRecords: async (date?: string, force?: boolean) => {
    if (!get().user && !get().authLoading) return;
    const babyId = get().baby?.id;
    const key = `foodLogRecords:${babyId || ''}:${date || ''}`;
    if (!force && get().foodLogRecords.length > 0 && isFresh(key)) return;
    if (force) invalidateCache(key);
    return dedup(key, async () => {
      try {
        const query = toQuery({ date, babyId });
        const data = await request<FoodLogRecord[]>(`/api/food/logs${query}`);
        set({ foodLogRecords: data || [] });
        markFetched(key);
      } catch (e) {
        if (!isAuthError(e)) console.error("Failed to fetch food log records:", e);
      }
    });
  },

  fetchGrowthMeasurements: async (force?: boolean) => {
    if (!get().user && !get().authLoading) return;
    const babyId = get().baby?.id;
    const key = `growthMeasurements:${babyId || ''}`;
    if (!force && get().growthMeasurements.length > 0 && isFresh(key)) return;
    if (force) invalidateCache(key);
    return dedup(key, async () => {
      try {
        const query = toQuery({ babyId });
        const data = await request<GrowthMeasurement[]>(`/api/growth${query}`);
        set({ growthMeasurements: data || [] });
        markFetched(key);
      } catch (e) {
        if (!isAuthError(e)) console.error("Failed to fetch growth measurements:", e);
      }
    });
  },

  fetchDailySummary: async (date?: string, force?: boolean) => {
    if (!get().user && !get().authLoading) return;
    const babyId = get().baby?.id;
    const key = `dailySummary:${babyId || ''}:${date || ''}`;
    if (!force && get().dailySummary && isFresh(key)) return;
    if (force) invalidateCache(key);
    return dedup(key, async () => {
      try {
        const query = toQuery({ date, babyId });
        const data = await request<DailySummary>(`/api/records/daily-summary${query}`);
        set({ dailySummary: data });
        markFetched(key);
      } catch (e) {
        if (!isAuthError(e)) console.error("Failed to fetch daily summary:", e);
      }
    });
  },

  fetchTimeline: async (date?: string, force?: boolean) => {
    if (!get().user && !get().authLoading) return;
    const babyId = get().baby?.id;
    const key = `timeline:${babyId || ''}:${date || ''}`;
    if (!force && get().timeline.length > 0 && isFresh(key)) return;
    if (force) invalidateCache(key);
    return dedup(key, async () => {
      try {
        const query = toQuery({ date, babyId });
        const data = await request<TimelineEntry[]>(`/api/records/timeline${query}`);
        set({ timeline: data || [] });
        markFetched(key);
      } catch (e) {
        if (!isAuthError(e)) console.error("Failed to fetch timeline:", e);
      }
    });
  },

  fetchWeather: async (lat?: number, lon?: number, city?: string, force?: boolean) => {
    // Weather changes slowly — cache for 5 minutes
    if (!force && get().weather && Date.now() - (_fetchedAt['weather'] || 0) < 300_000) return;
    if (force) invalidateCache('weather');
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

  fetchFoodItems: async (status?: string, force?: boolean) => {
    const key = `foodItems:${status || ''}`;
    if (!force && get().foodItems.length > 0 && isFresh(key)) return;
    if (force) invalidateCache(key);
    return dedup(key, async () => {
      try {
        const params = status ? `?status=${status}` : "";
        const data = await request<FoodItem[]>(`/api/food/items${params}`);
        set({ foodItems: data || [] });
        markFetched(key);
      } catch (e) {
        if (!isAuthError(e)) console.error("Failed to fetch food items:", e);
      }
    });
  },

  fetchFeedingGuidelines: async (force?: boolean) => {
    if (!force && get().feedingGuidelines.length > 0 && isFresh('feedingGuidelines')) return;
    if (force) invalidateCache('feedingGuidelines');
    return dedup('feedingGuidelines', async () => {
      try {
        const data = await request<FeedingGuideline[]>("/api/food/feeding-guidelines");
        set({ feedingGuidelines: data || [] });
        markFetched('feedingGuidelines');
      } catch (e) {
        if (!isAuthError(e)) console.error("Failed to fetch feeding guidelines:", e);
      }
    });
  },

  fetchFoodPlans: async (date?: string, force?: boolean) => {
    const key = `foodPlans:${date || ''}`;
    if (!force && isFresh(key)) return;
    if (force) invalidateCache(key);
    return dedup(key, async () => {
      try {
        const params = date ? `?date=${date}` : "";
        const data = await request<FoodPlan[]>(`/api/food/plans${params}`);
        set({ foodPlans: data || [] });
        markFetched(key);
      } catch (e) {
        if (!isAuthError(e)) console.error("Failed to fetch food plans:", e);
      }
    });
  },

  fetchBooks: async (tab?: string, force?: boolean) => {
    const key = `books:${tab || ''}`;
    if (!force && get().books.length > 0 && isFresh(key)) return;
    if (force) invalidateCache(key);
    return dedup(key, async () => {
      try {
        const params = tab ? `?tab=${tab}` : "";
        const data = await request<Book[]>(`/api/books${params}`);
        set({ books: data || [] });
        markFetched(key);
      } catch (e) {
        if (!isAuthError(e)) console.error("Failed to fetch books:", e);
      }
    });
  },

  fetchVaccines: async (regionCode?: string, force?: boolean) => {
    const key = `vaccines:${regionCode || ''}`;
    if (!force && get().vaccineData && isFresh(key)) return;
    if (force) invalidateCache(key);
    return dedup(key, async () => {
      try {
        const params = regionCode ? `?regionCode=${regionCode}` : "";
        const data = await request<BabyStore["vaccineData"]>(`/api/vaccines${params}`);
        set({ vaccineData: data });
        markFetched(key);
      } catch (e) {
        if (!isAuthError(e)) console.error("Failed to fetch vaccines:", e);
      }
    });
  },

  fetchMilestones: async (category?: string, month?: number, force?: boolean) => {
    const key = `milestones:${category || ''}:${month || ''}`;
    if (!force && get().milestones.length > 0 && isFresh(key)) return;
    if (force) invalidateCache(key);
    return dedup(key, async () => {
      try {
        const params = new URLSearchParams();
        if (category) params.set("category", category);
        if (month) params.set("month", String(month));
        const qs = params.toString();
        const data = await request<{ milestones: DevelopmentMilestone[] }>(
          `/api/development/milestones${qs ? `?${qs}` : ""}`
        );
        set({ milestones: data?.milestones || [] });
        markFetched(key);
      } catch (e) {
        if (!isAuthError(e)) console.error("Failed to fetch milestones:", e);
      }
    });
  },

  fetchWarningSigns: async (force?: boolean) => {
    if (!force && get().warningSigns.length > 0 && isFresh('warningSigns')) return;
    if (force) invalidateCache('warningSigns');
    return dedup('warningSigns', async () => {
      try {
        const data = await request<DevelopmentWarningSign[]>(
          "/api/development/warning-signs"
        );
        set({ warningSigns: Array.isArray(data) ? data : [] });
        markFetched('warningSigns');
      } catch (e) {
        if (!isAuthError(e)) console.error("Failed to fetch warning signs:", e);
      }
    });
  },

  fetchActivities: async (force?: boolean) => {
    if (!force && get().activities.length > 0 && isFresh('activities')) return;
    if (force) invalidateCache('activities');
    return dedup('activities', async () => {
      try {
        const data = await request<ActivityRecommendation[]>(
          "/api/development/activities"
        );
        set({ activities: data || [] });
        markFetched('activities');
      } catch (e) {
        if (!isAuthError(e)) console.error("Failed to fetch activities:", e);
      }
    });
  },

  fetchAiTips: async (force?: boolean) => {
    // AI tips are expensive — cache for 2 minutes unless forced
    if (!force && get().aiTips.length > 0 && !get().aiError && Date.now() - (_fetchedAt['aiTips'] || 0) < 120_000) return;
    if (force) invalidateCache('aiTips');
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

  fetchMedicalReports: async (category?: string, force?: boolean) => {
    if (!get().user && !get().authLoading) return;
    const babyId = get().baby?.id;
    const key = `medicalReports:${babyId || ''}:${category || ''}`;
    if (!force && get().medicalReports.length > 0 && isFresh(key)) return;
    if (force) invalidateCache(key);
    return dedup(key, async () => {
      try {
        const query = toQuery({
          category: category && category !== "all" ? category : undefined,
          babyId,
        });
        const data = await request<MedicalReport[]>(`/api/medical/reports${query}`);
        set({ medicalReports: data || [] });
        markFetched(key);
      } catch (e) {
        if (!isAuthError(e)) console.error("Failed to fetch medical reports:", e);
      }
    });
  },

  invalidateCache: (prefix?: string) => {
    invalidateCache(prefix);
  },

  refreshAll: async (date?: string) => {
    invalidateCache("dailySummary");
    invalidateCache("timeline");
    invalidateCache("feedingRecords");
    invalidateCache("sleepRecords");
    invalidateCache("diaperRecords");
    invalidateCache("foodLogRecords");
    invalidateCache("growthMeasurements");
    invalidateCache("medicalReports");
    await Promise.allSettled([
      get().fetchBaby(true),
      get().fetchDailySummary(date, true),
      get().fetchTimeline(date, true),
      get().fetchFeedingRecords(date, true),
      get().fetchSleepRecords(true),
      get().fetchDiaperRecords(true),
      get().fetchFoodLogRecords(date, true),
      get().fetchGrowthMeasurements(true),
      get().fetchMedicalReports(undefined, true),
    ]);
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
    const clientId = crypto.randomUUID();
    const payload = { ...record, clientId };
    try {
      const newRecord = (await request<FeedingRecord>("/api/records/feeding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })) as FeedingRecord;
      invalidateCache("feedingRecords");
      invalidateCache("dailySummary");
      invalidateCache("timeline");
      set((state) => ({
        feedingRecords: [newRecord, ...state.feedingRecords],
      }));
      get().fetchDailySummary(undefined, true);
      get().fetchTimeline(undefined, true);
    } catch (e) {
      if (isRetryableSubmitError(e)) {
        await enqueueOutbox({ clientId, url: "/api/records/feeding", body: payload, createdAt: Date.now() });
        throw new Error("当前离线，记录已保存，联网后自动同步 ⏳");
      }
      console.error("Failed to add feeding record:", e);
      throw e;
    }
  },

  addSleepRecord: async (record) => {
    const clientId = crypto.randomUUID();
    const payload = { ...record, clientId };
    try {
      const newRecord = (await request<SleepRecord>("/api/records/sleep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })) as SleepRecord;
      invalidateCache("sleepRecords");
      invalidateCache("dailySummary");
      invalidateCache("timeline");
      set((state) => ({
        sleepRecords: [newRecord, ...state.sleepRecords],
      }));
      get().fetchDailySummary(undefined, true);
      get().fetchTimeline(undefined, true);
    } catch (e) {
      if (isRetryableSubmitError(e)) {
        await enqueueOutbox({ clientId, url: "/api/records/sleep", body: payload, createdAt: Date.now() });
        throw new Error("当前离线，记录已保存，联网后自动同步 ⏳");
      }
      console.error("Failed to add sleep record:", e);
      throw e;
    }
  },

  addDiaperRecord: async (record) => {
    const clientId = crypto.randomUUID();
    const payload = { ...record, clientId };
    try {
      const newRecord = (await request<DiaperRecord>("/api/records/diaper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })) as DiaperRecord;
      invalidateCache("diaperRecords");
      invalidateCache("dailySummary");
      invalidateCache("timeline");
      set((state) => ({
        diaperRecords: [newRecord, ...state.diaperRecords],
      }));
      get().fetchDailySummary(undefined, true);
      get().fetchTimeline(undefined, true);
    } catch (e) {
      if (isRetryableSubmitError(e)) {
        await enqueueOutbox({ clientId, url: "/api/records/diaper", body: payload, createdAt: Date.now() });
        throw new Error("当前离线，记录已保存，联网后自动同步 ⏳");
      }
      console.error("Failed to add diaper record:", e);
      throw e;
    }
  },

  addFoodLogRecord: async (record) => {
    const clientId = crypto.randomUUID();
    const payload = { ...record, clientId };
    try {
      const newRecord = (await request<FoodLogRecord>("/api/food/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })) as FoodLogRecord;
      invalidateCache("foodLogRecords");
      invalidateCache("foodPlans");
      invalidateCache("dailySummary");
      invalidateCache("timeline");
      set((state) => ({
        foodLogRecords: [newRecord, ...state.foodLogRecords],
      }));
      get().fetchDailySummary(undefined, true);
      get().fetchTimeline(undefined, true);
    } catch (e) {
      if (isRetryableSubmitError(e)) {
        // 离线/服务不可用：入 outbox，联网后自动同步
        await enqueueOutbox({ clientId, url: "/api/food/logs", body: payload, createdAt: Date.now() });
        throw new Error("当前离线，记录已保存，联网后自动同步 ⏳");
      }
      console.error("Failed to add food log record:", e);
      throw e;
    }
  },

  addGrowthMeasurement: async (measurement) => {
    const clientId = crypto.randomUUID();
    const payload = { ...measurement, clientId };
    try {
      const newMeasurement = await request<GrowthMeasurement>("/api/growth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      invalidateCache("growthMeasurements");
      set((state) => ({
        growthMeasurements: [...state.growthMeasurements, newMeasurement].sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        ),
      }));
    } catch (e) {
      if (isRetryableSubmitError(e)) {
        await enqueueOutbox({ clientId, url: "/api/growth", body: payload, createdAt: Date.now() });
        throw new Error("当前离线，记录已保存，联网后自动同步 ⏳");
      }
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
      invalidateCache("medicalReports");
      if (report.growthData) {
        invalidateCache("growthMeasurements");
      }
      set((state) => ({
        medicalReports: [newReport, ...state.medicalReports.filter((r) => r.id !== newReport.id)],
      }));
      if (report.growthData) {
        get().fetchGrowthMeasurements(true);
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
      invalidateCache("medicalReports");
      invalidateCache("growthMeasurements");
      set((state) => ({
        medicalReports: state.medicalReports.filter((r) => r.id !== id),
      }));
    } catch (e) {
      console.error("Failed to delete medical report:", e);
      throw e;
    }
  },

  updateTimelineRecord: async (type, id, patch) => {
    const endpoint =
      type === "food" ? "/api/food/logs" : `/api/records/${type}`;
    try {
      const updated = await request<Record<string, unknown>>(endpoint, {
        method: "PUT",
        body: JSON.stringify({ id, ...patch }),
      });
      // 更新本地对应数组
      const listKey =
        type === "feeding" ? "feedingRecords"
        : type === "sleep" ? "sleepRecords"
        : type === "diaper" ? "diaperRecords"
        : "foodLogRecords";
      set((state) => ({
        [listKey]: (state as any)[listKey].map((r: { id: string }) =>
          r.id === id ? { ...r, ...(updated as object) } : r
        ),
      } as any));
      invalidateCache("feedingRecords");
      invalidateCache("sleepRecords");
      invalidateCache("diaperRecords");
      invalidateCache("foodLogRecords");
      invalidateCache("dailySummary");
      invalidateCache("timeline");
      await Promise.all([get().fetchDailySummary(undefined, true), get().fetchTimeline(undefined, true)]);
    } catch (e) {
      console.error("Failed to update timeline record:", e);
      throw e;
    }
  },

  deleteTimelineRecord: async (type, id) => {
    const endpoint =
      type === "food" ? "/api/food/logs" : `/api/records/${type}`;
    try {
      await request<{ success: boolean }>(endpoint, {
        method: "DELETE",
        body: JSON.stringify({ id }),
      });
      const listKey =
        type === "feeding" ? "feedingRecords"
        : type === "sleep" ? "sleepRecords"
        : type === "diaper" ? "diaperRecords"
        : "foodLogRecords";
      set((state) => ({
        [listKey]: (state as any)[listKey].filter((r: { id: string }) => r.id !== id),
      } as any));
      invalidateCache("feedingRecords");
      invalidateCache("sleepRecords");
      invalidateCache("diaperRecords");
      invalidateCache("foodLogRecords");
      invalidateCache("dailySummary");
      invalidateCache("timeline");
      await Promise.all([get().fetchDailySummary(undefined, true), get().fetchTimeline(undefined, true)]);
    } catch (e) {
      console.error("Failed to delete timeline record:", e);
      throw e;
    }
  },
}));


// ===== 离线快照：登录态与当日核心数据落 localStorage，冷启动断网可恢复 =====
const SNAPSHOT_KEY = "baby-panel-snapshot-v1";

interface StoreSnapshot {
  user?: unknown;
  family?: unknown;
  baby?: unknown;
  dailySummary?: unknown;
  timeline?: unknown;
  savedAt?: number;
}

function saveSnapshot(state: {
  user: unknown; family: unknown; baby: unknown;
  dailySummary: unknown; timeline: unknown;
}): void {
  try {
    const payload: StoreSnapshot = {
      user: state.user, family: state.family, baby: state.baby,
      dailySummary: state.dailySummary, timeline: state.timeline,
      savedAt: Date.now(),
    };
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(payload));
  } catch { /* 隐私模式/配额忽略 */ }
}

function loadSnapshot(): StoreSnapshot | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    return raw ? (JSON.parse(raw) as StoreSnapshot) : null;
  } catch {
    return null;
  }
}

if (typeof window !== "undefined") {
  let snapshotTimer: ReturnType<typeof setTimeout> | undefined;
  useBabyStore.subscribe((state) => {
    if (snapshotTimer) clearTimeout(snapshotTimer);
    snapshotTimer = setTimeout(() => {
      if (state.user) {
        saveSnapshot({
          user: state.user, family: state.family, baby: state.baby,
          dailySummary: state.dailySummary, timeline: state.timeline,
        });
      }
    }, 500);
  });
}

setOnUnauthorized(() => {
  // Only reset state if we had a logged-in user (session expired).
  // During cold start, user is null and 401s are expected — don't interfere.
  const state = useBabyStore.getState();
  if (state.user) {
    useBabyStore.setState({ user: null, family: null, baby: null, authLoading: false });
  }
});

