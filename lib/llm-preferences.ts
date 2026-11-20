import { constants } from "node:fs";
import { open, mkdir, lstat, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { GROWDESK_CONFIG } from "@/lib/config";
import {
  getActiveLlmProfile,
  getActiveLlmProfileId,
  getLlmProfileById,
  getLlmProfileProvider,
  listLlmProfileEntries,
  resolveLlmProfileModel,
  OPENAI_OFFICIAL_PROFILE_ID,
} from "@/lib/llm-profiles";
import { defaultLlmFeatureProfileId, matchesLlmSelection, usesVisionModel } from "@/lib/llm-feature-model";
import { getChatGPTPlan } from "@/lib/chatgpt-plan";
import { growdeskFetch } from "@/lib/growdesk/client";
import { requireData } from "@/lib/growdesk/bridge-protocol";

export const LLM_FEATURES = [
  "chat",
  "daily_summary",
  "tips",
  "record_parse",
  "nutrition_parse",
  "search",
  "growth_ocr",
  "medical_ocr",
  "voice",
] as const;

export type LlmFeature = (typeof LLM_FEATURES)[number];
export type LlmPreferenceSource = "api" | "chatgpt";
export const GPT_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type GptEffort = (typeof GPT_EFFORTS)[number];

export interface LlmSelection {
  feature: LlmFeature;
  source: LlmPreferenceSource;
  profileId: string;
  modelId: string;
  reasoningEffort?: GptEffort | null;
}

export interface LlmModelInfo {
  source: LlmPreferenceSource;
  provider: string;
  model: string;
  profileId?: string;
}

export interface LlmProfilePublic {
  id: string;
  name: string;
  provider: string;
  textModel: string;
  visionModel: string;
  available: boolean;
}

export class LlmPreferenceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "LlmPreferenceError";
    this.status = status;
    this.code = code;
  }
}

interface PreferenceFile {
  version: 1;
  users: Record<string, Partial<Record<LlmFeature, LlmSelection>>>;
}

const PROFILE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;
const OWNER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const fileLocks = new Map<string, Promise<void>>();

