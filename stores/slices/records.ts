"use client";
import { enqueueOutbox, isRetryableSubmitError } from "@/lib/outbox";
import { _fetchedAt, isFresh, markFetched, invalidateCache, dedup, toQuery } from "./helpers";
import { request, isAuthError } from "./helpers";
import { getLocalDateStr } from "@/lib/date";
import { recordWriteContext } from "@/lib/growdesk/record-write-context";
import type { Baby, FeedingRecord, SleepRecord, DiaperRecord, FoodLogRecord, DailySummary, TimelineEntry, AiDailySummaryResult } from "@/types";

export interface RecordsSlice {
  baby: Baby | null;
  feedingRecords: FeedingRecord[];
  sleepRecords: SleepRecord[];
  diaperRecords: DiaperRecord[];
  foodLogRecords: FoodLogRecord[];
  timeline: TimelineEntry[];
  dailySummary: DailySummary | null;
  aiDailySummary: AiDailySummaryResult | null;
  aiDailySummaryLoading: boolean;
  aiDailySummaryError: string | null;
  fetchBaby: (force?: boolean) => Promise<void>;
  saveBaby: (data: { nickname: string; birthDate: string; gender: string; familyId?: string; gestationalAge?: number; gestationalDays?: number; avatarUrl?: string | null }) => Promise<void>;
  fetchFeedingRecords: (date?: string, force?: boolean) => Promise<void>;
  fetchSleepRecords: (force?: boolean) => Promise<void>;
  fetchDiaperRecords: (force?: boolean) => Promise<void>;
  fetchFoodLogRecords: (date?: string, force?: boolean) => Promise<void>;
  fetchDailySummary: (date?: string, force?: boolean) => Promise<void>;
  fetchTimeline: (date?: string, force?: boolean) => Promise<void>;
  fetchAiDailySummary: (date?: string, force?: boolean) => Promise<AiDailySummaryResult | null>;
  refreshAll: (date?: string) => Promise<void>;
  pollActiveData: (date?: string) => Promise<void>;
  addFeedingRecord: (record: Partial<FeedingRecord>) => Promise<void>;
  addSleepRecord: (record: Partial<SleepRecord>) => Promise<void>;
  addDiaperRecord: (record: Partial<DiaperRecord>) => Promise<void>;
  addFoodLogRecord: (record: Partial<FoodLogRecord>) => Promise<void>;
  updateTimelineRecord: (type: TimelineEntry['type'], id: string, patch: Record<string, unknown>) => Promise<void>;
  deleteTimelineRecord: (type: TimelineEntry['type'], id: string) => Promise<void>;
}

