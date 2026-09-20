import fs from "node:fs";
import path from "node:path";

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

const CONFIG_FILENAME = "llm-profiles.json";

function getProfilesFilePath(): string {
  return path.resolve(process.cwd(), CONFIG_FILENAME);
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

/** Fallback profile created from legacy / environment variables */
function getLegacyEnvProfile(): LlmProfile {
  const baseUrl = (process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || "https://opencode.ai/zen/go/v1").replace(/\/+$/, "");
  const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "";
  const model = process.env.AI_MODEL || process.env.OPENAI_MODEL || "Qwen3.8-Flash-Next";
  const visionModel = process.env.AI_VISION_MODEL || "Qwen3.8-Flash-Next";

  return {
    name: "Legacy Environment",
    baseUrl,
    apiKey,
    model,
    visionModel,
  };
}

let cachedConfig: { mtimeMs: number; config: LlmProfilesConfig } | null = null;

export function loadLlmProfilesConfig(): LlmProfilesConfig | null {
  const filePath = getProfilesFilePath();
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const stat = fs.statSync(filePath);
    if (cachedConfig && cachedConfig.mtimeMs === stat.mtimeMs) {
      return cachedConfig.config;
    }
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content) as LlmProfilesConfig;
    if (parsed && typeof parsed === "object" && parsed.profiles) {
      cachedConfig = { mtimeMs: stat.mtimeMs, config: parsed };
      return parsed;
    }
  } catch (err) {
    console.warn(`[LLM Profiles] Failed to read ${CONFIG_FILENAME}:`, (err as Error).message);
  }
  return null;
}

export function getActiveLlmProfile(): LlmProfile {
  // During tests, always enforce isolated environment configuration
  if (isTestEnvironment()) {
    return getLegacyEnvProfile();
  }

  const config = loadLlmProfilesConfig();
  if (!config) {
    return getLegacyEnvProfile();
  }

  const activeKey = process.env.LLM_PROFILE || config.activeProfile;
  const profile = config.profiles[activeKey];
  if (profile && profile.baseUrl) {
    return profile;
  }

  // Fallback if active key not found
  const firstProfile = Object.values(config.profiles)[0];
  if (firstProfile && firstProfile.baseUrl) {
    return firstProfile;
  }

  return getLegacyEnvProfile();
}

export function getLlmProfiles(): { activeProfile: string; profiles: Record<string, LlmProfile> } {
  const config = loadLlmProfilesConfig();
  if (!config) {
    const legacy = getLegacyEnvProfile();
    return {
      activeProfile: "default",
      profiles: { default: legacy },
    };
  }

  const activeKey = process.env.LLM_PROFILE || config.activeProfile;
  return {
    activeProfile: activeKey,
    profiles: config.profiles,
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

    if (options.syncEnv) {
      syncActiveProfileToEnv(selectedProfile, profileId);
    }

    return { success: true, profile: selectedProfile };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