function isLlmFeature(value: unknown): value is LlmFeature {
  return typeof value === "string" && (LLM_FEATURES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateOwner(owner: string): void {
  if (typeof owner !== "string" || !OWNER_PATTERN.test(owner)) {
    throw new LlmPreferenceError(400, "invalid_owner", "Authenticated user identifier is invalid");
  }
}

function parseSelection(value: unknown): LlmSelection {
  if (!isRecord(value)) {
    throw new LlmPreferenceError(502, "invalid_preferences_response", "AI preference data is invalid");
  }
  const keys = Object.keys(value).sort();
  const keysValid = keys.join(",") === "feature,modelId,profileId,source" || keys.join(",") === "feature,modelId,profileId,reasoningEffort,source";
  if (!keysValid ||
      !isLlmFeature(value.feature) ||
      (value.source !== "api" && value.source !== "chatgpt") ||
      typeof value.profileId !== "string" || !PROFILE_ID_PATTERN.test(value.profileId) ||
      typeof value.modelId !== "string" || !MODEL_ID_PATTERN.test(value.modelId) ||
      ("reasoningEffort" in value && value.reasoningEffort !== null && !(typeof value.reasoningEffort === "string" && (GPT_EFFORTS as readonly string[]).includes(value.reasoningEffort))) ||
      (value.reasoningEffort === "max" && value.feature !== "chat" && value.feature !== "voice")) {
    throw new LlmPreferenceError(400, "invalid_selection", "Choose a valid AI profile and model");
  }
  return {
    feature: value.feature,
    source: value.source,
    profileId: value.profileId,
    modelId: value.modelId,
    ...("reasoningEffort" in value ? { reasoningEffort: value.reasoningEffort as GptEffort | null } : {}),
  };
}

function preferenceFilePath(): string {
  const configured = process.env.LLM_PREFERENCES_FILE?.trim();
  return path.resolve(configured || path.join(process.cwd(), ".data", "llm-preferences.json"));
}

function storageError(message = "AI preferences could not be read or saved"): LlmPreferenceError {
  return new LlmPreferenceError(500, "llm_preferences_storage_error", message);
}

/** File-backed preferences for legacy mode. The path is injectable for isolated tests. */
export class FileLlmPreferenceStore {
  readonly filePath: string;

  constructor(filePath = preferenceFilePath()) {
    this.filePath = path.resolve(filePath);
  }

  private async locked<T>(operation: () => Promise<T>): Promise<T> {
    const key = this.filePath;
    const previous = fileLocks.get(key) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    fileLocks.set(key, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (fileLocks.get(key) === current) fileLocks.delete(key);
    }
  }

  private async read(): Promise<PreferenceFile> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(this.filePath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1_048_576) throw storageError();
      const parsed: unknown = JSON.parse(await handle.readFile("utf8"));
      if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.users)) throw storageError();
      const users: PreferenceFile["users"] = Object.create(null) as PreferenceFile["users"];
      for (const [owner, rawFeatures] of Object.entries(parsed.users)) {
        try { validateOwner(owner); } catch { throw storageError(); }
        if (!isRecord(rawFeatures)) throw storageError();
        const features: Partial<Record<LlmFeature, LlmSelection>> = Object.create(null) as Partial<Record<LlmFeature, LlmSelection>>;
        for (const [feature, rawSelection] of Object.entries(rawFeatures)) {
          if (!isLlmFeature(feature)) throw storageError();
          let selection: LlmSelection;
          try { selection = parseSelection(rawSelection); } catch { throw storageError(); }
          if (selection.feature !== feature) throw storageError();
          features[feature] = selection;
        }
        users[owner] = features;
      }
      return { version: 1, users };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, users: Object.create(null) as PreferenceFile["users"] };
      if (error instanceof LlmPreferenceError) throw error;
      throw storageError();
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  private async write(data: PreferenceFile): Promise<void> {
    const directory = path.dirname(this.filePath);
    let temporary = "";
    let fileHandle: Awaited<ReturnType<typeof open>> | undefined;
    let directoryHandle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const directoryStat = await lstat(directory);
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw storageError();
      temporary = this.filePath + "." + randomBytes(12).toString("hex") + ".tmp";
      fileHandle = await open(
        temporary,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW || 0),
        0o600,
      );
      await fileHandle.writeFile(JSON.stringify(data), { encoding: "utf8" });
      await fileHandle.sync();
      await fileHandle.close();
      fileHandle = undefined;
      await rename(temporary, this.filePath);
      temporary = "";
      directoryHandle = await open(directory, constants.O_RDONLY);
      await directoryHandle.sync();
    } catch (error) {
      if (error instanceof LlmPreferenceError) throw error;
      throw storageError();
    } finally {
      await fileHandle?.close().catch(() => undefined);
      await directoryHandle?.close().catch(() => undefined);
      if (temporary) await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async list(owner: string): Promise<LlmSelection[]> {
    validateOwner(owner);
    return this.locked(async () => Object.values((await this.read()).users[owner] || {}));
  }

  async get(owner: string, feature: LlmFeature): Promise<LlmSelection | undefined> {
    validateOwner(owner);
    if (!isLlmFeature(feature)) throw new LlmPreferenceError(400, "invalid_feature", "AI feature is invalid");
    return this.locked(async () => (await this.read()).users[owner]?.[feature]);
  }

  async set(owner: string, selectionValue: unknown, expectActiveModel = false): Promise<LlmSelection> {
    validateOwner(owner);
    const selection = parseSelection(selectionValue);
    return this.locked(async () => {
      const data = await this.read();
      const users = data.users as Record<string, Partial<Record<LlmFeature, LlmSelection>>>;
      const preferences = users[owner] || (users[owner] = Object.create(null) as Partial<Record<LlmFeature, LlmSelection>>);
      const existing = preferences[selection.feature];
      if (expectActiveModel) assertEffortSelection(selection, existing && normalizeSavedSelection(existing));
      preferences[selection.feature] = !("reasoningEffort" in selection) && existing?.reasoningEffort
        ? { ...selection, reasoningEffort: existing.reasoningEffort }
        : selection;
      await this.write(data);
      return preferences[selection.feature]!;
    });
  }
}

let cachedFileStore: FileLlmPreferenceStore | undefined;
function localStore(): FileLlmPreferenceStore {
  const filePath = preferenceFilePath();
  if (!cachedFileStore || cachedFileStore.filePath !== filePath) cachedFileStore = new FileLlmPreferenceStore(filePath);
  return cachedFileStore;
}

function usesSharedPreferences(accessToken?: string): boolean {
  return Boolean(accessToken) || GROWDESK_CONFIG.enabled;
}

function requireSharedToken(accessToken?: string): string {
  if (!accessToken) throw new LlmPreferenceError(401, "llm_preferences_auth_required", "Sign in to load AI preferences");
  return accessToken;
}

function parseRemotePreferences(value: unknown): LlmSelection[] {
  if (!isRecord(value) || !Array.isArray(value.preferences)) {
    throw new LlmPreferenceError(502, "invalid_preferences_response", "GrowDesk returned invalid AI preferences");
  }
  return value.preferences.map(parseSelection);
}

export function getLlmProfileCatalog(): LlmProfilePublic[] {
  return listLlmProfileEntries().map(({ id, profile }) => ({
    id,
    name: profile.name || id,
    provider: getLlmProfileProvider(profile),
    textModel: resolveLlmProfileModel(profile),
    visionModel: resolveLlmProfileModel(profile, true),
    available: Boolean(profile.apiKey && profile.baseUrl),
  }));
}

export function getDefaultLlmModelInfo(vision = false): LlmModelInfo {
  const profile = getActiveLlmProfile();
  return {
    source: "api",
    provider: getLlmProfileProvider(profile),
    model: resolveLlmProfileModel(profile, vision),
    profileId: getActiveLlmProfileId(),
  };
}

