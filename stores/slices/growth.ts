"use client";
import { enqueueOutbox, isRetryableSubmitError } from "@/lib/outbox";
import { isFresh, markFetched, invalidateCache, dedup, toQuery } from "./helpers";
import { request, isAuthError } from "./helpers";
import { _fetchedAt } from "./helpers";
import type { GrowthMeasurement, MedicalReport, FoodItem, FeedingGuideline, FoodPlan, Book, Vaccine, VaccineStrategyGroup, VaccineScheduleEntry, ScheduleEngineRule, DevelopmentMilestone, DevelopmentWarningSign, ActivityRecommendation, WeatherData } from "@/types";

export interface GrowthSlice {
  growthMeasurements: GrowthMeasurement[];
  medicalReports: MedicalReport[];
  vaccineData: {
    national: Vaccine[];
    nonProgram: Vaccine[];
    provincial: Vaccine[];
    strategyGroups: VaccineStrategyGroup[];
    schedule: VaccineScheduleEntry[];
    engineRules: ScheduleEngineRule[];
    dataRelease: any | null;
  } | null;
  vaccines: any[];
  foodItems: FoodItem[];
  feedingGuidelines: FeedingGuideline[];
  foodPlans: FoodPlan[];
  books: Book[];
  milestones: DevelopmentMilestone[];
  warningSigns: DevelopmentWarningSign[];
  activities: ActivityRecommendation[];
  weather: WeatherData | null;
  aiTips: string[];
  aiError: string | null;
  fetchGrowthMeasurements: (force?: boolean) => Promise<void>;
  fetchMedicalReports: (category?: string, force?: boolean) => Promise<void>;
  fetchFoodItems: (status?: string, force?: boolean) => Promise<void>;
  fetchFeedingGuidelines: (force?: boolean) => Promise<void>;
  fetchFoodPlans: (date?: string, force?: boolean) => Promise<void>;
  fetchBooks: (tab?: string, force?: boolean) => Promise<void>;
  fetchVaccines: (regionCode?: string, force?: boolean) => Promise<void>;
  fetchMilestones: (category?: string, month?: number, force?: boolean) => Promise<void>;
  fetchWarningSigns: (force?: boolean) => Promise<void>;
  fetchActivities: (force?: boolean) => Promise<void>;
  fetchWeather: (lat?: number, lon?: number, city?: string, force?: boolean) => Promise<void>;
  fetchAiTips: (force?: boolean) => Promise<void>;
  addGrowthMeasurement: (measurement: Partial<GrowthMeasurement>) => Promise<void>;
  deleteGrowthMeasurement: (id: string) => Promise<void>;
  addMedicalReport: (report: Partial<MedicalReport> & { growthData?: any }) => Promise<MedicalReport>;
  deleteMedicalReport: (id: string) => Promise<void>;
  updateBook: (id: string, data: Partial<Book>) => Promise<void>;
}

