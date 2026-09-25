import { growdeskFetch } from "./client";
import { logoutBffSession, registerBffSession, resolveBffSession } from "./session";
import { verifyBffCsrf } from "./csrf";
import { createIdentityEndpoints } from "./bridge-endpoints";
import { clearLegacyAuthCookies, mayBootstrapLegacySession } from "./legacy-session-policy";
import { GROWDESK_CONFIG, config } from "@/lib/config";

if (typeof window !== "undefined") throw new Error("This module can only be loaded on the server.");

const endpoints = createIdentityEndpoints({
  fetchApi: growdeskFetch,
  resolveSession: resolveBffSession,
  verifyCsrf: verifyBffCsrf,
  registerSession: registerBffSession,
  setSessionCookie(response, sessionSecret) {
    const attributes = [
      `${GROWDESK_CONFIG.cookieName}=${encodeURIComponent(sessionSecret)}`,
      "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${30 * 24 * 60 * 60}`,
    ];
    if (config.isProduction) attributes.push("Secure");
    response.headers.append("set-cookie", attributes.join("; "));
    clearLegacyAuthCookies(response, config.isProduction);
  },
});

export const growdeskIdentityEndpoints = {
  ...endpoints,
  async me(request: Request): Promise<Response> {
    const response = await endpoints.me(request);
    if (!response.ok && mayBootstrapLegacySession(request, GROWDESK_CONFIG.cookieName, GROWDESK_CONFIG.usesGoBackend)) {
      try {
        // This resolves the same Request's cached promise, not a new exchange.
        // Failed family/member hydration must not leak a session without a cookie.
        const session = await resolveBffSession(request);
        if (session?.isNewSession) await logoutBffSession(session.sessionSecret);
      } catch {
        // Keep the original failure visible; do not clear the old cookie on an
        // outage. Revocation is best effort while the upstream is unavailable.
      }
    }
    return response;
  },
};
