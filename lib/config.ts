/**
 * Centralized Application Configuration and Environment Variable Management
 */
import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
import { getActiveLlmProfile } from "./llm-profiles";

const isTestDetected =
  process.env.NODE_ENV === "test" ||
  Boolean(process.env.NODE_TEST_CONTEXT) ||
  Boolean(process.env.npm_lifecycle_event?.includes("test")) ||
  process.argv.some((arg) => arg.includes("--test"));

// 测试环境优先强制加载专用 .env.test 配置，防止读到生产环境变量
if (isTestDetected) {
  let cwd = process.cwd();
  if (cwd.endsWith(`${path.sep}.next${path.sep}standalone`) || cwd.endsWith(".next/standalone")) {
    cwd = path.resolve(cwd, "..", "..");
  }
  const testEnvFile = path.resolve(cwd, ".env.test");
  if (fs.existsSync(testEnvFile)) {
    dotenv.config({ path: testEnvFile, override: true });
  }
}

export const NODE_ENV = process.env.NODE_ENV || (isTestDetected ? "test" : "development");
export const IS_PRODUCTION = NODE_ENV === "production";
export const IS_DEVELOPMENT = NODE_ENV === "development";
export const IS_TEST = isTestDetected;

export const PORT = parseInt(process.env.PORT || (IS_TEST ? "3089" : "3000"), 10);
// 测试环境默认使用隔离测试库 dev_test.db，非测试环境默认使用 prod.db
export const DATABASE_URL =
  process.env.DATABASE_URL || (IS_TEST ? "file:./dev_test.db" : "file:./prod.db");

/** Resolve file: URLs to absolute paths to avoid dual-DB when cwd differs (migrate vs runtime) */
export function resolveDatabaseUrl(url: string): string {
  if (!url.startsWith("file:")) return url;
  const relativePath = url.slice("file:".length);
  // Handle standalone build where cwd is .next/standalone: resolve to project root
  let cwd = process.cwd();
  // turbopackIgnore for static tracing
  if (cwd.endsWith(`${path.sep}.next${path.sep}standalone`) || cwd.endsWith(".next/standalone")) {
    cwd = path.resolve(cwd, "..", "..");
  }
  return `file:${path.resolve(/* turbopackIgnore: true */ cwd, relativePath)}`;
}

/**
 * Validates and resolves the JWT secret.
 * In production, enforces a minimum length of 32 characters.
 * In development, provides a fallback with a clear warning if omitted.
 */
function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    if (IS_PRODUCTION) {
      throw new Error(
        "FATAL: JWT_SECRET environment variable is required in production and must be at least 32 characters long."
      );
    }
    console.warn(
      "[Config Warning] JWT_SECRET is not set. Using an insecure fallback secret for development only. Set a strong JWT_SECRET in production!"
    );
    return "dev-insecure-jwt-secret-key-32-chars-long-change-me!";
  }

  if (IS_PRODUCTION && secret.length < 32) {
    throw new Error(
      `FATAL: JWT_SECRET in production must be at least 32 characters long (current length: ${secret.length}).`
    );
  }

  return secret;
}

let cachedJwtSecret: string | null = null;
let cachedJwtSecretBytes: Uint8Array | null = null;

export function getJwtSecret(): string {
  if (!cachedJwtSecret) {
    cachedJwtSecret = resolveJwtSecret();
  }
  return cachedJwtSecret;
}

export function getJwtSecretBytes(): Uint8Array {
  if (!cachedJwtSecretBytes) {
    cachedJwtSecretBytes = new TextEncoder().encode(getJwtSecret());
  }
  return cachedJwtSecretBytes;
}

export const AUTH_CONFIG = {
  cookieName: "baby_auth_token",
  tokenExpiry: "7d",
  cookieMaxAge: 7 * 24 * 60 * 60, // 7 days in seconds
} as const;

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

function isAbandonedHermesUpstream(url: string): boolean {
  return /:8642\b/.test(url);
}

function preferOpenRouter(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY) && !process.env.AI_BASE_URL && !process.env.OPENAI_BASE_URL;
}

