/**
 * Core OAuth 2.1, RFC 7591 (DCR), RFC 7636 (PKCE), RFC 9728 & MCP Token Verification Services
 */

import crypto from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "@/lib/prisma";
import { getJwtSecretBytes, GROWDESK_CONFIG } from "@/lib/config";
import { growdeskFetch } from "@/lib/growdesk/client";
import {
  OAUTH_SCOPES,
  DEFAULT_SCOPES,
  OAUTH_EXPIRATIONS,
  STATIC_OAUTH_CLIENTS,
  getBaseUrl,
} from "./config";
import { getClientIp } from "@/lib/rate-limit";
import type {
  OAuthProtectedResourceMetadata,
  OAuthAuthorizationServerMetadata,
  ClientRegistrationRequest,
  ClientRegistrationResponse,
  TokenResponse,
  UserPrincipal,
} from "./types";
export { validateRegisteredRedirectUri as validateRedirectUri } from "./redirect-uri";

export class OAuthError extends Error {
  statusCode: number;
  error: string;
  errorDescription?: string;

  constructor(error: string, errorDescription?: string, statusCode = 400) {
    super(errorDescription || error);
    this.name = "OAuthError";
    this.error = error;
    this.errorDescription = errorDescription;
    this.statusCode = statusCode;
  }
}

/**
 * SHA256 string hasher for refresh tokens and secrets
 */
