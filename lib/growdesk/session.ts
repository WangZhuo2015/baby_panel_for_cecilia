if (typeof window !== "undefined") {
  throw new Error("This module can only be loaded on the server.");
}
import { cookies } from "next/headers";
import crypto from "node:crypto";
import { GROWDESK_CONFIG } from "@/lib/config";
import { growdeskFetch } from "./client";

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
  babies: Array<{
    id: string;
    name?: string;
    nickname?: string;
    gender?: string;
    birthDate?: string;
  }>;
}

export interface BffLoginResult {
  success: boolean;
  sessionSecret?: string;
  user?: BffSessionUser;
  family?: BffFamily | null;
  baby?: BffFamily["babies"][0] | null;
  error?: string;
  status?: number;
}

export function hashSessionSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

/**
 * Extract session secret from request Cookie header or Next.js cookies() store.
 */
export async function getBffSessionSecret(request?: Request): Promise<string | null> {
  const cookieName = GROWDESK_CONFIG.cookieName;

  if (request) {
    const cookieHeader = request.headers.get("cookie");
    if (cookieHeader) {
      const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]*)`));
      if (match) {
        try {
          return decodeURIComponent(match[1]);
        } catch {
          return null;
        }
      }
    }
  }

  try {
    const cookieStore = await cookies();
    const c = cookieStore.get(cookieName);
    if (c?.value) {
      return c.value;
    }
  } catch {
    // Outside request context
  }

  return null;
}

/**
 * Resolves active BFF session by exchanging sessionSecret for a short-lived Bearer token from GrowDesk backend.
 */
export async function resolveBffSession(request?: Request): Promise<ActiveBffSession | null> {
  const sessionSecret = await getBffSessionSecret(request);
  if (!sessionSecret) {
    return null;
  }

  const sessionSecretHash = hashSessionSecret(sessionSecret);

  const res = await growdeskFetch<{
    accessToken: string;
    expiresIn: number;
    user: BffSessionUser;
  }>("/api/v1/auth/bff/session", {
    method: "POST",
    body: {
      sessionSecretHash,
    },
  });

  if (!res.ok || !res.data) {
    return null;
  }

  return {
    accessToken: res.data.accessToken,
    user: res.data.user,
    sessionSecret,
  };
}

/**
 * Performs login via GrowDesk BFF endpoint, binding a newly generated 256-bit secret.
 */
export async function loginBffSession(
  username: string,
  password: string,
  deviceLabel = "Web Browser",
): Promise<BffLoginResult> {
  const sessionSecret = crypto.randomBytes(32).toString("hex");
  const sessionSecretHash = hashSessionSecret(sessionSecret);

  const res = await growdeskFetch<{
    accessToken: string;
    expiresIn: number;
    user: BffSessionUser;
  }>("/api/v1/auth/bff/session", {
    method: "POST",
    body: {
      sessionSecretHash,
      username,
      password,
      deviceLabel,
    },
  });

  if (!res.ok || !res.data) {
    return {
      success: false,
      error: res.error?.message || "登录失败，用户名或密码错误",
      status: res.status,
    };
  }

  const { accessToken, user } = res.data;

  // Retrieve user's accessible families and babies
  let primaryFamily: BffFamily | null = null;
  let activeBaby: BffFamily["babies"][0] | null = null;

  const famRes = await growdeskFetch<Array<BffFamily>>("/api/v1/families", {
    method: "GET",
    accessToken,
  });

  if (famRes.ok && Array.isArray(famRes.data) && famRes.data.length > 0) {
    primaryFamily = famRes.data[0];

    // Query babies for primary family
    const babyRes = await growdeskFetch<Array<{ id: string; nickname?: string; name?: string }>>(
      `/api/v1/families/${primaryFamily.id}/babies`,
      {
        method: "GET",
        accessToken,
      },
    );

    if (babyRes.ok && Array.isArray(babyRes.data) && babyRes.data.length > 0) {
      activeBaby = babyRes.data[0];
    }
  }

  return {
    success: true,
    sessionSecret,
    user,
    family: primaryFamily,
    baby: activeBaby,
  };
}

/**
 * Revokes active BFF session on GrowDesk backend.
 */
export async function logoutBffSession(sessionSecret: string): Promise<void> {
  const sessionSecretHash = hashSessionSecret(sessionSecret);
  await growdeskFetch("/api/v1/auth/bff/session", {
    method: "DELETE",
    body: {
      sessionSecretHash,
    },
  });
}
