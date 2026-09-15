import { growdeskFetch } from "./client";
import { registerBffSession, resolveBffSession } from "./session";
import { verifyBffCsrf } from "./csrf";
import { createIdentityEndpoints } from "./bridge-endpoints";

export const growdeskIdentityEndpoints = createIdentityEndpoints({
  fetchApi: growdeskFetch,
  resolveSession: resolveBffSession,
  verifyCsrf: verifyBffCsrf,
  registerSession: registerBffSession,
  setSessionCookie(response, sessionSecret) {
    const attributes = [
      `${GROWDESK_COOKIE_NAME}=${encodeURIComponent(sessionSecret)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${30 * 24 * 60 * 60}`,
    ];
    if (GROWDESK_COOKIE_SECURE) attributes.push("Secure");
    response.headers.append("set-cookie", attributes.join("; "));
  },
});

import { GROWDESK_CONFIG, config } from "@/lib/config";
const GROWDESK_COOKIE_NAME = GROWDESK_CONFIG.cookieName;
const GROWDESK_COOKIE_SECURE = config.isProduction;
if (typeof window !== "undefined") throw new Error("This module can only be loaded on the server.");