export function hashSecret(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function sharedOAuthError(result: { status: number; error?: { code: string; message: string } }): never {
  const code = result.error?.code || `http_${result.status}`;
  const status = result.status >= 400 && result.status <= 599 ? result.status : 502;
  throw new OAuthError(code, result.error?.message || "GrowDesk OAuth service request failed", status);
}

async function sharedOAuthRequest<T>(
  pathname: string,
  options: { method?: "GET" | "POST"; accessToken?: string; body?: unknown } = {},
): Promise<T> {
  const result = await growdeskFetch<T>(pathname, options);
  if (!result.ok) sharedOAuthError(result);
  if (result.data === undefined) {
    throw new OAuthError("server_error", "GrowDesk OAuth service returned an invalid response", 502);
  }
  return result.data;
}

function sharedClientFromApi(data: any): any {
  if (!data || typeof data.client_id !== "string" || !Array.isArray(data.redirect_uris)) {
    throw new OAuthError("server_error", "GrowDesk OAuth service returned an invalid client", 502);
  }
  return {
    id: data.client_id,
    clientId: data.client_id,
    // The Go service never returns a stored or previously issued secret.
    clientSecret: null,
    clientName: typeof data.client_name === "string" ? data.client_name : "External MCP Client",
    redirectUrisJson: JSON.stringify(data.redirect_uris),
    grantTypesJson: JSON.stringify(Array.isArray(data.grant_types) ? data.grant_types : ["authorization_code", "refresh_token"]),
    responseTypesJson: JSON.stringify(Array.isArray(data.response_types) ? data.response_types : ["code"]),
    scope: typeof data.scope === "string" ? data.scope : "",
    tokenEndpointAuthMethod: typeof data.token_endpoint_auth_method === "string" ? data.token_endpoint_auth_method : "none",
    isDynamic: true,
  };
}

// In-memory sync flag & concurrency lock to avoid DB write amplification on read/auth paths
let staticClientsSynced = false;
let staticClientsSyncPromise: Promise<void> | null = null;

/**
 * Ensures static clients exist in the database (lazy seed/lookup)
 */
export async function ensureStaticClients(force = false): Promise<void> {
  if (staticClientsSynced && !force) return;

  if (GROWDESK_CONFIG.enabled) {
    // Shared mode has no Web-local static clients or process-memory OAuth state.
    return;
  }

  if (staticClientsSyncPromise) return staticClientsSyncPromise;

  staticClientsSyncPromise = (async () => {
    try {
      for (const staticClient of STATIC_OAUTH_CLIENTS) {
        const clientSecretHash = staticClient.clientSecret ? hashSecret(staticClient.clientSecret) : null;
        const redirectUrisJson = JSON.stringify(staticClient.redirectUris);
        const grantTypesJson = JSON.stringify(staticClient.grantTypes);
        const responseTypesJson = JSON.stringify(staticClient.responseTypes);

        const existing = await prisma.oAuthClient.findUnique({
          where: { clientId: staticClient.clientId },
        });

        if (!existing) {
          await prisma.oAuthClient.create({
            data: {
              clientId: staticClient.clientId,
              clientSecret: clientSecretHash,
              clientName: staticClient.clientName,
              redirectUrisJson,
              grantTypesJson,
              responseTypesJson,
              scope: staticClient.scope,
              tokenEndpointAuthMethod: staticClient.tokenEndpointAuthMethod,
              isDynamic: false,
            },
          });
        } else if (!existing.isDynamic) {
          // Only perform an update if configuration actually changed
          const needsUpdate =
            existing.clientName !== staticClient.clientName ||
            existing.redirectUrisJson !== redirectUrisJson ||
            existing.grantTypesJson !== grantTypesJson ||
            existing.responseTypesJson !== responseTypesJson ||
            existing.scope !== staticClient.scope ||
            existing.tokenEndpointAuthMethod !== staticClient.tokenEndpointAuthMethod;

          if (needsUpdate) {
            await prisma.oAuthClient.update({
              where: { clientId: staticClient.clientId },
              data: {
                clientSecret: clientSecretHash,
                clientName: staticClient.clientName,
                redirectUrisJson,
                grantTypesJson,
                responseTypesJson,
                scope: staticClient.scope,
                tokenEndpointAuthMethod: staticClient.tokenEndpointAuthMethod,
              },
            });
          }
        }
      }
      staticClientsSynced = true;
    } finally {
      staticClientsSyncPromise = null;
    }
  })();

  return staticClientsSyncPromise;
}

/**
 * Looks up a client by ID, checking static clients if not in DB
 */
export async function findClient(clientId: string) {
  if (GROWDESK_CONFIG.enabled) {
    if (!/^[A-Za-z0-9._-]{1,200}$/.test(clientId)) return null;
    try {
      const data = await sharedOAuthRequest<any>(`/api/v1/mcp/oauth/clients/${encodeURIComponent(clientId)}`);
      return sharedClientFromApi(data);
    } catch (error) {
      if (error instanceof OAuthError && [400, 404].includes(error.statusCode)) return null;
      throw error;
    }
  }

  let client = await prisma.oAuthClient.findUnique({
    where: { clientId },
  });

  if (!client) {
    await ensureStaticClients(true);
    client = await prisma.oAuthClient.findUnique({
      where: { clientId },
    });
  }

  return client;
}

/**
 * RFC 7591: Dynamic Client Registration
 */
export async function registerClient(
  body: ClientRegistrationRequest,
  ip?: string
): Promise<ClientRegistrationResponse> {
  if (!body.redirect_uris || !Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0) {
    throw new OAuthError("invalid_client_metadata", "redirect_uris must be a non-empty array of valid URIs");
  }

  // Validate redirect URIs (prevent open redirects and wildcards)
  for (const uri of body.redirect_uris) {
    if (typeof uri !== "string" || uri.includes("*")) {
      throw new OAuthError("invalid_redirect_uri", "Wildcard redirect URIs are strictly forbidden");
    }
    try {
      const parsed = new URL(uri);
      if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
        throw new OAuthError("invalid_redirect_uri", "Redirect URIs must use HTTPS or loopback localhost/127.0.0.1");
      }
    } catch {
      throw new OAuthError("invalid_redirect_uri", `Invalid redirect URI format: ${uri}`);
    }
  }

  const authMethod = body.token_endpoint_auth_method || "none";
  if (!["none", "client_secret_post", "client_secret_basic"].includes(authMethod)) {
    throw new OAuthError("invalid_client_metadata", "Unsupported token_endpoint_auth_method");
  }
  const grantTypes = body.grant_types || ["authorization_code", "refresh_token"];
  const responseTypes = body.response_types || ["code"];
  const scope = body.scope || DEFAULT_SCOPES.join(" ");

  const rawClientName = body.client_name ? String(body.client_name).slice(0, 100) : "Dynamic Client";
  const isGoogleOrGemini =
    rawClientName.toLowerCase().includes("google") ||
    rawClientName.toLowerCase().includes("gemini") ||
    body.redirect_uris?.some(
      (uri) => uri.includes("googleusercontent.com") || uri.includes("gemini.google.com")
    );
  const clientName = isGoogleOrGemini ? "Gemini Spark" : rawClientName;

  if (GROWDESK_CONFIG.enabled) {
    const result = await sharedOAuthRequest<any>("/api/v1/mcp/oauth/register", {
      method: "POST",
      body: {
        client_name: clientName,
        redirect_uris: body.redirect_uris,
        token_endpoint_auth_method: authMethod,
        scope,
      },
    });
    if (typeof result.client_id !== "string" || !Array.isArray(result.redirect_uris)) {
      throw new OAuthError("server_error", "GrowDesk OAuth service returned an invalid registration", 502);
    }
    return {
      client_id: result.client_id,
      client_secret: typeof result.client_secret === "string" ? result.client_secret : undefined,
      client_id_issued_at: typeof result.client_id_issued_at === "number" ? result.client_id_issued_at : undefined,
      client_name: typeof result.client_name === "string" ? result.client_name : clientName,
      redirect_uris: result.redirect_uris,
      grant_types: Array.isArray(result.grant_types) ? result.grant_types : grantTypes,
      response_types: Array.isArray(result.response_types) ? result.response_types : responseTypes,
      scope: typeof result.scope === "string" ? result.scope : scope,
      token_endpoint_auth_method: typeof result.token_endpoint_auth_method === "string" ? result.token_endpoint_auth_method : authMethod,
    };
  }

  const clientId = `dcr_${crypto.randomUUID().replace(/-/g, "")}`;
  const rawSecret = crypto.randomBytes(32).toString("hex");
  const clientSecretHash = authMethod !== "none" ? hashSecret(rawSecret) : null;

  const client = await prisma.oAuthClient.create({
    data: {
      clientId,
      clientSecret: clientSecretHash,
      clientName,
      redirectUrisJson: JSON.stringify(body.redirect_uris),
      grantTypesJson: JSON.stringify(grantTypes),
      responseTypesJson: JSON.stringify(responseTypes),
      scope,
      tokenEndpointAuthMethod: authMethod,
      isDynamic: true,
    },
  });

  await logOAuthAudit({
    clientId: client.clientId,
    action: "client_register",
    authResult: "success",
    statusCode: 201,
    ip,
    metadata: { clientName: client.clientName, redirectUris: body.redirect_uris },
  });

  return {
    client_id: client.clientId,
    client_secret: authMethod !== "none" ? rawSecret : undefined,
    client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    client_name: client.clientName || undefined,
    redirect_uris: JSON.parse(client.redirectUrisJson),
    grant_types: JSON.parse(client.grantTypesJson),
    response_types: JSON.parse(client.responseTypesJson),
    scope: client.scope || scope,
    token_endpoint_auth_method: client.tokenEndpointAuthMethod,
  };
}

