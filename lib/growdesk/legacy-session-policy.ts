export const LEGACY_AUTH_COOKIE_NAMES = ["baby_auth_token", "auth_token"] as const;

/** Only the identity bootstrap owns a response that can persist a new BFF cookie. */
export function mayBootstrapLegacySession(
  request: Request | undefined,
  bffCookieName: string,
  usesGoBackend: boolean,
): boolean {
  if (!request || !usesGoBackend || request.method !== "GET") return false;
  if (new URL(request.url).pathname !== "/api/auth/me") return false;
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  // An existing (even malformed/revoked) new credential must never silently
  // fall back to another identity still present in an old cookie.
  const cookies = request.headers.get("cookie") || "";
  return !cookies.split(";").some(part => part.trim().split("=", 1)[0] === bffCookieName);
}

/** Explicit Requests must never borrow next/headers cookies from ambient context. */
export function legacyTokenFromRequest(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization !== null) {
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    return token && token.length <= 8192 && token.trim() === token ? token : null;
  }
  const found = new Map<string, string>();
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (!LEGACY_AUTH_COOKIE_NAMES.some(value => value === name)) continue;
    if (found.has(name)) return null;
    let token: string;
    try { token = decodeURIComponent(part.slice(separator + 1).trim()); } catch { return null; }
    if (!token || token.length > 8192 || token.trim() !== token) return null;
    found.set(name, token);
  }
  const values = new Set(found.values());
  return values.size === 1 ? [...values][0]! : null;
}

/** Expire every alias accepted by bootstrap, not just the current legacy name. */
export function clearLegacyAuthCookies(response: Response, secure: boolean): void {
  for (const name of LEGACY_AUTH_COOKIE_NAMES) {
    response.headers.append("set-cookie", [
      `${name}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0",
      "Expires=Thu, 01 Jan 1970 00:00:00 GMT", ...(secure ? ["Secure"] : []),
    ].join("; "));
  }
}