export const createRecordsSlice = (set: any, get: any): RecordsSlice => ({
  baby: null,
  feedingRecords: [],
  sleepRecords: [],
  diaperRecords: [],
  foodLogRecords: [],
  dailySummary: null,
  timeline: [],
  aiDailySummary: null,
  aiDailySummaryLoading: false,
  aiDailySummaryError: null,

  fetchBaby: async (force?: boolean) => {
    if (!get().user && !get().authLoading) return;
    if (!force && get().baby && isFresh('baby')) return;
    if (force) invalidateCache('baby');
    return dedup('baby', async () => {
      try {
        const data = await request<Baby>(`/api/baby${toQuery({ babyId: get().baby?.id })}`);
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
        body: JSON.stringify({ ...data, ...(existing ? { babyId: existing.id } : {}) }),
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

  fetchAiDailySummary: async (date?: string, force?: boolean) => {
    if (!get().user && !get().authLoading) return null;
    const babyId = get().baby?.id;
    const key = `aiDailySummary:${babyId || ''}:${date || ''}`;
    if (!force && get().aiDailySummary && get().aiDailySummary.date === (date || getLocalDateStr()) && isFresh(key)) {
      return get().aiDailySummary;
    }
    if (force) invalidateCache(key);
    set({ aiDailySummaryLoading: true, aiDailySummaryError: null });
    return dedup(key, async () => {
      try {
        const query = toQuery({ date, babyId, force: force ? "1" : undefined });
        const res = await request<{ summary: AiDailySummaryResult }>(`/api/ai/daily-summary${query}`);
        if (res?.summary) {
          set({ aiDailySummary: res.summary, aiDailySummaryLoading: false, aiDailySummaryError: null });
          markFetched(key);
          return res.summary;
        }
        set({ aiDailySummaryLoading: false });
        return null;
      } catch (e: any) {
        if (!isAuthError(e)) {
          console.error("Failed to fetch AI daily summary:", e);
          set({ aiDailySummaryLoading: false, aiDailySummaryError: e?.message || "获取 AI 总结失败" });
        } else {
          set({ aiDailySummaryLoading: false });
        }
        return null;
      }
    });
  },

  refreshAll: async (date?: string) => {
    invalidateCache("dailySummary");
    invalidateCache("aiDailySummary");
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
      get().fetchAiDailySummary(date, true),
      get().fetchTimeline(date, true),
      get().fetchFeedingRecords(date, true),
      get().fetchSleepRecords(true),
      get().fetchDiaperRecords(true),
      get().fetchFoodLogRecords(date, true),
      get().fetchGrowthMeasurements(true),
      get().fetchMedicalReports(undefined, true),
    ]);
  },

  pollActiveData: async (date?: string) => {
    if (!get().user || !get().baby?.id) return;
    invalidateCache("dailySummary");
    invalidateCache("timeline");
    invalidateCache("feedingRecords");
    invalidateCache("sleepRecords");
    invalidateCache("diaperRecords");
    invalidateCache("foodLogRecords");
    await Promise.allSettled([
      get().fetchDailySummary(date, true),
      get().fetchTimeline(date, true),
      get().fetchFeedingRecords(date, true),
      get().fetchSleepRecords(true),
      get().fetchDiaperRecords(true),
      get().fetchFoodLogRecords(date, true),
    ]);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("baby:data-polled"));
    }
  },

  addFeedingRecord: async (record) => {
    const clientId = crypto.randomUUID();
    const payload = { babyId: get().baby?.id, ...record, clientId };
    try {
      const newRecord = (await request<FeedingRecord>("/api/records/feeding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })) as FeedingRecord;
      invalidateCache("feedingRecords");
      invalidateCache("dailySummary");
      invalidateCache("timeline");
      set((state: any) => ({ feedingRecords: [newRecord, ...state.feedingRecords] }));
      get().fetchDailySummary(undefined, true);
      get().fetchTimeline(undefined, true);
    } catch (e) {
      if (isRetryableSubmitError(e)) {
        await enqueueOutbox({ clientId, url: "/api/records/feeding", body: payload as any, createdAt: Date.now() });
        throw new Error("当前离线，记录已保存，联网后自动同步 ⏳");
      }
      console.error("Failed to add feeding record:", e);
      throw e;
    }
  },

  addSleepRecord: async (record) => {
    const clientId = crypto.randomUUID();
    const payload = { babyId: get().baby?.id, ...record, clientId };
    try {
      const newRecord = (await request<SleepRecord>("/api/records/sleep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })) as SleepRecord;
      invalidateCache("sleepRecords");
      invalidateCache("dailySummary");
      invalidateCache("timeline");
      set((state: any) => ({ sleepRecords: [newRecord, ...state.sleepRecords] }));
      get().fetchDailySummary(undefined, true);
      get().fetchTimeline(undefined, true);
    } catch (e) {
      if (isRetryableSubmitError(e)) {
        await enqueueOutbox({ clientId, url: "/api/records/sleep", body: payload as any, createdAt: Date.now() });
        throw new Error("当前离线，记录已保存，联网后自动同步 ⏳");
      }
      console.error("Failed to add sleep record:", e);
      throw e;
    }
  },

  addDiaperRecord: async (record) => {
    const clientId = crypto.randomUUID();
    const payload = { babyId: get().baby?.id, ...record, clientId };
    try {
      const newRecord = (await request<DiaperRecord>("/api/records/diaper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })) as DiaperRecord;
      invalidateCache("diaperRecords");
      invalidateCache("dailySummary");
      invalidateCache("timeline");
      set((state: any) => ({ diaperRecords: [newRecord, ...state.diaperRecords] }));
      get().fetchDailySummary(undefined, true);
      get().fetchTimeline(undefined, true);
    } catch (e) {
      if (isRetryableSubmitError(e)) {
        await enqueueOutbox({ clientId, url: "/api/records/diaper", body: payload as any, createdAt: Date.now() });
        throw new Error("当前离线，记录已保存，联网后自动同步 ⏳");
      }
      console.error("Failed to add diaper record:", e);
      throw e;
    }
  },

  addFoodLogRecord: async (record) => {
    const clientId = crypto.randomUUID();
    const payload = { babyId: get().baby?.id, ...record, clientId };
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
      set((state: any) => ({ foodLogRecords: [newRecord, ...state.foodLogRecords] }));
      get().fetchDailySummary(undefined, true);
      get().fetchTimeline(undefined, true);
    } catch (e) {
      if (isRetryableSubmitError(e)) {
        await enqueueOutbox({ clientId, url: "/api/food/logs", body: payload as any, createdAt: Date.now() });
        throw new Error("当前离线，记录已保存，联网后自动同步 ⏳");
      }
      console.error("Failed to add food log record:", e);
      throw e;
    }
  },

  updateTimelineRecord: async (type, id, patch) => {
    const endpoint = type === "food" ? "/api/food/logs" : `/api/records/${type}`;
    try {
      const updated = await request<Record<string, unknown>>(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...recordWriteContext(get(), type, id), ...patch }),
      });
      const listKey = type === "feeding" ? "feedingRecords" : type === "sleep" ? "sleepRecords" : type === "diaper" ? "diaperRecords" : "foodLogRecords";
      set((state: any) => ({
        [listKey]: (state as any)[listKey].map((r: { id: string }) => r.id === id ? { ...r, ...(updated as object) } : r),
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
    const endpoint = type === "food" ? "/api/food/logs" : type === "supplement" ? "/api/nutrition/records" : `/api/records/${type}`;
    try {
      await request<{ success: boolean }>(endpoint, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...recordWriteContext(get(), type, id) }),
      });
      const listKey = type === "feeding" ? "feedingRecords" : type === "sleep" ? "sleepRecords" : type === "diaper" ? "diaperRecords" : type === "food" ? "foodLogRecords" : null;
      if (listKey) {
        set((state: any) => ({
          [listKey]: (state as any)[listKey]?.filter((r: { id: string }) => r.id !== id) || [],
        } as any));
      }
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
});

export const recordsSlice = {} as any;