export const createGrowthSlice = (set: any, get: any): GrowthSlice => ({
  growthMeasurements: [],
  medicalReports: [],
  vaccineData: null,
  vaccines: [],
  foodItems: [],
  feedingGuidelines: [],
  foodPlans: [],
  books: [],
  milestones: [],
  warningSigns: [],
  activities: [],
  weather: null,
  aiTips: [],
  aiError: null,

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

  fetchMedicalReports: async (category?: string, force?: boolean) => {
    if (!get().user && !get().authLoading) return;
    const babyId = get().baby?.id;
    const key = `medicalReports:${babyId || ''}:${category || ''}`;
    if (!force && get().medicalReports.length > 0 && isFresh(key)) return;
    if (force) invalidateCache(key);
    return dedup(key, async () => {
      try {
        const query = toQuery({ category: category && category !== "all" ? category : undefined, babyId });
        const data = await request<MedicalReport[]>(`/api/medical/reports${query}`);
        set({ medicalReports: data || [] });
        markFetched(key);
      } catch (e) {
        if (!isAuthError(e)) console.error("Failed to fetch medical reports:", e);
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
      } catch (e) { if (!isAuthError(e)) console.error("Failed to fetch food items:", e); }
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
      } catch (e) { if (!isAuthError(e)) console.error("Failed to fetch feeding guidelines:", e); }
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
      } catch (e) { if (!isAuthError(e)) console.error("Failed to fetch food plans:", e); }
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
      } catch (e) { if (!isAuthError(e)) console.error("Failed to fetch books:", e); }
    });
  },

  fetchVaccines: async (regionCode?: string, force?: boolean) => {
    const key = `vaccines:${regionCode || ''}`;
    if (!force && get().vaccineData && isFresh(key)) return;
    if (force) invalidateCache(key);
    return dedup(key, async () => {
      try {
        const params = regionCode ? `?regionCode=${regionCode}` : "";
        const data = await request<GrowthSlice["vaccineData"]>(`/api/vaccines${params}`);
        set({ vaccineData: data });
        markFetched(key);
      } catch (e) { if (!isAuthError(e)) console.error("Failed to fetch vaccines:", e); }
    });
  },

  fetchMilestones: async (category?: string, month?: number, force?: boolean) => {
    const key = `milestones:${category || ''}:${month || ''}`;
    if (!force && get().milestones.length > 0 && isFresh(key)) return;
    if (force) invalidateCache(key);
    return dedup(key, async () => {
      try {
        const sp = new URLSearchParams();
        if (category) sp.set("category", category);
        if (month) sp.set("month", String(month));
        const qs = sp.toString();
        const data = await request<{ milestones: DevelopmentMilestone[] }>(`/api/development/milestones${qs ? `?${qs}` : ""}`);
        set({ milestones: data?.milestones || [] });
        markFetched(key);
      } catch (e) { if (!isAuthError(e)) console.error("Failed to fetch milestones:", e); }
    });
  },

  fetchWarningSigns: async (force?: boolean) => {
    if (!force && get().warningSigns.length > 0 && isFresh('warningSigns')) return;
    if (force) invalidateCache('warningSigns');
    return dedup('warningSigns', async () => {
      try {
        const data = await request<DevelopmentWarningSign[]>("/api/development/warning-signs");
        set({ warningSigns: Array.isArray(data) ? data : [] });
        markFetched('warningSigns');
      } catch (e) { if (!isAuthError(e)) console.error("Failed to fetch warning signs:", e); }
    });
  },

  fetchActivities: async (force?: boolean) => {
    if (!force && get().activities.length > 0 && isFresh('activities')) return;
    if (force) invalidateCache('activities');
    return dedup('activities', async () => {
      try {
        const data = await request<ActivityRecommendation[]>("/api/development/activities");
        set({ activities: data || [] });
        markFetched('activities');
      } catch (e) { if (!isAuthError(e)) console.error("Failed to fetch activities:", e); }
    });
  },

  fetchWeather: async (lat?: number, lon?: number, city?: string, force?: boolean) => {
    if (!force && get().weather && Date.now() - (_fetchedAt as any)['weather'] < 300_000) return;
    if (force) invalidateCache('weather');
    return dedup('weather', async () => {
      try {
        let finalLat = lat, finalLon = lon;
        if (finalLat === undefined && typeof window !== "undefined" && "geolocation" in navigator) {
          try {
            const pos = await new Promise<GeolocationPosition>((resolve, reject) => { navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 3000 }); });
            finalLat = pos.coords.latitude; finalLon = pos.coords.longitude;
          } catch {}
        }
        const sp = new URLSearchParams();
        if (finalLat !== undefined) sp.set("lat", String(finalLat));
        if (finalLon !== undefined) sp.set("lon", String(finalLon));
        if (city) sp.set("city", city);
        const qs = sp.toString();
        const data = await request<WeatherData>(`/api/weather${qs ? `?${qs}` : ""}`);
        set({ weather: data });
        markFetched('weather');
      } catch (e) { if (!isAuthError(e)) console.error("Failed to fetch weather:", e); }
    });
  },

  fetchAiTips: async (force?: boolean) => {
    if (!force && get().aiTips.length > 0 && !get().aiError && Date.now() - (_fetchedAt as any)['aiTips'] < 120_000) return;
    if (force) invalidateCache('aiTips');
    return dedup('aiTips', async () => {
      try {
        set({ aiError: null });
        const res = await fetch("/api/ai/tips");
        const data = await res.json();
        if (!res.ok) { set({ aiTips: [], aiError: data?.error || "AI 育儿建议服务暂时不可用" }); return; }
        set({ aiTips: Array.isArray(data) ? data : [], aiError: null });
        markFetched('aiTips');
      } catch (e: any) {
        if (!isAuthError(e)) console.error("Failed to fetch AI tips:", e);
        set({ aiTips: [], aiError: e?.message || "AI 育儿建议连接失败" });
      }
    });
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
      set((state: any) => ({ growthMeasurements: [...state.growthMeasurements, newMeasurement].sort((a: any,b:any)=> new Date(b.date).getTime()-new Date(a.date).getTime()) }));
    } catch (e) {
      if (isRetryableSubmitError(e)) {
        await enqueueOutbox({ clientId, url: "/api/growth", body: payload as any, createdAt: Date.now() });
        throw new Error("当前离线，记录已保存，联网后自动同步 ⏳");
      }
      console.error("Failed to add growth measurement:", e); throw e;
    }
  },

  deleteGrowthMeasurement: async (id: string) => {
    try {
      await request<{ success: boolean; id: string }>(`/api/growth?id=${id}`, { method: "DELETE" });
      invalidateCache("growthMeasurements");
      set((state: any) => ({
        growthMeasurements: state.growthMeasurements.filter((m: any) => m.id !== id),
      }));
    } catch (e) {
      console.error("Failed to delete growth measurement:", e);
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
      if ((report as any).growthData) invalidateCache("growthMeasurements");
      set((state: any) => ({ medicalReports: [newReport, ...state.medicalReports.filter((r: any) => r.id !== newReport.id)] }));
      if ((report as any).growthData) get().fetchGrowthMeasurements(true);
      return newReport;
    } catch (e) { console.error("Failed to add medical report:", e); throw e; }
  },

  deleteMedicalReport: async (id: string) => {
    try {
      await request<{ success: boolean }>(`/api/medical/reports/${id}`, { method: "DELETE" });
      invalidateCache("medicalReports");
      invalidateCache("growthMeasurements");
      set((state: any) => ({ medicalReports: state.medicalReports.filter((r: any) => r.id !== id) }));
    } catch (e) { console.error("Failed to delete medical report:", e); throw e; }
  },

  updateBook: async (id, data) => {
    try {
      const updated = await request<Book>(`/api/books/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      set((state: any) => ({ books: state.books.map((b: any) => (b.id === id || (b as any).bookId === id ? { ...b, ...updated } : b)) }));
    } catch (e) { console.error("Failed to update book:", e); throw e; }
  },
});

export const growthSlice = {} as any;