/**
 * RFC 7636: PKCE S256 Verification
 */
export function verifyCodeChallenge(
  codeVerifier: string,
  codeChallenge: string,
  method = "S256"
): boolean {
  if (method !== "S256") {
    return false; // OAuth 2.1 requires S256
  }
  if (!codeVerifier || codeVerifier.length < 43 || codeVerifier.length > 128) {
    return false;
  }
  const calculatedChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  return crypto.timingSafeEqual(Buffer.from(calculatedChallenge), Buffer.from(codeChallenge));
}

/**
 * Creates and persists an Authorization Code
 */
export async function createAuthorizationCode(params: {
  clientId: string;
  userId: string;
  babyId?: string | null;
  redirectUri: string;
  scope: string;
  resource?: string | null;
  codeChallenge: string;
  codeChallengeMethod?: string;
  accessToken?: string;
}): Promise<string> {
  if (GROWDESK_CONFIG.enabled) {
    if (!params.accessToken || !params.babyId) {
      throw new OAuthError("unauthorized", "Shared OAuth authorization requires a verified BFF session and baby", 401);
    }
    const result = await sharedOAuthRequest<{ code?: string }>("/api/v1/mcp/oauth/authorize", {
      method: "POST",
      accessToken: params.accessToken,
      body: {
        clientId: params.clientId,
        redirectUri: params.redirectUri,
        scope: params.scope,
        codeChallenge: params.codeChallenge,
        codeChallengeMethod: params.codeChallengeMethod || "S256",
        resource: params.resource || undefined,
        babyId: params.babyId,
      },
    });
    if (typeof result.code !== "string" || !result.code) {
      throw new OAuthError("server_error", "GrowDesk OAuth service returned an invalid authorization code", 502);
    }
    return result.code;
  }

  const code = `code_${crypto.randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + OAUTH_EXPIRATIONS.AUTH_CODE_SECONDS * 1000);

  await prisma.oAuthAuthorizationCode.create({
    data: {
      code,
      clientId: params.clientId,
      userId: params.userId,
      babyId: params.babyId || null,
      redirectUri: params.redirectUri,
      scope: params.scope,
      resource: params.resource || null,
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: params.codeChallengeMethod || "S256",
      expiresAt,
      used: false,
    },
  });

  return code;
}

/**
 * Authenticates client credentials (for confidential clients)
 */
export async function authenticateClient(
  clientId: string,
  clientSecret?: string | null
): Promise<any> {
  const client = await findClient(clientId);
  if (!client) {
    throw new OAuthError("invalid_client", "Client not found", 401);
  }

  if (GROWDESK_CONFIG.enabled) return client; // Go validates registered auth method and secret at token endpoints.

  if (client.tokenEndpointAuthMethod !== "none" && client.clientSecret) {
    if (!clientSecret) {
      throw new OAuthError("invalid_client", "Client secret is required", 401);
    }
    const secretHash = hashSecret(clientSecret);
    if (secretHash !== client.clientSecret) {
      // Also test plain comparison for static config fallback if secret wasn't pre-hashed
      const isStaticMatch = STATIC_OAUTH_CLIENTS.some(
        (sc) => sc.clientId === clientId && sc.clientSecret === clientSecret
      );
      if (!isStaticMatch) {
        throw new OAuthError("invalid_client", "Invalid client secret", 401);
      }
    }
  }

  return client;
}

/**
 * Exchanges Authorization Code for Access Token and Refresh Token
 */
export async function exchangeAuthorizationCode(params: {
  code: string;
  clientId: string;
  clientSecret?: string | null;
  redirectUri: string;
  codeVerifier: string;
  resource?: string | null;
  baseUrl: string;
  ip?: string;
  clientAuthMethod?: "none" | "client_secret_post" | "client_secret_basic";
}): Promise<TokenResponse> {
  if (GROWDESK_CONFIG.enabled) {
    const result = await sharedOAuthRequest<any>("/api/v1/mcp/oauth/token", {
      method: "POST",
      body: {
        grant_type: "authorization_code",
        client_id: params.clientId,
        client_auth_method: params.clientAuthMethod || (params.clientSecret ? "client_secret_post" : "none"),
        ...(params.clientSecret ? { client_secret: params.clientSecret } : {}),
        code: params.code,
        redirect_uri: params.redirectUri,
        code_verifier: params.codeVerifier,
        ...(params.resource ? { resource: params.resource } : {}),
      },
    });
    if (typeof result.access_token !== "string" || typeof result.expires_in !== "number" || typeof result.scope !== "string") {
      throw new OAuthError("server_error", "GrowDesk OAuth service returned an invalid token response", 502);
    }
    return result as TokenResponse;
  }

  const client = await authenticateClient(params.clientId, params.clientSecret);

  const authCode = await prisma.oAuthAuthorizationCode.findUnique({
    where: { code: params.code },
  });

  if (!authCode) {
    throw new OAuthError("invalid_grant", "Authorization code not found", 400);
  }

  if (authCode.used) {
    // Replay attack detected: revoke tokens and reject
    await prisma.oAuthRefreshToken.updateMany({
      where: { clientId: authCode.clientId, userId: authCode.userId },
      data: { revoked: true },
    });
    throw new OAuthError("invalid_grant", "Authorization code has already been used (replay detected)", 400);
  }

  // Atomically mark code as used (prevents concurrent race conditions)
  const updateResult = await prisma.oAuthAuthorizationCode.updateMany({
    where: { id: authCode.id, used: false },
    data: { used: true },
  });

  if (updateResult.count === 0) {
    await prisma.oAuthRefreshToken.updateMany({
      where: { clientId: authCode.clientId, userId: authCode.userId },
      data: { revoked: true },
    });
    throw new OAuthError("invalid_grant", "Authorization code has already been used (concurrent replay detected)", 400);
  }

  if (authCode.expiresAt < new Date()) {
    throw new OAuthError("invalid_grant", "Authorization code expired", 400);
  }

  if (authCode.clientId !== params.clientId) {
    throw new OAuthError("invalid_grant", "Authorization code was issued to a different client", 400);
  }

  if (authCode.redirectUri !== params.redirectUri) {
    throw new OAuthError("invalid_grant", "redirect_uri mismatch", 400);
  }

  if (!verifyCodeChallenge(params.codeVerifier, authCode.codeChallenge, authCode.codeChallengeMethod)) {
    throw new OAuthError("invalid_grant", "PKCE code_verifier verification failed", 400);
  }

  const targetResource = params.resource || authCode.resource || `${params.baseUrl}/mcp`;
  const tokenId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = OAUTH_EXPIRATIONS.ACCESS_TOKEN_SECONDS;

  // Sign access token bound to resource
  const accessToken = await new SignJWT({
    sub: authCode.userId,
    iss: params.baseUrl,
    aud: targetResource,
    client_id: authCode.clientId,
    scope: authCode.scope,
    baby_id: authCode.babyId,
    jti: tokenId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + expiresIn)
    .sign(getJwtSecretBytes());

  // Generate Rotating Refresh Token
  const rawRefreshToken = `rt_${crypto.randomBytes(32).toString("base64url")}`;
  const tokenHash = hashSecret(rawRefreshToken);
  const refreshExpiresAt = new Date(Date.now() + OAUTH_EXPIRATIONS.REFRESH_TOKEN_SECONDS * 1000);

  await prisma.oAuthRefreshToken.create({
    data: {
      tokenHash,
      clientId: authCode.clientId,
      userId: authCode.userId,
      babyId: authCode.babyId,
      scope: authCode.scope,
      resource: targetResource,
      expiresAt: refreshExpiresAt,
      revoked: false,
    },
  });

  await logOAuthAudit({
    clientId: authCode.clientId,
    userId: authCode.userId,
    babyId: authCode.babyId,
    action: "token_issue",
    authResult: "success",
    statusCode: 200,
    ip: params.ip,
    metadata: { scope: authCode.scope, resource: targetResource },
  });

  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: expiresIn,
    refresh_token: rawRefreshToken,
    scope: authCode.scope,
  };
}

/**
 * Refreshes Access Token using Refresh Token with token rotation
 */
export async function refreshAccessToken(params: {
  refreshToken: string;
  clientId: string;
  clientSecret?: string | null;
  scope?: string | null;
  resource?: string | null;
  baseUrl: string;
  ip?: string;
  clientAuthMethod?: "none" | "client_secret_post" | "client_secret_basic";
}): Promise<TokenResponse> {
  if (GROWDESK_CONFIG.enabled) {
    const result = await sharedOAuthRequest<any>("/api/v1/mcp/oauth/token", {
      method: "POST",
      body: {
        grant_type: "refresh_token",
        client_id: params.clientId,
        client_auth_method: params.clientAuthMethod || (params.clientSecret ? "client_secret_post" : "none"),
        ...(params.clientSecret ? { client_secret: params.clientSecret } : {}),
        refresh_token: params.refreshToken,
        ...(params.scope ? { scope: params.scope } : {}),
        ...(params.resource ? { resource: params.resource } : {}),
      },
    });
    if (typeof result.access_token !== "string" || typeof result.expires_in !== "number" || typeof result.scope !== "string") {
      throw new OAuthError("server_error", "GrowDesk OAuth service returned an invalid token response", 502);
    }
    return result as TokenResponse;
  }

  await authenticateClient(params.clientId, params.clientSecret);

  const tokenHash = hashSecret(params.refreshToken);

  const storedToken = await prisma.oAuthRefreshToken.findUnique({
    where: { tokenHash },
  });

  if (!storedToken || storedToken.revoked || storedToken.expiresAt < new Date()) {
    throw new OAuthError("invalid_grant", "Refresh token is invalid, expired, or revoked", 400);
  }

  if (storedToken.clientId !== params.clientId) {
    throw new OAuthError("invalid_grant", "Refresh token was issued to a different client", 400);
  }

  // Atomically revoke old refresh token (Token Rotation & Race Prevention)
  const revokeResult = await prisma.oAuthRefreshToken.updateMany({
    where: { id: storedToken.id, revoked: false },
    data: { revoked: true },
  });

  if (revokeResult.count === 0) {
    await prisma.oAuthRefreshToken.updateMany({
      where: { clientId: storedToken.clientId, userId: storedToken.userId },
      data: { revoked: true },
    });
    throw new OAuthError("invalid_grant", "Refresh token reuse or race condition detected", 400);
  }

  const targetResource = params.resource || storedToken.resource || `${params.baseUrl}/mcp`;
  const grantedScope = params.scope || storedToken.scope;
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = OAUTH_EXPIRATIONS.ACCESS_TOKEN_SECONDS;
  const tokenId = crypto.randomUUID();

  const accessToken = await new SignJWT({
    sub: storedToken.userId,
    iss: params.baseUrl,
    aud: targetResource,
    client_id: storedToken.clientId,
    scope: grantedScope,
    baby_id: storedToken.babyId,
    jti: tokenId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + expiresIn)
    .sign(getJwtSecretBytes());

  // Issue new rotated refresh token
  const newRawRefreshToken = `rt_${crypto.randomBytes(32).toString("base64url")}`;
  const newRefreshHash = hashSecret(newRawRefreshToken);
  const refreshExpiresAt = new Date(Date.now() + OAUTH_EXPIRATIONS.REFRESH_TOKEN_SECONDS * 1000);

  await prisma.oAuthRefreshToken.create({
    data: {
      tokenHash: newRefreshHash,
      clientId: storedToken.clientId,
      userId: storedToken.userId,
      babyId: storedToken.babyId,
      scope: grantedScope,
      resource: targetResource,
      expiresAt: refreshExpiresAt,
      revoked: false,
    },
  });

  await logOAuthAudit({
    clientId: storedToken.clientId,
    userId: storedToken.userId,
    babyId: storedToken.babyId,
    action: "token_refresh",
    authResult: "success",
    statusCode: 200,
    ip: params.ip,
  });

  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: expiresIn,
    refresh_token: newRawRefreshToken,
    scope: grantedScope,
  };
}

/**
 * RFC 7009: Token Revocation
 */
export async function revokeToken(params: {
  token: string;
  clientId: string;
  clientSecret?: string | null;
  ip?: string;
  clientAuthMethod?: "none" | "client_secret_post" | "client_secret_basic";
}): Promise<void> {
  if (GROWDESK_CONFIG.enabled) {
    await sharedOAuthRequest<{ success: boolean }>("/api/v1/mcp/oauth/revoke", {
      method: "POST",
      body: {
        token: params.token,
        client_id: params.clientId,
        client_auth_method: params.clientAuthMethod || (params.clientSecret ? "client_secret_post" : "none"),
        ...(params.clientSecret ? { client_secret: params.clientSecret } : {}),
      },
    });
    return;
  }

  try {
    await authenticateClient(params.clientId, params.clientSecret);
  } catch {}

  const tokenHash = hashSecret(params.token);

  await prisma.oAuthRefreshToken.updateMany({
    where: { tokenHash },
    data: { revoked: true },
  });

  await logOAuthAudit({
    clientId: params.clientId,
    action: "token_revoke",
    authResult: "success",
    statusCode: 200,
    ip: params.ip,
  });
}

/**
 * Normalizes a URL for audience / resource comparison (removes trailing slash and fragment)
 */
export function normalizeResourceUrl(urlStr: string): string {
  try {
    const url = new URL(urlStr);
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return urlStr.replace(/\/+$/, "");
  }
}

/**
 * Resolves human-readable source agent identity (e.g. "Gemini Spark", "ChatGPT", "Claude")
 */
export function resolveSourceAgent(
  clientId?: string,
  clientName?: string,
  userAgent?: string,
  redirectUris?: string[] | string
): string {
  const u = (userAgent || "").toLowerCase();
  const cn = (clientName || "").toLowerCase();
  const cid = (clientId || "").toLowerCase();
  const rUris = (
    Array.isArray(redirectUris)
      ? redirectUris.join(" ")
      : typeof redirectUris === "string"
      ? redirectUris
      : ""
  ).toLowerCase();

  // 1. Google Gemini / Gemini Spark
  if (
    cid.includes("gemini") ||
    cn.includes("gemini") ||
    u.includes("gemini") ||
    cid.includes("google") ||
    cn.includes("google") ||
    u.includes("google") ||
    rUris.includes("googleusercontent.com") ||
    rUris.includes("gemini.google.com") ||
    rUris.includes("googleapis.com")
  ) {
    return "Gemini Spark";
  }
  if (cid.includes("chatgpt") || cn.includes("chatgpt") || u.includes("chatgpt") || cn.includes("openai") || u.includes("openai")) {
    return "ChatGPT";
  }
  if (cid.includes("claude") || cn.includes("claude") || u.includes("claude") || u.includes("anthropic")) {
    return "Claude";
  }
  if (cid.includes("cursor") || cn.includes("cursor") || u.includes("cursor")) {
    return "Cursor";
  }
  if (cid.includes("cline") || cn.includes("cline") || u.includes("cline")) {
    return "Cline";
  }
  if (clientName && clientName.trim() && !clientName.includes("Fallback") && !clientName.includes("fallback")) {
    return clientName.trim();
  }
  if (clientId && clientId !== "unknown") {
    return clientId;
  }
  return "外部 Agent (MCP)";
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function verifySharedMcpAccessToken(token: string, request?: Request): Promise<UserPrincipal> {
  if (token.startsWith("bp_pat_")) {
    throw new OAuthError("invalid_token", "Personal access tokens are not MCP OAuth grants in shared mode", 401);
  }
  const result = await growdeskFetch<any>("/api/v1/mcp/principal", { accessToken: token });
  if (!result.ok) {
    const status = result.status === 401 ? 401 : result.status === 403 ? 403 : result.status >= 500 ? result.status : 401;
    const code = status === 403 ? "insufficient_scope" : status === 401 ? "invalid_token" : "server_error";
    throw new OAuthError(code, result.error?.message || "MCP access token is invalid or unavailable", status);
  }
  const data = result.data;
  if (!isRecord(data)) throw new OAuthError("server_error", "MCP principal response is invalid", 502);
  const babyData = data.baby;
  const memberData = data.member;
  const clientData = data.client;
  const userId = typeof data.userId === "string" ? data.userId : "";
  const babyId = typeof data.babyId === "string" ? data.babyId : "";
  const clientId = typeof data.clientId === "string"
    ? data.clientId
    : isRecord(clientData) && typeof clientData.clientId === "string" ? clientData.clientId : "";
  const familyId = isRecord(babyData) && typeof babyData.familyId === "string"
    ? babyData.familyId
    : isRecord(memberData) && typeof memberData.familyId === "string" ? memberData.familyId : "";
  if (
    !userId || !babyId || !clientId || !familyId ||
    !isRecord(babyData) || babyData.id !== babyId ||
    !isRecord(memberData) || (typeof memberData.babyId === "string" && memberData.babyId !== babyId) ||
    (typeof memberData.familyId === "string" && memberData.familyId !== familyId)
  ) {
    throw new OAuthError("invalid_token", "MCP grant does not resolve to a real authorized user, membership, and baby", 401);
  }
  if (!Array.isArray(data.scopes) || data.scopes.some((scope: unknown) => typeof scope !== "string")) {
    throw new OAuthError("invalid_token", "MCP grant scopes are invalid", 401);
  }
  const allowedScopes = new Set(Object.values(OAUTH_SCOPES));
  const scopes = new Set<string>(data.scopes.filter((scope: string) => allowedScopes.has(scope as any)));
  const username = typeof data.username === "string" ? data.username : "";
  const displayName = typeof data.displayName === "string" ? data.displayName : "";
  const clientName = typeof data.clientName === "string"
    ? data.clientName
    : isRecord(clientData) && typeof clientData.clientName === "string" ? clientData.clientName : undefined;
  const sourceAgent = typeof data.sourceAgent === "string" ? data.sourceAgent : "";
  const nickname = typeof babyData.nickname === "string" ? babyData.nickname : typeof babyData.name === "string" ? babyData.name : "";
  const birthDate = typeof babyData.birthDate === "string" ? babyData.birthDate : "";
  if (!username || !displayName || !sourceAgent || !nickname || !birthDate) {
    throw new OAuthError("invalid_token", "MCP principal is missing required user or baby fields", 401);
  }
  return {
    userId,
    username,
    displayName,
    babyId,
    scopes,
    clientId,
    clientName,
    sourceAgent,
    relation: typeof data.relation === "string" ? data.relation : typeof memberData.relation === "string" ? memberData.relation : undefined,
    role: typeof data.role === "string" ? data.role : typeof memberData.role === "string" ? memberData.role : undefined,
    userAgent: request?.headers.get("user-agent") || (typeof data.userAgent === "string" ? data.userAgent : undefined),
    ip: request ? getClientIp(request) : (typeof data.ip === "string" ? data.ip : undefined),
    baby: {
      id: babyId,
      familyId,
      nickname,
      gender: typeof babyData.gender === "string" ? babyData.gender : "unknown",
      birthDate,
      gestationalAge: typeof babyData.gestationalAge === "number" ? babyData.gestationalAge : null,
      avatarUrl: typeof babyData.avatarUrl === "string" ? babyData.avatarUrl : null,
    },
  };
}

/**
 * Verifies Bearer Access Token for MCP Resource Server (/mcp)
 * Validates Signature, Issuer, Audience, Expiration, and resolves UserPrincipal with strict IDOR checks.
 */
export async function verifyMcpAccessToken(
  token: string,
  request?: Request
): Promise<UserPrincipal> {
  if (GROWDESK_CONFIG.enabled) return verifySharedMcpAccessToken(token, request);

  if (token.startsWith("bp_pat_")) {
    const { verifyPersonalAccessToken } = await import("@/lib/tokens");
    const verifiedPat = await verifyPersonalAccessToken(token);
    if (!verifiedPat) {
      throw new OAuthError("invalid_token", "Personal access token invalid or revoked", 401);
    }
    const user = verifiedPat.user;
    const userAgent = request?.headers?.get("user-agent") || undefined;
    const sourceAgent = resolveSourceAgent("pat-client", undefined, userAgent);
    return {
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      babyId: "baby-1",
      scopes: new Set(["baby:read", "baby:write", "knowledge:read", "family:read"]),
      clientId: "pat-client",
      clientName: "Personal Access Token",
      sourceAgent,
      baby: {
        id: "baby-1",
        nickname: "宝宝",
        gender: "female",
        birthDate: "2026-01-01",
        familyId: "family-1",
      },
    };
  }

  const baseUrl = getBaseUrl(request);
  const expectedResource = normalizeResourceUrl(`${baseUrl}/mcp`);

  let payload: any;
  try {
    const verified = await jwtVerify(token, getJwtSecretBytes());
    payload = verified.payload;
  } catch (err: any) {
    throw new OAuthError("invalid_token", "Access token is invalid or expired", 401);
  }

  // Audience verification: token must strictly be bound to this MCP endpoint
  const rawAud = payload.aud;
  const tokenAud = Array.isArray(rawAud) ? rawAud : [rawAud];
  const isAudienceValid = tokenAud.some((audVal) => {
    if (typeof audVal !== "string") return false;
    const normalizedAud = normalizeResourceUrl(audVal);
    return normalizedAud === expectedResource;
  });

  if (!isAudienceValid) {
    throw new OAuthError(
      "invalid_token",
      `Token audience mismatch (expected ${expectedResource}, got ${JSON.stringify(rawAud)})`,
      401
    );
  }

  const userId = typeof payload.sub === "string" ? payload.sub : "";
  if (!userId) {
    throw new OAuthError("invalid_token", "Token subject (user_id) missing", 401);
  }

  // Load User & verify existence in database
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      memberships: {
        include: {
          family: {
            include: {
              babies: {
                orderBy: { createdAt: "asc" },
              },
            },
          },
        },
      },
    },
  });

  if (!user) {
    throw new OAuthError("invalid_token", "User account not found or disabled", 401);
  }

  // Multi-tenant & Baby resolution
  const userFamilies = user.memberships.map((m) => m.family);
  const allBabies = userFamilies.flatMap((f) => f.babies);
  const userBabyIds = new Set(allBabies.map((b) => b.id));

  let activeBaby: any = null;
  const tokenBabyId = typeof payload.baby_id === "string" ? payload.baby_id : null;

  if (tokenBabyId) {
    if (!userBabyIds.has(tokenBabyId)) {
      throw new OAuthError("insufficient_scope", "Forbidden: User does not have access to the specified baby", 403);
    }
    activeBaby = allBabies.find((b) => b.id === tokenBabyId);
  } else {
    activeBaby = allBabies[0] || null;
  }

  if (!activeBaby) {
    throw new OAuthError("invalid_grant", "No active baby profile found for this user", 400);
  }

  const scopesList: string[] = typeof payload.scope === "string"
    ? payload.scope.split(/\s+/).filter(Boolean)
    : [];

  const clientId = typeof payload.client_id === "string" ? payload.client_id : "unknown";
  let clientName: string | undefined;
  let redirectUrisJson: string | undefined;
  try {
    const client = await findClient(clientId);
    clientName = client?.clientName || undefined;
    redirectUrisJson = client?.redirectUrisJson || undefined;
  } catch {}

  const userAgent = request?.headers?.get("user-agent") || undefined;
  const ip = request ? getClientIp(request) : undefined;
  const sourceAgent = resolveSourceAgent(clientId, clientName, userAgent, redirectUrisJson);

  // If client was registered as "Google", normalize display to "Gemini Spark"
  const resolvedClientName =
    clientName?.toLowerCase().includes("google") || clientName?.toLowerCase().includes("gemini")
      ? "Gemini Spark"
      : clientName;

  const activeMembership = user.memberships.find((m) => m.familyId === activeBaby.familyId);

  return {
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    babyId: activeBaby.id,
    scopes: new Set(scopesList),
    clientId,
    clientName: resolvedClientName,
    sourceAgent,
    userAgent,
    ip,
    relation: activeMembership?.relation || "caregiver",
    role: activeMembership?.role || "member",
    baby: activeBaby,
  };
}

/**
 * Formats RFC 9728 Protected Resource Metadata for /mcp
 */
export function getProtectedResourceMetadata(baseUrl: string): OAuthProtectedResourceMetadata {
  return {
    resource: `${baseUrl}/mcp`,
    authorization_servers: [baseUrl],
    scopes_supported: [
      OAUTH_SCOPES.BABY_READ,
      OAUTH_SCOPES.BABY_WRITE,
      OAUTH_SCOPES.APP_READ,
      OAUTH_SCOPES.APP_WRITE,
    ],
    bearer_methods_supported: ["header"],
    resource_documentation: `${baseUrl}/api/docs`,
  };
}

/**
 * Formats RFC 8414 OAuth Authorization Server Metadata
 */
export function getAuthorizationServerMetadata(baseUrl: string): OAuthAuthorizationServerMetadata {
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    registration_endpoint: `${baseUrl}/oauth/register`,
    revocation_endpoint: `${baseUrl}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: [
      OAUTH_SCOPES.BABY_READ,
      OAUTH_SCOPES.BABY_WRITE,
      OAUTH_SCOPES.APP_READ,
      OAUTH_SCOPES.APP_WRITE,
    ],
  };
}

