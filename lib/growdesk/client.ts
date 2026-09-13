if (typeof window !== "undefined") {
  throw new Error("This module can only be loaded on the server.");
}
import { GROWDESK_CONFIG } from "@/lib/config";
import crypto from "node:crypto";

export interface GrowDeskFetchOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  headers?: Record<string, string | undefined>;
  body?: unknown;
  accessToken?: string;
  idempotencyKey?: string;
  timeoutMs?: number;
}

export interface GrowDeskErrorPayload {
  code: string;
  message: string;
  details?: unknown[];
  requestId?: string;
}

export interface GrowDeskResponse<T> {
  ok: boolean;
  status: number;
  data?: T;
  page?: { nextCursor: string | null };
  error?: GrowDeskErrorPayload;
}

const FORBIDDEN_INCOMING_HEADERS = new Set([
  "x-user-id",
  "x-actor-id",
  "x-family-id",
  "x-baby-id",
  "cookie",
]);

/**
 * Controlled, server-only HTTP client to proxy requests from Next.js BFF to GrowDesk Fastify API.
 * Enforces fixed origin, header sanitization, timeout bounding, and typed error envelope handling.
 */
export async function growdeskFetch<T>(
  pathname: string,
  options: GrowDeskFetchOptions = {},
): Promise<GrowDeskResponse<T>> {
  const upstreamBase = GROWDESK_CONFIG.apiUrl;
  const url = `${upstreamBase}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;

  const requestId = crypto.randomUUID();
  const headers: Record<string, string> = {
    "accept": "application/json",
    "x-request-id": requestId,
  };

  if (options.accessToken) {
    headers["authorization"] = `Bearer ${options.accessToken}`;
  }

  if (options.idempotencyKey) {
    headers["idempotency-key"] = options.idempotencyKey;
  }

  // Sanitize and forward allowed custom headers
  if (options.headers) {
    for (const [key, val] of Object.entries(options.headers)) {
      if (!val) continue;
      const lower = key.toLowerCase();
      if (FORBIDDEN_INCOMING_HEADERS.has(lower)) continue;
      headers[lower] = val;
    }
  }

  let body: string | undefined;
  if (options.body !== undefined && options.body !== null) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const timeoutMs = options.timeoutMs ?? GROWDESK_CONFIG.timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body,
      signal: controller.signal,
      cache: "no-store",
    });

    const contentType = res.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");

    if (res.ok) {
      if (!isJson) {
        return {
          ok: true,
          status: res.status,
        };
      }
      const json = await res.json();
      return {
        ok: true,
        status: res.status,
        data: json.data !== undefined ? json.data : json,
        page: json.page,
      };
    }

    // Handle error envelope
    let errorPayload: GrowDeskErrorPayload = {
      code: `HTTP_${res.status}`,
      message: res.statusText || "Upstream service error",
      requestId,
    };

    if (isJson) {
      try {
        const errJson = await res.json();
        if (errJson?.error) {
          errorPayload = {
            code: errJson.error.code || `HTTP_${res.status}`,
            message: errJson.error.message || res.statusText,
            details: errJson.error.details,
            requestId: errJson.error.requestId || requestId,
          };
        }
      } catch {
        // Fallback to default error payload
      }
    }

    return {
      ok: false,
      status: res.status,
      error: errorPayload,
    };
  } catch (err: unknown) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      status: isAbort ? 504 : 502,
      error: {
        code: isAbort ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNAVAILABLE",
        message: isAbort
          ? `GrowDesk backend request timed out after ${timeoutMs}ms`
          : "Cannot connect to GrowDesk backend server",
        requestId,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}
