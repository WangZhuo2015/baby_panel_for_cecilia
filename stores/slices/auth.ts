"use client";
import type { User, Family, FamilyMember, Baby } from "@/types";
import { isFresh, markFetched, invalidateCache, dedup } from "./helpers";
import { request, isAuthError } from "./helpers";

export interface AuthSlice {
  user: User | null;
  family: Family | null;
  familyMembers: FamilyMember[];
  authLoading: boolean;
  fetchUser: () => Promise<User | null>;
  login: (data: { username: string; password: string }) => Promise<void>;
  register: (data: any) => Promise<void>;
  logout: () => Promise<void>;
  joinFamily: (inviteCode: string, relation?: string) => Promise<void>;
  fetchFamilyMembers: () => Promise<void>;
}

export const createAuthSlice = (set: any, get: any): AuthSlice => ({
  user: null,
  family: null,
  familyMembers: [],
  authLoading: true,

  fetchUser: async () => {
    if (isFresh("user")) {
      set({ authLoading: false });
      return get().user;
    }
    return dedup("user", async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (!res.ok) {
          if (res.status >= 500) {
            // A backend outage is not evidence that the existing session expired.
            set({ authLoading: false });
            return;
          }
          set({ user: null, family: null, baby: null, authLoading: false });
          markFetched("user");
          return;
        }
        const data = await res.json();
        set({
          user: data.user || null,
          family: data.family || null,
          baby: data.baby ?? null,
          authLoading: false,
        });
        markFetched("user");
      } catch {
        if (typeof navigator !== "undefined" && !(navigator as any).onLine) {
          try {
            const raw = localStorage.getItem("baby-panel-snapshot-v1");
            const snap = raw ? JSON.parse(raw) : null;
            set({
              user: (snap?.user as User | null) ?? null,
              family: (snap?.family as Family | null) ?? null,
              baby: (snap?.baby as Baby | null) ?? null,
              authLoading: false,
            });
          } catch {
            set({ user: null, family: null, baby: null, authLoading: false });
          }
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
    set({ user: data.user, family: data.family, baby: data.baby });
  },

  register: async (registerData) => {
    const data = await request<{ user: User; family: Family; baby: Baby | null }>("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(registerData),
    });
    set({ user: data.user, family: data.family, baby: data.baby });
  },

  logout: async () => {
    // Keep the UI session when revocation fails so the user can retry logout.
    await request("/api/auth/logout", { method: "POST" });
    {
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
      try { localStorage.removeItem("baby-panel-snapshot-v1"); } catch {}
    }
  },

  joinFamily: async (inviteCode: string, relation?: string) => {
    const data = await request<{ message: string; family: Family; baby: Baby | null }>("/api/family/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteCode, relation }),
    });
    set({ family: data.family, baby: data.baby });
    get().fetchFamilyMembers();
  },

  fetchFamilyMembers: async () => {
    try {
      const data = await request<{ family: Family; members: FamilyMember[] }>("/api/family/members");
      set({ family: data.family, familyMembers: data.members || [] });
    } catch (e) {
      if (!isAuthError(e)) console.error("Failed to fetch family members:", e);
    }
  },
});

// Backward compat for tests that import authSlice
export const authSlice = {} as any;
