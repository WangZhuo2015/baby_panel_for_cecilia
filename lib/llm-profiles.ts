import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";

export interface LlmProfile {
  name?: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  visionModel?: string;
  headers?: Record<string, string>;
  completionExtras?: Record<string, unknown>;
}

export interface LlmProfilesConfig {
  activeProfile: string;
  profiles: Record<string, LlmProfile>;
}

export interface ScopedLlmProfile {
  profileId: string;
  modelId: string;
  profile: LlmProfile;
}

const profileScope = new AsyncLocalStorage<ScopedLlmProfile | undefined>();

const CONFIG_FILENAME = "llm-profiles.json";

function getProfilesFilePath(): string {
  return path.resolve(process.env.LLM_PROFILES_FILE?.trim() || path.join(process.cwd(), CONFIG_FILENAME));
}

function getEnvFilePath(): string {
  return path.resolve(process.cwd(), ".env");
}

function isTestEnvironment(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.npm_lifecycle_event?.includes("test")) ||
    process.argv.some((arg) => arg.includes("test"))
  );
}

export const OPENAI_OFFICIAL_PROFILE_ID = "openai-official";
export const AMD_V41_PROFILE_ID = "amd-v4.1-flash";
const OPENAI_OFFICIAL_BASE = "https://api.openai.com/v1";
const AMD_V41_BASE = "https://developer.amd.com.cn/radeon/api/v1";
const MAX_OPENAI_KEY_BYTES = 16_384;

/** Resolve only explicitly configured key sources. Never guess a repository-local key path. */
export function resolveOfficialOpenAiKey(): string {
  const inline = process.env.GROWDESK_AI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (inline) return inline;
  const configuredPath = process.env.GROWDESK_AI_API_KEY_FILE?.trim();
  if (!configuredPath) return "";

  let fd: number | undefined;
  try {
    fd = fs.openSync(configuredPath, fs.constants.O_RDONLY);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_OPENAI_KEY_BYTES) throw new Error();
    const buffer = Buffer.alloc(MAX_OPENAI_KEY_BYTES + 1);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_OPENAI_KEY_BYTES) throw new Error();
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead));
    const key = raw.trim();
    if (!key || /[\s\p{Cc}]/u.test(key)) throw new Error();
    return key;
  } catch {
    throw new Error("Official OpenAI API key configuration is invalid");
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
  }
}

function isAmdApiRoot(value: unknown): boolean {
  if (typeof value !== "string" || !/^https:\/\/developer\.amd\.com\.cn\/radeon\/api\/v1\/?$/i.test(value.trim())) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.toLowerCase() === "developer.amd.com.cn"
      && !url.username && !url.password && !url.port && !url.search && !url.hash
      && (url.pathname === "/radeon/api/v1" || url.pathname === "/radeon/api/v1/");
  } catch {
    return false;
  }
}

function configuredAmdProfile(config: LlmProfilesConfig | null): LlmProfile | undefined {
  if (!config) return undefined;
  const candidates = Object.values(config.profiles).filter(profile =>
    profile && isAmdApiRoot(profile.baseUrl) && typeof profile.apiKey === "string" && Boolean(profile.apiKey.trim()),
  );
  const activeId = process.env.LLM_PROFILE?.trim() || config.activeProfile;
  const active = config.profiles[activeId];
  return active && candidates.includes(active) ? active : candidates[0];
}

function getBuiltInProfiles(config: LlmProfilesConfig | null): Array<{ id: string; profile: LlmProfile }> {
  const configuredAmd = isTestEnvironment() ? undefined : configuredAmdProfile(config);
  const testAmdKey = isTestEnvironment() ? process.env.AMD_API_KEY?.trim() || "" : "";
  return [
    {
      id: OPENAI_OFFICIAL_PROFILE_ID,
      profile: {
        name: "OpenAI official API · GPT-6 Luna",
        baseUrl: OPENAI_OFFICIAL_BASE,
        apiKey: resolveOfficialOpenAiKey(),
        model: "gpt-6-luna",
        visionModel: "gpt-6-luna",
      },
    },
    {
      id: AMD_V41_PROFILE_ID,
      profile: {
        name: "AMD · DeepSeek V4.1 Flash",
        baseUrl: AMD_V41_BASE,
        apiKey: configuredAmd?.apiKey?.trim() || testAmdKey,
        ...(configuredAmd?.headers ? { headers: configuredAmd.headers } : {}),
        ...(configuredAmd?.completionExtras ? { completionExtras: configuredAmd.completionExtras } : {}),
        model: "DeepSeek-V4.1-Flash",
        visionModel: "DeepSeek-V4.1-Flash",
      },
    },
  ];
}