/**
 * Security & Audit Logger (Strictly redacts sensitive fields like tokens/secrets)
 */
export async function logOAuthAudit(params: {
  requestId?: string | null;
  clientId?: string | null;
  userId?: string | null;
  babyId?: string | null;
  action: string;
  toolName?: string | null;
  authResult: "success" | "denied" | "error";
  durationMs?: number | null;
  statusCode?: number | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (GROWDESK_CONFIG.enabled) {
    return;
  }
  try {
    const cleanMeta: Record<string, unknown> = {};
    if (params.metadata) {
      for (const [k, v] of Object.entries(params.metadata)) {
        if (/token|secret|password|hash|code|key/i.test(k)) continue;
        cleanMeta[k] = v;
      }
    }

    await prisma.oAuthAuditLog.create({
      data: {
        requestId: params.requestId || null,
        clientId: params.clientId || null,
        userId: params.userId || null,
        babyId: params.babyId || null,
        action: params.action,
        toolName: params.toolName || null,
        authResult: params.authResult,
        durationMs: params.durationMs || null,
        statusCode: params.statusCode || null,
        ip: params.ip || null,
        userAgent: params.userAgent ? params.userAgent.slice(0, 200) : null,
        metadataJson: Object.keys(cleanMeta).length > 0 ? JSON.stringify(cleanMeta) : null,
      },
    });
  } catch (err) {
    console.error("[OAuth Audit Log Error]:", err);
  }
}
