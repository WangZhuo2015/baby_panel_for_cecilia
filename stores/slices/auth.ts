"use client";
import type { User, Family, FamilyMember, Baby, BabyMember, BabyMemberRole } from "@/types";
import { isFresh, markFetched, invalidateCache, dedup } from "./helpers";
import { request, isAuthError } from "./helpers";

const SELECTED_BABY_KEY = "baby-panel:selected-baby:";
type IdentityPayload = {
  user?: User | null;
  family?: Family | null;
  baby?: Baby | null;
  families?: Family[] | null;
  babies?: Baby[] | null;
};

export interface AuthSlice {
  user: User | null;
  family: Family | null;
  families: Family[];
  babies: Baby[];
  selectedBabyId: string | null;
  familyMembers: FamilyMember[];
  babyMembers: BabyMember[];
  babyMembersSupported: boolean;
  authLoading: boolean;
  fetchUser: () => Promise<User | null>;
  login: (data: { username: string; password: string }) => Promise<void>;
  register: (data: { username: string; password: string; displayName?: string; inviteCode?: string; relation?: string }) => Promise<void>;
  logout: () => Promise<void>;
  joinFamily: (inviteCode: string, relation?: string) => Promise<{ message?: string }>;
  fetchFamilyMembers: () => Promise<void>;
  fetchBabyMembers: (babyId: string) => Promise<void>;
  grantBabyMember: (babyId: string, userId: string, role?: BabyMemberRole) => Promise<void>;
  revokeBabyMember: (babyId: string, userId: string) => Promise<void>;
  selectBaby: (babyId: string) => Promise<void>;
  createFamilyInvite: (expiresInDays?: number) => Promise<{ inviteCode: string; expiresAt: string }>;
}

function mapBaby(value: unknown): Baby | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || typeof raw.birthDate !== "string") return null;
  const rawGender = raw.gender;
  const gender = rawGender === "male" || rawGender === "boy"
    ? "male"
    : rawGender === "female" || rawGender === "girl"
      ? "female"
      : "unknown";
  const nickname = typeof raw.nickname === "string"
    ? raw.nickname
    : typeof raw.name === "string"
      ? raw.name
      : "";
  if (!nickname) return null;
  return {
    id: raw.id,
    familyId: typeof raw.familyId === "string" ? raw.familyId : undefined,
    nickname,
    gender,
    birthDate: raw.birthDate,
    avatarUrl: typeof raw.avatarUrl === "string" ? raw.avatarUrl : raw.avatarUrl === null ? null : undefined,
    gestationalAge: typeof raw.gestationalAge === "number" ? raw.gestationalAge : null,
    gestationalDays: typeof raw.gestationalDays === "number" ? raw.gestationalDays : null,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : undefined,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
  };
}

function mapFamily(value: unknown): Family | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || typeof raw.name !== "string") return null;
  const babies = Array.isArray(raw.babies)
    ? raw.babies.map(mapBaby).filter((baby): baby is Baby => Boolean(baby))
    : undefined;
  return {
    id: raw.id,
    name: raw.name,
    inviteCode: typeof raw.inviteCode === "string" ? raw.inviteCode : undefined,
    inviteExpiresAt: typeof raw.inviteExpiresAt === "string" ? raw.inviteExpiresAt : undefined,
    role: typeof raw.role === "string" ? raw.role : undefined,
    timeZone: typeof raw.timeZone === "string" ? raw.timeZone : undefined,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : undefined,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
    babies,
  };
}

function readSelectedBaby(userId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = localStorage.getItem(SELECTED_BABY_KEY + userId);
    return value && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}
function persistSelectedBaby(userId: string | undefined, babyId: string | null): void {
  if (typeof window === "undefined" || !userId) return;
  try {
    if (babyId) localStorage.setItem(SELECTED_BABY_KEY + userId, babyId);
    else localStorage.removeItem(SELECTED_BABY_KEY + userId);
  } catch {}
}

