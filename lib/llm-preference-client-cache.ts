"use client";

export type LlmPreferenceFeature =
  | "chat"
  | "daily_summary"
  | "tips"
  | "record_parse"
  | "nutrition_parse"
  | "search"
  | "growth_ocr"
  | "medical_ocr"
  | "voice";

export type LlmPreferenceSelection = {
  feature: LlmPreferenceFeature;
  source: "api" | "chatgpt";
  profileId: string;
  modelId: string;
};

export type LlmProfileMetadata = {
  id: string;
  name: string;
  provider: string;
  textModel: string;
  visionModel: string;
  available: boolean;
};

export type ChatGPTModelMetadata = { id: string; name: string; input: string[] };
export type ChatGPTProfileMetadata = {
  id: string;
  email: string;
  name: string;
  connected: boolean;
  sharing: boolean;
  reauthorize: boolean;
};

export type LlmPreferenceSnapshot = {
  preferences: LlmPreferenceSelection[];
  profiles: LlmProfileMetadata[];
  activeProfileId: string;
  defaultModelInfo?: { source: "api"; provider: string; model: string; profileId?: string };
};

const CACHE_PREFIX = "baby-panel:llm-preferences:v1:";
const CHATGPT_MODEL_CACHE_PREFIX = "baby-panel:chatgpt-model-catalog:v1:";
const CHATGPT_PROFILE_CACHE_PREFIX = "baby-panel:chatgpt-profiles:v1:";
const CACHE_PREFIXES = [CACHE_PREFIX, CHATGPT_MODEL_CACHE_PREFIX, CHATGPT_PROFILE_CACHE_PREFIX];
const FEATURES = new Set<LlmPreferenceFeature>([
  "chat", "daily_summary", "tips", "record_parse", "nutrition_parse", "search", "growth_ocr", "medical_ocr", "voice",
]);
const installedStores = new WeakSet<object>();

type UserStateLike = { user?: { id?: unknown } | null; authLoading?: boolean };
type UserStoreLike<State extends UserStateLike> = {
  getState: () => State;
  subscribe: (listener: (state: State, previous: State) => void) => () => void;
};

function safeOwnerId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return id.length > 0 && id.length <= 256 && !/\p{Cc}/u.test(id) ? id : null;
}

function safeString(value: unknown, maxLength = 256): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 && text.length <= maxLength && !/\p{Cc}/u.test(text) ? text : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try { return window.sessionStorage; } catch { return null; }
}

function cacheKey(userId: string): string {
  return CACHE_PREFIX + encodeURIComponent(userId);
}

function chatGPTModelCacheKey(userId: string, profileId: string): string {
  return CHATGPT_MODEL_CACHE_PREFIX + encodeURIComponent(userId) + ":" + encodeURIComponent(profileId);
}

function chatGPTProfileCacheKey(userId: string): string {
  return CHATGPT_PROFILE_CACHE_PREFIX + encodeURIComponent(userId);
}

function normalizeSelection(value: unknown): LlmPreferenceSelection | null {
  if (!isRecord(value)) return null;
  const feature = value.feature;
  const source = value.source;
  const profileId = safeString(value.profileId, 256);
  const modelId = safeString(value.modelId, 256);
  if (typeof feature !== "string" || !FEATURES.has(feature as LlmPreferenceFeature)
    || (source !== "api" && source !== "chatgpt") || !profileId || !modelId) return null;
  return { feature: feature as LlmPreferenceFeature, source, profileId, modelId };
}

export function normalizeLlmPreferenceSnapshot(value: unknown): LlmPreferenceSnapshot | null {
  if (!isRecord(value)) return null;
  const profiles: LlmProfileMetadata[] = [];
  if (Array.isArray(value.profiles)) {
    for (const raw of value.profiles) {
      if (!isRecord(raw)) continue;
      const id = safeString(raw.id, 256);
      const name = safeString(raw.name, 256);
      const provider = safeString(raw.provider, 128);
      const textModel = typeof raw.textModel === "string" ? raw.textModel.slice(0, 256) : "";
      const visionModel = typeof raw.visionModel === "string" ? raw.visionModel.slice(0, 256) : "";
      if (!id || !name || !provider || typeof raw.available !== "boolean") continue;
      profiles.push({ id, name, provider, textModel, visionModel, available: raw.available });
    }
  }

  const preferences = Array.isArray(value.preferences)
    ? value.preferences.map(normalizeSelection).filter((item): item is LlmPreferenceSelection => Boolean(item))
    : [];
  const activeProfileId = safeString(value.activeProfileId, 256) || "";
  const rawDefault = isRecord(value.defaultModelInfo) ? value.defaultModelInfo : null;
  let defaultModelInfo: LlmPreferenceSnapshot["defaultModelInfo"];
  if (rawDefault?.source === "api") {
    const provider = safeString(rawDefault.provider, 128);
    const model = safeString(rawDefault.model, 256);
    const profileId = safeString(rawDefault.profileId, 256) || undefined;
    if (provider && model) defaultModelInfo = { source: "api", provider, model, ...(profileId ? { profileId } : {}) };
  }
  return { preferences, profiles, activeProfileId, ...(defaultModelInfo ? { defaultModelInfo } : {}) };
}