/** Fallback profile created from explicitly configured legacy environment variables. */
function getLegacyEnvProfile(): LlmProfile {
  const explicitBase = process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL;
  const baseUrl = (explicitBase || "https://opencode.ai/zen/go/v1").replace(/\/+$/, "");
  const apiKey = process.env.AI_API_KEY || (explicitBase ? process.env.OPENAI_API_KEY : "") || "";
  const model = process.env.AI_MODEL || process.env.OPENAI_MODEL || "Qwen3.8-Flash-Next";
  const visionModel = process.env.AI_VISION_MODEL || "Qwen3.8-Flash-Next";

  return { name: "Legacy Environment", baseUrl, apiKey, model, visionModel };
}

let cachedConfig: { filePath: string; mtimeMs: number; config: LlmProfilesConfig } | null = null;

export function loadLlmProfilesConfig(): LlmProfilesConfig | null {
  const filePath = getProfilesFilePath();
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const stat = fs.statSync(filePath);
    if (cachedConfig && cachedConfig.filePath === filePath && cachedConfig.mtimeMs === stat.mtimeMs) {
      return cachedConfig.config;
    }
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content) as LlmProfilesConfig;
    if (parsed && typeof parsed === "object" && parsed.profiles) {
      cachedConfig = { filePath, mtimeMs: stat.mtimeMs, config: parsed };
      return parsed;
    }
  } catch (err) {
    console.warn(`[LLM Profiles] Failed to read ${CONFIG_FILENAME}:`, (err as Error).message);
  }
  return null;
}

export function listLlmProfileEntries(): Array<{ id: string; profile: LlmProfile }> {
  // Tests use only virtual environment keys and never load the operator profile file.
  const configured = isTestEnvironment() ? null : loadLlmProfilesConfig();
  const builtIns = getBuiltInProfiles(configured);
  const custom = configured
    ? Object.entries(configured.profiles)
        .filter(([id, profile]) => ![OPENAI_OFFICIAL_PROFILE_ID, AMD_V41_PROFILE_ID].includes(id) && Boolean(profile && profile.baseUrl))
        .map(([id, profile]) => ({ id, profile }))
    : [];
  const hasLegacyConfig = isTestEnvironment() || Boolean(
    process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || process.env.AI_API_KEY,
  );
  const legacy = hasLegacyConfig && !custom.some(({ id }) => id === "default")
    ? [{ id: "default", profile: getLegacyEnvProfile() }]
    : [];
  return [...builtIns, ...custom, ...legacy];
}

export function getLlmProfileById(profileId: string): LlmProfile | null {
  return listLlmProfileEntries().find((entry) => entry.id === profileId)?.profile || null;
}

export function isOfficialOpenAiProfileActive(): boolean {
  return getActiveLlmProfileId() === OPENAI_OFFICIAL_PROFILE_ID;
}

export function getActiveLlmProfileId(): string {
  const scoped = profileScope.getStore();
  if (scoped) return scoped.profileId;
  if (isTestEnvironment()) return "default";
  const requested = process.env.LLM_PROFILE?.trim();
  if (requested && getLlmProfileById(requested)?.baseUrl) return requested;
  return OPENAI_OFFICIAL_PROFILE_ID;
}

export function getLlmProfileScope(): ScopedLlmProfile | undefined {
  return profileScope.getStore();
}

/** Apply a validated profile/model only for the current async request chain. */
export function runWithLlmProfileScope<T>(
  profileId: string | null,
  modelId: string | null,
  callback: () => T,
): T {
  if (!profileId || !modelId) return profileScope.run(undefined, callback);
  const profile = getLlmProfileById(profileId);
  if (!profile || !profile.apiKey) {
    throw new Error("Selected LLM profile is unavailable");
  }
  return profileScope.run({
    profileId,
    modelId,
    profile: { ...profile, model: modelId, visionModel: modelId },
  }, callback);
}

export function resolveLlmProfileModel(profile: LlmProfile, vision = false): string {
  if (vision) {
    if (profile.visionModel && profile.visionModel !== "hermes-agent") return profile.visionModel;
    const configured = process.env.AI_VISION_MODEL;
    if (configured && configured !== "hermes-agent") return configured;
    return "Qwen3.8-Flash-Next";
  }

  if (profile.model) {
    if (profile.model === "hermes-agent" || (profile.baseUrl.includes("opencode.ai") && profile.model.includes("muse-spark"))) {
      return "Qwen3.8-Flash-Next";
    }
    return profile.model;
  }

  if (process.env.OPENROUTER_API_KEY && !process.env.AI_BASE_URL && !process.env.OPENAI_BASE_URL) {
    return process.env.OPENROUTER_MODEL || "muse-spark-1.2-contributor";
  }
  const model = process.env.AI_MODEL || process.env.OPENAI_MODEL || "";
  if (!model || model === "hermes-agent" || (profile.baseUrl.includes("opencode.ai") && model.includes("muse-spark"))) {
    return "Qwen3.8-Flash-Next";
  }
  return model;
}