function clearScopedData(set: any): void {
  set({
    baby: null,
    feedingRecords: [],
    sleepRecords: [],
    diaperRecords: [],
    foodLogRecords: [],
    growthMeasurements: [],
    dailySummary: null,
    aiDailySummary: null,
    aiDailySummaryLoading: false,
    aiDailySummaryError: null,
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
    medicalReports: [],
    babyMembers: [],
    babyMembersSupported: false,
  });
}

function normalizedIdentity(data: IdentityPayload, preferredFamilyId?: string) {
  const rawFamilies = Array.isArray(data.families)
    ? data.families
    : data.family
      ? [data.family]
      : [];
  const families = rawFamilies.map(mapFamily).filter((family): family is Family => Boolean(family));
  const familyBabyMap = new Map<string, Baby[]>();
  for (const family of families) {
    familyBabyMap.set(family.id, family.babies ?? []);
  }

  const seen = new Set<string>();
  const babies: Baby[] = [];
  const addBaby = (value: unknown, fallbackFamilyId?: string) => {
    const baby = mapBaby(value);
    if (!baby || seen.has(baby.id)) return;
    if (!baby.familyId && fallbackFamilyId) baby.familyId = fallbackFamilyId;
    seen.add(baby.id);
    babies.push(baby);
  };
  for (const family of families) {
    for (const baby of family.babies ?? []) addBaby(baby, family.id);
  }
  for (const baby of Array.isArray(data.babies) ? data.babies : []) addBaby(baby);
  addBaby(data.baby, typeof data.family?.id === "string" ? data.family.id : undefined);

  const familiesWithBabies = families.map(family => ({
    ...family,
    babies: babies.filter(baby => baby.familyId === family.id),
  }));
  const authorizedIds = new Set(babies.map(baby => baby.id));
  const stored = data.user?.id ? readSelectedBaby(data.user.id) : null;
  const preferredFamilyBabies = preferredFamilyId
    ? babies.filter(baby => baby.familyId === preferredFamilyId)
    : [];
  const selectedBaby = preferredFamilyId
    ? preferredFamilyBabies[0] ?? null
    : (stored && authorizedIds.has(stored)
      ? babies.find(baby => baby.id === stored) ?? null
      : (data.baby?.id && authorizedIds.has(data.baby.id)
        ? babies.find(baby => baby.id === data.baby!.id) ?? null
        : null));
  const selectedFamily = preferredFamilyId
    ? familiesWithBabies.find(family => family.id === preferredFamilyId) ?? null
    : (selectedBaby?.familyId
      ? familiesWithBabies.find(family => family.id === selectedBaby.familyId) ?? null
      : (typeof data.family?.id === "string"
        ? familiesWithBabies.find(family => family.id === data.family!.id) ?? null
        : familiesWithBabies.find(family => family.babies?.length) ?? familiesWithBabies[0] ?? null));

  return {
    user: data.user ?? null,
    family: selectedFamily,
    families: familiesWithBabies,
    babies,
    baby: selectedBaby,
    selectedBabyId: selectedBaby?.id ?? null,
  };
}

function applyIdentity(set: any, get: any, data: IdentityPayload, preferredFamilyId?: string): void {
  const next = normalizedIdentity(data, preferredFamilyId);
  const current = get();
  const userChanged = current.user?.id !== next.user?.id;
  const babyChanged = current.baby?.id !== next.baby?.id;
  const familyChanged = current.family?.id !== next.family?.id;
  if (userChanged || babyChanged) {
    invalidateCache();
    clearScopedData(set);
  }
  set({
    user: next.user,
    family: next.family,
    families: next.families,
    babies: next.babies,
    baby: next.baby,
    selectedBabyId: next.selectedBabyId,
    familyMembers: familyChanged ? [] : current.familyMembers,
    babyMembers: babyChanged || familyChanged ? [] : current.babyMembers,
    babyMembersSupported: babyChanged || familyChanged ? false : current.babyMembersSupported,
  });
  persistSelectedBaby(next.user?.id, next.selectedBabyId);
}

function identityRequest(data: unknown): IdentityPayload {
  return data && typeof data === "object" ? data as IdentityPayload : {};
}