export const AI_CONFIG = {
  get baseUrl() {
    const profile = getActiveLlmProfile();
    if (profile.baseUrl && !isAbandonedHermesUpstream(profile.baseUrl)) {
      return profile.baseUrl.replace(/\/+$/, "");
    }
    if (preferOpenRouter()) return OPENROUTER_BASE;
    const url = process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || "";
    if (url && !isAbandonedHermesUpstream(url)) return url.replace(/\/+$/, "");
    return OPENROUTER_BASE;
  },
  get apiKey() {
    const profile = getActiveLlmProfile();
    if (profile.apiKey && !isAbandonedHermesUpstream(profile.baseUrl)) {
      return profile.apiKey;
    }
    if (preferOpenRouter()) return process.env.OPENROUTER_API_KEY || "";
    const url = process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || "";
    if (isAbandonedHermesUpstream(url)) return "";
    return process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "";
  },
  get model() {
    const profile = getActiveLlmProfile();
    if (profile.model) {
      if (profile.model === "hermes-agent" || (this.baseUrl.includes("opencode.ai") && profile.model.includes("muse-spark"))) {
        return "DeepSeek-V4-Flash";
      }
      return profile.model;
    }
    if (preferOpenRouter()) return process.env.OPENROUTER_MODEL || "muse-spark-1.2-contributor";
    const model = process.env.AI_MODEL || process.env.OPENAI_MODEL || "";
    if (!model || model === "hermes-agent" || (this.baseUrl.includes("opencode.ai") && model.includes("muse-spark"))) {
      return "DeepSeek-V4-Flash";
    }
    return model || "muse-spark-1.2-contributor";
  },
  get visionModel() {
    const profile = getActiveLlmProfile();
    if (profile.visionModel && profile.visionModel !== "hermes-agent") {
      return profile.visionModel;
    }
    const vision = process.env.AI_VISION_MODEL;
    if (vision && vision !== "hermes-agent") return vision;
    return "DeepSeek-V4.1-Flash";
  },
  get headers(): Record<string, string> {
    const profile = getActiveLlmProfile();
    const headers: Record<string, string> = { "Content-Type": "application/json", ...(profile.headers || {}) };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    if (this.baseUrl.includes("openrouter.ai") && !headers["HTTP-Referer"]) {
      headers["HTTP-Referer"] = "https://baby.zwang.fun";
      headers["X-Title"] = "Baby Panel";
    }
    return headers;
  },
  /** Ox Alpha spends thinking tokens; without this, OCR/tips can return empty content. */
  get completionExtras(): Record<string, unknown> {
    const profile = getActiveLlmProfile();
    if (profile.completionExtras) return profile.completionExtras;
    if (!this.baseUrl.includes("openrouter.ai")) return {};
    return { reasoning: { effort: "low" } };
  },
} as const;

export const PUSH_CONFIG = {
  get publicKey() {
    return process.env.VAPID_PUBLIC_KEY || "";
  },
  get privateKey() {
    return process.env.VAPID_PRIVATE_KEY || "";
  },
  get subject() {
    const raw = process.env.VAPID_SUBJECT?.trim();
    // Apple APNs (iOS Safari Web Push) 严格校验 sub 字段，若含有 .local 或 localhost 会直接拒收并返回 403 BadJwtToken
    if (raw && !raw.includes(".local") && !raw.includes("localhost")) {
      return raw;
    }
    return "https://baby.zwang.fun";
  },
  get sendToken() {
    return process.env.PUSH_SEND_TOKEN || "";
  },
} as const;

export const GROWDESK_CONFIG = {
  get enabled(): boolean {
    return process.env.GROWDESK_ENABLED === "true" || process.env.GROWDESK_ENABLED === "1";
  },
  get apiUrl(): string {
    return (process.env.GROWDESK_API_URL || "http://127.0.0.1:3080").replace(/\/+$/, "");
  },
  get cookieName(): string {
    return IS_PRODUCTION ? "__Host-growdesk_web" : "growdesk_web_dev";
  },
  timeoutMs: 10_000,
} as const;

export function isGrowDeskEnabled(): boolean {
  return GROWDESK_CONFIG.enabled;
}

export const config = {
  nodeEnv: NODE_ENV,
  isProduction: IS_PRODUCTION,
  isDevelopment: IS_DEVELOPMENT,
  isTest: IS_TEST,
  port: PORT,
  databaseUrl: DATABASE_URL,
  get jwtSecret() {
    return getJwtSecret();
  },
  get jwtSecretBytes() {
    return getJwtSecretBytes();
  },
  auth: AUTH_CONFIG,
  ai: AI_CONFIG,
  push: PUSH_CONFIG,
  growdesk: GROWDESK_CONFIG,
} as const;

export default config;
