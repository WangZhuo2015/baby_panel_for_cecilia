/**
 * OAuth 2.1 Configuration and Constants
 */

export const OAUTH_SCOPES = {
  BABY_READ: "baby:read",
  BABY_WRITE: "baby:write",
  APP_READ: "app:read",
  APP_WRITE: "app:write",
} as const;

export const DEFAULT_SCOPES = [
  OAUTH_SCOPES.BABY_READ,
  OAUTH_SCOPES.BABY_WRITE,
  OAUTH_SCOPES.APP_READ,
  OAUTH_SCOPES.APP_WRITE,
];

export const OAUTH_EXPIRATIONS = {
  AUTH_CODE_SECONDS: 600, // 10 minutes
  ACCESS_TOKEN_SECONDS: 3600, // 1 hour
  REFRESH_TOKEN_SECONDS: 30 * 24 * 60 * 60, // 30 days
} as const;

export const STATIC_OAUTH_CLIENTS = [
  {
    clientId: "gemini-spark-client",
    clientSecret: "gemini-spark-secret-fallback-2026",
    clientName: "Gemini Spark Connected App (Static Fallback)",
    redirectUris: [
      "https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-118221398161769085317-baby_zwang_fun",
      "https://gemini.google.com/oauth/callback",
      "https://oauth2.googleapis.com/callback",
      "https://developers.google.com/oauthplayground",
      "http://localhost:3000/oauth/callback",
      "http://127.0.0.1:3000/oauth/callback",
    ],
    grantTypes: ["authorization_code", "refresh_token"],
    responseTypes: ["code"],
    scope: "baby:read baby:write app:read app:write",
    tokenEndpointAuthMethod: "client_secret_post",
  },
  {
    clientId: "mcp-inspector-client",
    clientSecret: undefined,
    clientName: "MCP Inspector / Debugger",
    redirectUris: [
      "http://localhost:5173/callback",
      "http://127.0.0.1:5173/callback",
      "http://localhost:3000/oauth/callback",
      "http://127.0.0.1:3000/oauth/callback",
    ],
    grantTypes: ["authorization_code", "refresh_token"],
    responseTypes: ["code"],
    scope: "baby:read baby:write",
    tokenEndpointAuthMethod: "none",
  },
] as const;

/**
 * Resolves the Canonical Base URL from an incoming Request.
 * Prioritizes standard proxy headers (X-Forwarded-Proto, X-Forwarded-Host)
 * to ensure public HTTPS domain is reported to Gemini Spark and OAuth clients.
 */
export function getBaseUrl(request?: Request): string {
  if (request) {
    const forwardedProto = request.headers.get("x-forwarded-proto");
    const forwardedHost = request.headers.get("x-forwarded-host");
    const host = forwardedHost || request.headers.get("host");

    if (host) {
      const proto = forwardedProto || (host.includes("localhost") || host.includes("127.0.0.1") ? "http" : "https");
      return `${proto}://${host}`.replace(/\/+$/, "");
    }

    try {
      const url = new URL(request.url);
      return url.origin.replace(/\/+$/, "");
    } catch {}
  }

  // Environment fallback
  const envUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.BABY_PANEL_URL || process.env.APP_URL;
  if (envUrl) {
    return envUrl.replace(/\/+$/, "");
  }

  const port = process.env.PORT || "3000";
  return `http://localhost:${port}`;
}
