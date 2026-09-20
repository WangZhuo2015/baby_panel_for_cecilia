"use client";
import { isFresh as _isFresh, markFetched as _markFetched, invalidateCache as _invalidateCache, dedup as _dedup, toQuery, createCache, _fetchedAt as _fc } from "@/lib/fetch-cache";

// Re-export cache primitives for slices; allow injection via createCache for tests but default to singleton.
export { toQuery };
export const _fetchedAt = _fc;
export const isFresh = _isFresh;
export const markFetched = _markFetched;
export const invalidateCache = _invalidateCache;
export const dedup = _dedup;

// For slices that want isolated cache in tests
export const createSliceCache = createCache;

// Identity reads opt into the additive GrowDesk representation explicitly.
// Keeping this header in the shared client helper makes the three reads use
// one contract while legacy mode simply ignores it.
export const GROWDESK_EXTENDED_REPRESENTATION_HEADERS = {
  "x-growdesk-representation": "extended",
} as const;

export type UnauthorizedHandler = () => void;
let _onUnauthorized: UnauthorizedHandler | null = null;
export function setOnUnauthorized(handler: UnauthorizedHandler) {
  _onUnauthorized = handler;
}
export class AuthError extends Error {
  constructor(message: string = "Unauthorized") {
    super(message);
    this.name = "AuthError";
    Object.setPrototypeOf(this, AuthError.prototype);
  }
}
export function isAuthError(e: any): boolean {
  return e?.name === "AuthError" || e instanceof AuthError;
}
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const data = await res.json().catch(() => ({} as any));
    const errorMessage = data?.error || (res.status === 401 ? "请先登录" : `请求失败 (${res.status})`);
    if (res.status === 401) {
      if (_onUnauthorized && !url.includes("/api/auth/login") && !url.includes("/api/auth/register")) {
        _onUnauthorized();
      }
      throw new AuthError(errorMessage);
    }
    throw new Error(errorMessage);
  }
  return res.json();
}
