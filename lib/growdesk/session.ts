if (typeof window !== "undefined") throw new Error("This module can only be loaded on the server.");
import { cookies } from "next/headers";
import crypto from "node:crypto";
import { GROWDESK_CONFIG } from "@/lib/config";
import { growdeskFetch } from "./client";
import { loadWebIdentity } from "./bridge-identity";
import { BridgeError, requireData } from "./bridge-protocol";

export interface BffSessionUser {
  id: string; username: string; displayName: string; createdAt: string; updatedAt: string;
}
export interface ActiveBffSession { accessToken: string; user: BffSessionUser; sessionSecret: string }
export interface BffFamily {
  id: string; name: string; inviteCode?: string; timeZone?: string;
  babies: Array<{ id: string; familyId?: string; name?: string; nickname?: string; gender?: string; birthDate?: string; gestationalAge?: number | null; avatarUrl?: string | null }>;
}
export interface BffLoginResult {
  success: boolean; sessionSecret?: string; user?: BffSessionUser;
  family?: BffFamily | null; baby?: BffFamily["babies"][0] | null; error?: string; status?: number;
}
export function hashSessionSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}
function validSecret(value: string | undefined): string | null {
  return value && /^[a-f0-9]{64}$/i.test(value) ? value : null;
}
export async function getBffSessionSecret(request?: Request): Promise<string | null> {
  if (request) {
    // Never fall back to a different request's cookies when an explicit request was supplied.
    const match = request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${GROWDESK_CONFIG.cookieName}=([^;]*)`));
    try { return validSecret(match ? decodeURIComponent(match[1]!) : undefined); } catch { return null; }
  }
  try { return validSecret((await cookies()).get(GROWDESK_CONFIG.cookieName)?.value); } catch { return null; }
}
const requestSessions = new WeakMap<Request, Promise<ActiveBffSession | null>>();
export function resolveBffSession(request?: Request): Promise<ActiveBffSession | null> {
  if (request) {
    const cached = requestSessions.get(request);
    if (cached) return cached;
    const pending = exchangeSession(request);
    requestSessions.set(request, pending);
    return pending;
  }
  return exchangeSession();
}
async function exchangeSession(request?: Request): Promise<ActiveBffSession | null> {
  const sessionSecret = await getBffSessionSecret(request);
  if (!sessionSecret) return null;
  const result = await growdeskFetch<{ accessToken: string; user: BffSessionUser }>("/api/v1/auth/bff/session", {
    method: "POST", body: { sessionSecretHash: hashSessionSecret(sessionSecret) },
  });
  if (!result.ok && (result.status === 401 || result.status === 404)) return null;
  // An outage is not an expired session. Preserve 502/503/504 for the caller.
  const data = requireData(result);
  if (!data.accessToken || !data.user?.id) throw new BridgeError(502, "UPSTREAM_INVALID_SESSION", "GrowDesk 会话响应无效");
  return { accessToken: data.accessToken, user: data.user, sessionSecret };
}
export async function loginBffSession(username: string, password: string, deviceLabel = "Web Browser"): Promise<BffLoginResult> {
  const sessionSecret = crypto.randomBytes(32).toString("hex");
  let created = false;
  try {
    const data = requireData(await growdeskFetch<{ accessToken: string; user: BffSessionUser }>("/api/v1/auth/bff/session", {
      method: "POST", body: { sessionSecretHash: hashSessionSecret(sessionSecret), username, password, deviceLabel },
    }));
    created = true;
    const identity = await loadWebIdentity(growdeskFetch, data.accessToken);
    return {
      success: true, sessionSecret, user: data.user, baby: identity.baby,
      family: identity.family ? { ...identity.family, babies: identity.baby ? [identity.baby] : [] } : null,
    };
  } catch (error) {
    if (created) {
      // Best-effort compensation; never pretend the incomplete login succeeded.
      try { await logoutBffSession(sessionSecret); } catch { /* upstream remains unavailable */ }
    }
    return { success: false, status: error instanceof BridgeError ? error.status : 500,
      error: error instanceof BridgeError ? error.message : "登录失败" };
  }
}
export async function logoutBffSession(sessionSecret: string): Promise<void> {
  const result = await growdeskFetch("/api/v1/auth/bff/session", {
    method: "DELETE", body: { sessionSecretHash: hashSessionSecret(sessionSecret) },
  });
  if (!result.ok && result.status !== 401 && result.status !== 404) {
    throw new BridgeError(result.status, result.error?.code || "SESSION_REVOKE_FAILED", result.error?.message || "注销会话失败");
  }
}