export function readLlmPreferenceSnapshot(userIdValue: unknown): LlmPreferenceSnapshot | null {
  const userId = safeOwnerId(userIdValue);
  const store = storage();
  if (!userId || !store) return null;
  const key = cacheKey(userId);
  let raw: string | null;
  try { raw = store.getItem(key); } catch { return null; }
  if (!raw) return null;
  try {
    const envelope: unknown = JSON.parse(raw);
    if (!isRecord(envelope) || envelope.schema !== 1 || envelope.ownerId !== userId) throw new Error("invalid cache envelope");
    const snapshot = normalizeLlmPreferenceSnapshot(envelope.data);
    if (!snapshot) throw new Error("invalid cache metadata");
    return snapshot;
  } catch {
    try { store.removeItem(key); } catch {}
    return null;
  }
}

export function writeLlmPreferenceSnapshot(userIdValue: unknown, value: unknown): void {
  const userId = safeOwnerId(userIdValue);
  const store = storage();
  const snapshot = normalizeLlmPreferenceSnapshot(value);
  if (!userId || !store || !snapshot) return;
  try {
    store.setItem(cacheKey(userId), JSON.stringify({ schema: 1, ownerId: userId, data: snapshot }));
  } catch {}
}

export function cacheLlmPreferenceSelection(userIdValue: unknown, selectionValue: unknown): void {
  const userId = safeOwnerId(userIdValue);
  const selection = normalizeSelection(selectionValue);
  if (!userId || !selection) return;
  const current = readLlmPreferenceSnapshot(userId) || { preferences: [], profiles: [], activeProfileId: "" };
  const preferences = current.preferences.filter((item) => item.feature !== selection.feature);
  preferences.push(selection);
  writeLlmPreferenceSnapshot(userId, { ...current, preferences });
}

function safeChatGPTModels(value: unknown): ChatGPTModelMetadata[] | null {
  if (!Array.isArray(value)) return null;
  const models: ChatGPTModelMetadata[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const id = safeString(raw.id, 256);
    const name = safeString(raw.name, 256);
    if (!id || !name) continue;
    const input = Array.isArray(raw.input)
      ? Array.from(new Set(raw.input.filter((item): item is string => item === "text" || item === "image"))).slice(0, 2)
      : [];
    models.push({ id, name, input });
    if (models.length >= 256) break;
  }
  return models;
}

export function normalizeChatGPTModelCatalog(value: unknown): ChatGPTModelMetadata[] | null {
  return safeChatGPTModels(value);
}

function safeChatGPTProfiles(value: unknown): ChatGPTProfileMetadata[] | null {
  if (!Array.isArray(value)) return null;
  const profiles: ChatGPTProfileMetadata[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const id = safeString(raw.id, 256);
    if (!id || typeof raw.connected !== "boolean" || typeof raw.sharing !== "boolean") continue;
    profiles.push({
      id,
      email: safeString(raw.email, 256) || "",
      name: safeString(raw.name, 256) || "",
      connected: raw.connected,
      sharing: raw.sharing,
      reauthorize: typeof raw.reauthorize === "boolean" ? raw.reauthorize : !(raw.connected && raw.sharing),
    });
    if (profiles.length >= 128) break;
  }
  return profiles;
}

export function normalizeChatGPTProfileMetadata(value: unknown): ChatGPTProfileMetadata[] | null {
  return safeChatGPTProfiles(value);
}

export function readChatGPTProfileMetadata(userIdValue: unknown): ChatGPTProfileMetadata[] | null {
  const userId = safeOwnerId(userIdValue);
  const store = storage();
  if (!userId || !store) return null;
  const key = chatGPTProfileCacheKey(userId);
  let raw: string | null;
  try { raw = store.getItem(key); } catch { return null; }
  if (!raw) return null;
  try {
    const envelope: unknown = JSON.parse(raw);
    if (!isRecord(envelope) || envelope.schema !== 1 || envelope.ownerId !== userId) throw new Error("invalid profile metadata envelope");
    const profiles = safeChatGPTProfiles(envelope.profiles);
    if (!profiles) throw new Error("invalid profile metadata");
    return profiles;
  } catch {
    try { store.removeItem(key); } catch {}
    return null;
  }
}