export const createAuthSlice = (set: any, get: any): AuthSlice => ({
  user: null,
  family: null,
  families: [],
  babies: [],
  selectedBabyId: null,
  familyMembers: [],
  babyMembers: [],
  babyMembersSupported: false,
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
          applyIdentity(set, get, { user: null, family: null, baby: null, families: [], babies: [] });
          set({ authLoading: false });
          markFetched("user");
          return;
        }
        applyIdentity(set, get, identityRequest(await res.json()));
        set({ authLoading: false });
        markFetched("user");
      } catch {
        // A snapshot is safe only when it belongs to the user already in memory and is within TTL (7 days).
        // On a cold start or when offline, never restore unverified or other accounts' data.
        const currentUser = get().user;
        let restored = false;
        if (typeof navigator !== "undefined" && !navigator.onLine && currentUser?.id) {
          try {
            const raw = localStorage.getItem(`baby-panel-snapshot-v2:${currentUser.id}`);
            if (raw) {
              const snap = JSON.parse(raw);
              const isFresh = snap?.savedAt && (Date.now() - snap.savedAt < 7 * 24 * 60 * 60 * 1000);
              if (isFresh && snap?.userId === currentUser.id) {
                applyIdentity(set, get, {
                  user: snap.user,
                  family: snap.family,
                  baby: snap.baby,
                  families: snap.family ? [snap.family] : [],
                  babies: snap.baby ? [snap.baby] : [],
                });
                restored = true;
              }
            }
          } catch {}
        }
        if (!restored) applyIdentity(set, get, { user: null, family: null, baby: null, families: [], babies: [] });
        set({ authLoading: false });
        markFetched("user");
      }
    }).then(() => get().user);
  },

  login: async (credentials) => {
    const data = await request<IdentityPayload>("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    });
    applyIdentity(set, get, identityRequest(data));
    // The legacy login response has only the selected family. Hydrate all
    // authorized babies after its BFF cookie has reached the browser.
    if (!Array.isArray(data.families)) {
      invalidateCache("user");
      await get().fetchUser();
    }
  },

  register: async (registerData) => {
    const data = await request<IdentityPayload>("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(registerData),
    });
    applyIdentity(set, get, identityRequest(data), data.family?.id);
  },

  logout: async () => {
    // Keep the UI session when revocation fails so the user can retry logout.
    await request("/api/auth/logout", { method: "POST" });
    invalidateCache();
    const userId = get().user?.id;
    persistSelectedBaby(userId, null);
    clearScopedData(set);
    set({
      user: null,
      family: null,
      families: [],
      babies: [],
      selectedBabyId: null,
      familyMembers: [],
      authLoading: false,
    });
    if (userId) {
      try { localStorage.removeItem(`baby-panel-snapshot-v2:${userId}`); } catch {}
    }
    try { localStorage.removeItem("baby-panel-snapshot-v1"); } catch {}
  },

  joinFamily: async (inviteCode: string, relation?: string) => {
    const data = await request<IdentityPayload & { message?: string }>("/api/family/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteCode, relation }),
    });
    // Joining changes membership, not the authenticated account. The join
    // response intentionally contains no user field.
    applyIdentity(set, get, { ...identityRequest(data), user: get().user }, data.family?.id);
    await get().fetchFamilyMembers();
    return { message: data.message };
  },

  fetchFamilyMembers: async () => {
    const familyId = get().family?.id;
    if (!familyId) {
      set({ familyMembers: [] });
      return;
    }
    try {
      const data = await request<{ family?: Family; members?: FamilyMember[] }>(
        `/api/family/members?familyId=${encodeURIComponent(familyId)}`,
      );
      const returnedFamily = mapFamily(data.family);
      set({
        family: returnedFamily ? { ...get().family, ...returnedFamily, babies: get().families.find((f: Family) => f.id === returnedFamily.id)?.babies } : get().family,
        familyMembers: Array.isArray(data.members) ? data.members : [],
      });
    } catch (e) {
      if (!isAuthError(e)) console.error("Failed to fetch family members:", e);
    }
  },

  fetchBabyMembers: async (babyId: string) => {
    const selectedAtStart = get().selectedBabyId;
    const userAtStart = get().user?.id;
    const requestedBabyId = typeof babyId === "string" ? babyId.trim() : "";
    try {
      const data = await request<{ supported?: boolean; babyId?: string; members?: BabyMember[] }>(
        requestedBabyId
          ? `/api/baby/members?babyId=${encodeURIComponent(requestedBabyId)}`
          : "/api/baby/members",
      );
      // A slow response from a previous baby must never repopulate the current
      // baby’s permission panel.
      if (get().user?.id !== userAtStart || get().selectedBabyId !== selectedAtStart) return;
      if (requestedBabyId && get().selectedBabyId !== requestedBabyId) return;
      if (requestedBabyId && data.babyId && data.babyId !== requestedBabyId) {
        throw new Error("宝宝成员响应无效");
      }
      set({
        babyMembersSupported: data.supported === true,
        babyMembers: data.supported === true && requestedBabyId && Array.isArray(data.members) ? data.members : [],
      });
    } catch (e) {
      if (!isAuthError(e)) console.error("Failed to fetch baby members:", e);
      if (!requestedBabyId || get().selectedBabyId === requestedBabyId) {
        set({ babyMembers: [], babyMembersSupported: false });
      }
    }
  },

  grantBabyMember: async (babyId: string, userId: string, role: BabyMemberRole = "member") => {
    if (!babyId.trim() || !userId.trim()) throw new Error("宝宝和家庭成员不能为空");
    await request(`/api/baby/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ babyId: babyId.trim(), userId: userId.trim(), role }),
    });
    await get().fetchBabyMembers(babyId.trim());
  },

  revokeBabyMember: async (babyId: string, userId: string) => {
    if (!babyId.trim() || !userId.trim()) throw new Error("宝宝和家庭成员不能为空");
    await request(`/api/baby/members`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ babyId: babyId.trim(), userId: userId.trim() }),
    });
    invalidateCache("user");
    await get().fetchUser();
    if (get().selectedBabyId === babyId.trim()) await get().fetchBabyMembers(babyId.trim());
  },

  selectBaby: async (babyId: string) => {
    if (typeof babyId !== "string" || !babyId.trim()) throw new Error("请选择宝宝");
    const candidate = get().babies.find((baby: Baby) => baby.id === babyId);
    if (!candidate) throw new Error("无权访问该宝宝");
    const verified = await request<Baby>(`/api/baby?babyId=${encodeURIComponent(babyId)}`);
    const selected = mapBaby(verified) ?? candidate;
    if (selected.id !== babyId) throw new Error("宝宝授权响应无效");
    const family = get().families.find((item: Family) => item.id === selected.familyId) ?? get().family;
    const previousFamilyId = get().family?.id;
    invalidateCache();
    clearScopedData(set);
    set({
      baby: selected,
      selectedBabyId: selected.id,
      family: family ?? null,
      familyMembers: family?.id !== previousFamilyId ? [] : get().familyMembers,
    });
    persistSelectedBaby(get().user?.id, selected.id);
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("baby:selected", { detail: { babyId: selected.id } }));
  },

  createFamilyInvite: async (expiresInDays = 7) => {
    const familyId = get().family?.id;
    if (!familyId) throw new Error("请先选择家庭");
    const data = await request<{ familyId: string; inviteCode: string; expiresAt: string }>("/api/family/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ familyId, expiresInDays }),
    });
    if (!data.inviteCode || !data.expiresAt) throw new Error("邀请码响应无效");
    const family = get().family?.id === familyId ? { ...get().family, inviteCode: data.inviteCode, inviteExpiresAt: data.expiresAt } : get().family;
    const families = get().families.map((item: Family) => item.id === familyId ? { ...item, inviteCode: data.inviteCode, inviteExpiresAt: data.expiresAt } : item);
    set({ family, families });
    return { inviteCode: data.inviteCode, expiresAt: data.expiresAt };
  },
});

// Backward compat for tests that import authSlice
export const authSlice = {} as any;