/** Default routing for features without an explicitly saved preference. */
export function getDefaultFeatureLlmSelection(feature: LlmFeature): LlmSelection {
  if (!isLlmFeature(feature)) throw new LlmPreferenceError(400, "invalid_feature", "AI feature is invalid");
  const profileId = defaultLlmFeatureProfileId(feature);
  const profile = getLlmProfileById(profileId);
  if (!profile?.baseUrl) {
    throw new LlmPreferenceError(503, "llm_profile_unavailable", "The default AI profile is unavailable");
  }
  return {
    feature,
    source: "api",
    profileId,
    modelId: resolveLlmProfileModel(profile, usesVisionModel(feature)),
  };
}

export async function getLlmPreferences(owner: string, accessToken?: string): Promise<LlmSelection[]> {
  validateOwner(owner);
  let selections: LlmSelection[];
  if (!usesSharedPreferences(accessToken)) {
    selections = await localStore().list(owner);
  } else {
    const token = requireSharedToken(accessToken);
    const data = requireData(await growdeskFetch<{ preferences: unknown }>("/api/v1/web/ai/preferences", { accessToken: token }));
    selections = parseRemotePreferences(data);
  }
  return selections.map(normalizeSavedSelection);
}

function normalizeSavedSelection(selection: LlmSelection): LlmSelection {
  const upgradeOfficial = selection.source === "api" && selection.profileId === OPENAI_OFFICIAL_PROFILE_ID
    && selection.modelId === "gpt-6-luna";
  if (!upgradeOfficial) return selection;
  const profile = getLlmProfileById(selection.profileId);
  return profile ? { ...selection, modelId: resolveLlmProfileModel(profile, usesVisionModel(selection.feature)) } : selection;
}

function assertEffortSelection(expected: LlmSelection, saved?: LlmSelection): void {
  const active = saved || getDefaultFeatureLlmSelection(expected.feature);
  if (!matchesLlmSelection(expected, active)) {
    throw new LlmPreferenceError(409, "llm_selection_changed", "模型配置已变更，请刷新后重试");
  }
}

export async function getFeatureLlmSelection(
  owner: string,
  feature: LlmFeature,
  accessToken?: string,
): Promise<LlmSelection | undefined> {
  if (!isLlmFeature(feature)) throw new LlmPreferenceError(400, "invalid_feature", "AI feature is invalid");
  return (await getLlmPreferences(owner, accessToken)).find((selection) => selection.feature === feature);
}

export async function validateLlmSelection(owner: string, value: unknown): Promise<LlmSelection> {
  validateOwner(owner);
  const selection = parseSelection(value);
  if (selection.source === "chatgpt") {
    try {
      const models = await getChatGPTPlan().models(owner, selection.profileId);
      const model = models.find((entry) => entry.id === selection.modelId);
      const vision = usesVisionModel(selection.feature);
      if (!model || !Array.isArray(model.input) || !model.input.includes("text") ||
          vision && !model.input.includes("image")) {
        throw new LlmPreferenceError(400, "chatgpt_model_unavailable", "The selected ChatGPT model is unavailable for this feature");
      }
    } catch (error) {
      if (error instanceof LlmPreferenceError) throw error;
      throw new LlmPreferenceError(400, "chatgpt_model_unavailable", "Connect the selected ChatGPT account and refresh its models");
    }
    return selection;
  }

  const profile = getLlmProfileById(selection.profileId);
  if (!profile || !profile.baseUrl || !profile.apiKey) {
    throw new LlmPreferenceError(400, "llm_profile_unavailable", "The selected API profile is unavailable");
  }
  const vision = usesVisionModel(selection.feature);
  const expectedModel = resolveLlmProfileModel(profile, vision);
  const allowedModels = selection.feature === "chat"
    ? [resolveLlmProfileModel(profile), resolveLlmProfileModel(profile, true)]
    : [expectedModel];
  if (!allowedModels.includes(selection.modelId)) {
    throw new LlmPreferenceError(400, "llm_model_unavailable", "The selected model is not available for this feature");
  }
  return selection;
}

export async function saveLlmPreference(
  owner: string,
  value: unknown,
  accessToken?: string,
): Promise<LlmSelection> {
  const requested = parseSelection(value);
  const effortOnly = "reasoningEffort" in requested;
  if (effortOnly && (requested.source !== "api" || requested.profileId !== OPENAI_OFFICIAL_PROFILE_ID || requested.feature === "search")) {
    throw new LlmPreferenceError(400, "llm_effort_unavailable", "该模型配置不支持在此调整推理强度");
  }
  const selection = await validateLlmSelection(owner, requested);
  if (!usesSharedPreferences(accessToken)) return localStore().set(owner, selection, effortOnly);
  const token = requireSharedToken(accessToken);
  if (effortOnly) assertEffortSelection(selection, await getFeatureLlmSelection(owner, selection.feature, token));
  const data = requireData(await growdeskFetch<LlmSelection>("/api/v1/web/ai/preferences", {
    method: "PUT",
    accessToken: token,
    body: selection,
  }));
  return parseSelection(data);
}