export function getLlmProviderId(baseUrl: string): string {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    if (host === "openrouter.ai" || host.endsWith(".openrouter.ai")) return "openrouter";
    if (host === "opencode.ai" || host.endsWith(".opencode.ai")) return "opencode";
    if (host === "api.openai.com" || host.endsWith(".openai.com")) return "openai";
  } catch {}
  return "custom";
}

export function getLlmProfileProvider(profile: LlmProfile): string {
  const ignored = /:8642\b/.test(profile.baseUrl || "");
  const baseUrl = profile.baseUrl && !ignored
    ? profile.baseUrl
    : process.env.OPENROUTER_API_KEY && !process.env.AI_BASE_URL && !process.env.OPENAI_BASE_URL
      ? "https://openrouter.ai/api/v1"
      : process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1";
  return getLlmProviderId(baseUrl);
}

export function getActiveLlmProfile(): LlmProfile {
  const scoped = profileScope.getStore();
  if (scoped) return scoped.profile;

  // During tests, always enforce isolated environment configuration
  if (isTestEnvironment()) {
    return getLegacyEnvProfile();
  }

  const requested = process.env.LLM_PROFILE?.trim();
  if (requested) {
    const profile = getLlmProfileById(requested);
    if (profile?.baseUrl) return profile;
  }
  if (!isTestEnvironment()) {
    const official = getLlmProfileById(OPENAI_OFFICIAL_PROFILE_ID);
    if (official) return official;
  }
  return getLegacyEnvProfile();
}

export function getLlmProfiles(): { activeProfile: string; profiles: Record<string, LlmProfile> } {
  const entries = listLlmProfileEntries();
  const requested = process.env.LLM_PROFILE?.trim();
  const activeProfile = requested && entries.some(({ id }) => id === requested)
    ? requested
    : isTestEnvironment() ? "default" : OPENAI_OFFICIAL_PROFILE_ID;
  return {
    activeProfile,
    profiles: Object.fromEntries(entries.map(({ id, profile }) => [id, profile])),
  };
}

export function syncActiveProfileToEnv(profile: LlmProfile, profileKey?: string): boolean {
  const envPath = getEnvFilePath();
  try {
    if (!fs.existsSync(envPath)) return false;
    let content = fs.readFileSync(envPath, "utf-8");

    const setEnvVar = (key: string, value: string) => {
      const regex = new RegExp(`^${key}=.*$`, "m");
      const newLine = `${key}="${value}"`;
      if (regex.test(content)) {
        content = content.replace(regex, newLine);
      } else {
        content = `${content.trimEnd()}\n${newLine}\n`;
      }
    };

    setEnvVar("AI_BASE_URL", profile.baseUrl);
    setEnvVar("AI_API_KEY", profile.apiKey);
    setEnvVar("AI_MODEL", profile.model);
    setEnvVar("AI_VISION_MODEL", profile.visionModel || profile.model);
    if (profileKey) {
      setEnvVar("LLM_PROFILE", profileKey);
    }

    fs.writeFileSync(envPath, content, "utf-8");
    return true;
  } catch (err) {
    console.error("[LLM Profiles] Failed to sync to .env:", (err as Error).message);
    return false;
  }
}

export function switchActiveProfile(
  profileId: string,
  options: { syncEnv?: boolean } = { syncEnv: true }
): { success: boolean; profile?: LlmProfile; error?: string } {
  const filePath = getProfilesFilePath();
  try {
    if (!fs.existsSync(filePath)) {
      return { success: false, error: `${CONFIG_FILENAME} does not exist.` };
    }
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content) as LlmProfilesConfig;

    if (!parsed.profiles || !parsed.profiles[profileId]) {
      const available = Object.keys(parsed.profiles || {}).join(", ");
      return {
        success: false,
        error: `Profile "${profileId}" not found. Available profiles: ${available}`,
      };
    }

    parsed.activeProfile = profileId;
    fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2) + "\n", "utf-8");

    // Invalidate cache
    cachedConfig = null;

    const selectedProfile = parsed.profiles[profileId];

    if (options.syncEnv && ![OPENAI_OFFICIAL_PROFILE_ID, AMD_V41_PROFILE_ID].includes(profileId)) {
      syncActiveProfileToEnv(selectedProfile, profileId);
    }

    return { success: true, profile: selectedProfile };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