export function writeChatGPTProfileMetadata(userIdValue: unknown, value: unknown): void {
  const userId = safeOwnerId(userIdValue);
  const store = storage();
  const profiles = safeChatGPTProfiles(value);
  if (!userId || !store || !profiles) return;
  try {
    store.setItem(chatGPTProfileCacheKey(userId), JSON.stringify({ schema: 1, ownerId: userId, profiles }));
  } catch {}
}

export function clearChatGPTProfileMetadata(userIdValue: unknown): void {
  const userId = safeOwnerId(userIdValue);
  const store = storage();
  if (!userId || !store) return;
  try { store.removeItem(chatGPTProfileCacheKey(userId)); } catch {}
}

export function readChatGPTModelCatalog(userIdValue: unknown, profileIdValue: unknown): ChatGPTModelMetadata[] | null {
  const userId = safeOwnerId(userIdValue);
  const profileId = safeString(profileIdValue, 256);
  const store = storage();
  if (!userId || !profileId || !store) return null;
  const key = chatGPTModelCacheKey(userId, profileId);
  let raw: string | null;
  try { raw = store.getItem(key); } catch { return null; }
  if (!raw) return null;
  try {
    const envelope: unknown = JSON.parse(raw);
    if (!isRecord(envelope) || envelope.schema !== 1 || envelope.ownerId !== userId || envelope.profileId !== profileId) throw new Error("invalid model catalog envelope");
    const models = safeChatGPTModels(envelope.models);
    if (!models) throw new Error("invalid model catalog metadata");
    return models;
  } catch {
    try { store.removeItem(key); } catch {}
    return null;
  }
}

export function writeChatGPTModelCatalog(userIdValue: unknown, profileIdValue: unknown, value: unknown): void {
  const userId = safeOwnerId(userIdValue);
  const profileId = safeString(profileIdValue, 256);
  const store = storage();
  const models = safeChatGPTModels(value);
  if (!userId || !profileId || !store || !models) return;
  try {
    store.setItem(chatGPTModelCacheKey(userId, profileId), JSON.stringify({ schema: 1, ownerId: userId, profileId, models }));
  } catch {}
}

export function clearChatGPTModelCatalog(userIdValue: unknown, profileIdValue: unknown): void {
  const userId = safeOwnerId(userIdValue);
  const profileId = safeString(profileIdValue, 256);
  const store = storage();
  if (!userId || !profileId || !store) return;
  try { store.removeItem(chatGPTModelCacheKey(userId, profileId)); } catch {}
}

export function clearLlmPreferenceCache(userIdValue: unknown): void {
  const userId = safeOwnerId(userIdValue);
  const store = storage();
  if (!userId || !store) return;
  try {
    store.removeItem(cacheKey(userId));
    store.removeItem(chatGPTProfileCacheKey(userId));
    const catalogPrefix = CHATGPT_MODEL_CACHE_PREFIX + encodeURIComponent(userId) + ":";
    for (let index = store.length - 1; index >= 0; index -= 1) {
      const key = store.key(index);
      if (key?.startsWith(catalogPrefix)) store.removeItem(key);
    }
  } catch {}
}

export function clearAllLlmPreferenceCaches(): void {
  const store = storage();
  if (!store) return;
  try {
    for (let index = store.length - 1; index >= 0; index -= 1) {
      const key = store.key(index);
      if (key && CACHE_PREFIXES.some(prefix => key.startsWith(prefix))) store.removeItem(key);
    }
  } catch {}
}

export function installLlmPreferenceLogoutCleanup<State extends UserStateLike>(store: UserStoreLike<State>): void {
  if (typeof window === "undefined" || installedStores.has(store as object)) return;
  installedStores.add(store as object);
  const initial = store.getState();
  let previousUserId = safeOwnerId(initial.user?.id);
  let previousAuthLoading = initial.authLoading !== false;
  if (!previousUserId && !previousAuthLoading) clearAllLlmPreferenceCaches();
  store.subscribe((next) => {
    const nextUserId = safeOwnerId(next.user?.id);
    const nextAuthLoading = next.authLoading !== false;
    if (previousUserId && previousUserId !== nextUserId) clearLlmPreferenceCache(previousUserId);
    if (!nextUserId && !nextAuthLoading && (previousUserId || previousAuthLoading)) clearAllLlmPreferenceCaches();
    previousUserId = nextUserId;
    previousAuthLoading = nextAuthLoading;
  });
}
