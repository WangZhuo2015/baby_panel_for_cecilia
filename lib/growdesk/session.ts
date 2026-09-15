import { cookies } from "next/headers";
import crypto from "node:crypto";
import { GROWDESK_CONFIG } from "@/lib/config";
import { growdeskFetch } from "./client";
import {
  type ApiFamily,
  type LegacyBaby,
  loadWebIdentity,
} from "./bridge-identity";
import { BridgeError, requireData } from "./bridge-protocol";

export interface BffSessionUser {
  id: string;
  username: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}
export interface ActiveBffSession {
  accessToken: string;
  user: BffSessionUser;
  sessionSecret: string;
}
export interface BffFamily {
  id: string;
  name: string;
  inviteCode?: string;
  inviteExpiresAt?: string;
  role?: string;
  timeZone?: string | null;
  createdAt?: string;
  updatedAt?: string;
  babies: LegacyBaby[];
}
export interface BffLoginResult {
  success: boolean;
  sessionSecret?: string;
  user?: BffSessionUser;
  family?: BffFamily | null;
  baby?: LegacyBaby | null;
  families?: BffFamily[];
  babies?: LegacyBaby[];
  error?: string;
  status?: number;
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

function toBffFamily(family: ApiFamily, babies: LegacyBaby[], extra: Partial<BffFamily> = {}): BffFamily {
  return {
    id: family.id,
    name: family.name,
    timeZone: family.timeZone,
    createdAt: family.createdAt,
    updatedAt: family.updatedAt,
    babies,
    ...extra,
  };
}

function identityFamilies(identity: Awaited<ReturnType<typeof loadWebIdentity>>): BffFamily[] {
  return identity.families.map(item => toBffFamily(item.family, item.babies));
}

async function revokeDirectRegistrationSession(accessToken: string): Promise<void> {
  try {
    await growdeskFetch("/api/v1/auth/logout", { method: "POST", accessToken });
  } catch {
    // The BFF session is the only credential returned to the browser. A failure
    // here must not turn a completed registration into a false error.
  }
}

/**
 * Create a GrowDesk account, bind a browser-only BFF session, and optionally
 * consume a family invite. The upstream register endpoint always creates a
 * private default family first; joining the invite is therefore a second,
 * explicit contract call.
 */
export async function registerBffSession(input: {
  username: string;
  password: string;
  displayName: string;
  inviteCode?: string;
  relation?: string;
}): Promise<BffLoginResult> {
  const sessionSecret = crypto.randomBytes(32).toString("hex");
  let registrationToken: string | undefined;
  let bffCreated = false;
  try {
    const registered = requireData(await growdeskFetch<{
      accessToken: string;
      user: BffSessionUser;
    }>("/api/v1/auth/register", {
      method: "POST",
      body: {
        username: input.username,
        password: input.password,
        displayName: input.displayName,
        deviceLabel: "GrowDesk Web",
      },
    }));
    registrationToken = registered.accessToken;
    if (!registrationToken || !registered.user?.id) {
      throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", "GrowDesk 注册响应无效");
    }

    const bound = requireData(await growdeskFetch<{
      accessToken: string;
      user: BffSessionUser;
    }>("/api/v1/auth/bff/session", {
      method: "POST",
      body: {
        sessionSecretHash: hashSessionSecret(sessionSecret),
        username: input.username,
        password: input.password,
        deviceLabel: "GrowDesk Web",
      },
    }));
    if (!bound.accessToken || !bound.user?.id) {
      throw new BridgeError(502, "UPSTREAM_INVALID_SESSION", "GrowDesk 注册会话响应无效");
    }
    bffCreated = true;

    let joined: { family: ApiFamily; role: string } | undefined;
    if (input.inviteCode) {
      joined = requireData(await growdeskFetch<{ family: ApiFamily; role: string }>("/api/v1/families/join", {
        method: "POST",
        accessToken: bound.accessToken,
        body: { inviteCode: input.inviteCode },
      }));
      if (!joined.family?.id || typeof joined.family.name !== "string") {
        throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", "GrowDesk 加入家庭响应无效");
      }
    }

    const identity = await loadWebIdentity(growdeskFetch, bound.accessToken);
    const families = identityFamilies(identity);
    const target = joined
      ? identity.families.find(item => item.family.id === joined!.family.id)
      : identity.families.find(item => item.family.id === identity.family?.id);
    const family = joined
      ? (target
        ? toBffFamily(target.family, target.babies, { role: joined.role })
        : toBffFamily(joined.family, [], { role: joined.role }))
      : (target ? toBffFamily(target.family, target.babies) : null);
    const baby = target?.babies[0] ?? null;

    return {
      success: true,
      sessionSecret,
      user: bound.user,
      family,
      baby,
      families,
      babies: identity.babies,
    };
  } catch (error) {
    if (bffCreated) {
      try { await logoutBffSession(sessionSecret); } catch { /* preserve the original error */ }
    }
    return {
      success: false,
      status: error instanceof BridgeError ? error.status : 500,
      error: error instanceof BridgeError ? error.message : "注册失败",
    };
  } finally {
    if (registrationToken) await revokeDirectRegistrationSession(registrationToken);
  }
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
    const families = identityFamilies(identity);
    const family = families.find(item => item.id === identity.family?.id) ?? families[0] ?? null;
    return {
      success: true,
      sessionSecret,
      user: data.user,
      baby: identity.baby,
      family,
      families,
      babies: identity.babies,
    };
  } catch (error) {
    if (created) {
      // Best-effort compensation; never pretend the incomplete login succeeded.
      try { await logoutBffSession(sessionSecret); } catch { /* upstream remains unavailable */ }
    }
    return {
      success: false,
      status: error instanceof BridgeError ? error.status : 500,
      error: error instanceof BridgeError ? error.message : "登录失败",
    };
  }
}

export async function logoutBffSession(sessionSecret: string): Promise<void> {
  const result = await growdeskFetch("/api/v1/auth/bff/session", {
    method: "DELETE",
    body: { sessionSecretHash: hashSessionSecret(sessionSecret) },
  });
  if (!result.ok && result.status !== 401 && result.status !== 404) {
    throw new BridgeError(result.status, result.error?.code || "SESSION_REVOKE_FAILED", result.error?.message || "注销会话失败");
  }
}
