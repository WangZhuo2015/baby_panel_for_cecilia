/**
 * Centralized Application Configuration and Environment Variable Management
 */
import path from "node:path";

export const NODE_ENV = process.env.NODE_ENV || "development";
export const IS_PRODUCTION = NODE_ENV === "production";
export const IS_DEVELOPMENT = NODE_ENV === "development";
export const IS_TEST = NODE_ENV === "test";

export const PORT = parseInt(process.env.PORT || "3000", 10);
export const DATABASE_URL = process.env.DATABASE_URL || "file:./dev.db";

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
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export const AI_CONFIG = {
  get baseUrl() {
    if (preferOpenRouter()) return OPENROUTER_BASE;
    const url = process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || "";
    if (url && !isAbandonedHermesUpstream(url)) return url.replace(/\/+$/, "");
    return OPENROUTER_BASE;
  },
  get apiKey() {
    if (preferOpenRouter()) return process.env.OPENROUTER_API_KEY || "";
    const url = process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || "";
    if (isAbandonedHermesUpstream(url)) return "";
    return process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "";
  },
  get model() {
    if (preferOpenRouter()) return process.env.OPENROUTER_MODEL || "z-ai/glm-5.2";
    const model = process.env.AI_MODEL || process.env.OPENAI_MODEL || "";
    if (!model || model === "hermes-agent") return process.env.OPENROUTER_MODEL || "z-ai/glm-5.2";
    return model;
  },
  get visionModel() {
    const vision = process.env.AI_VISION_MODEL;
    if (vision && vision !== "hermes-agent") return vision;
    return this.model;
  },
  get headers(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    if (this.baseUrl.includes("openrouter.ai")) {
      headers["HTTP-Referer"] = "https://baby.zwang.fun";
      headers["X-Title"] = "Baby Panel";
    }
    return headers;
  },
  /** Ox Alpha spends thinking tokens; without this, OCR/tips can return empty content. */
  get completionExtras(): Record<string, unknown> {
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
    return process.env.VAPID_SUBJECT || "mailto:cecilia@baby-app.local";
  },
  get sendToken() {
    return process.env.PUSH_SEND_TOKEN || "";
  },
} as const;

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
} as const;

export default config;
