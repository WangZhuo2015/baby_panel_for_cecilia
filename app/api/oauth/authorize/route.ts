import { NextResponse } from "next/server";
import { getAuthSession, verifyPassword, signAuthToken, AUTH_COOKIE_NAME } from "@/lib/auth";
import { findClient, validateRedirectUri, createAuthorizationCode, logOAuthAudit, OAuthError } from "@/lib/oauth/service";
import { prisma } from "@/lib/prisma";
import { config, AUTH_CONFIG, GROWDESK_CONFIG } from "@/lib/config";
import { getClientIp, checkRateLimit } from "@/lib/rate-limit";
import { loginBffSession, resolveBffSession } from "@/lib/growdesk/session";
import { loadWebIdentity } from "@/lib/growdesk/bridge-identity";
import { growdeskFetch } from "@/lib/growdesk/client";
import { verifyBffCsrf } from "@/lib/growdesk/csrf";
import { BridgeError } from "@/lib/growdesk/bridge-protocol";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get("client_id");
  const redirectUri = url.searchParams.get("redirect_uri");
  const responseType = url.searchParams.get("response_type");
  const scope = url.searchParams.get("scope") || "baby:read baby:write";
  const state = url.searchParams.get("state") || "";
  const codeChallenge = url.searchParams.get("code_challenge");
  const codeChallengeMethod = url.searchParams.get("code_challenge_method") || "S256";
  const resource = url.searchParams.get("resource");

  if (!clientId) {
    return NextResponse.json({ error: "invalid_request", error_description: "client_id is required" }, { status: 400 });
  }

  const client = await findClient(clientId);
  if (!client) {
    return NextResponse.json({ error: "invalid_client", error_description: "Client not found" }, { status: 400 });
  }

  if (!redirectUri || !validateRedirectUri(client, redirectUri, {
    allowUnregisteredGoogleCallback: !GROWDESK_CONFIG.enabled,
  })) {
    return NextResponse.json(
      { error: "invalid_redirect_uri", error_description: "Invalid or unregistered redirect_uri" },
      { status: 400 }
    );
  }

  if (responseType !== "code") {
    return NextResponse.json(
      { error: "unsupported_response_type", error_description: "response_type must be 'code'" },
      { status: 400 }
    );
  }

  if (!codeChallenge) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "code_challenge is required (PKCE)" },
      { status: 400 }
    );
  }

  if (codeChallengeMethod !== "S256") {
    return NextResponse.json(
      { error: "invalid_request", error_description: "code_challenge_method must be S256" },
      { status: 400 }
    );
  }

  const displayClientName =
    client.clientName?.toLowerCase().includes("google") ||
    client.clientId.toLowerCase().includes("google") ||
    client.redirectUrisJson.includes("googleusercontent.com")
      ? "Gemini Spark"
      : client.clientName || "Connected App";

  if (GROWDESK_CONFIG.enabled) {
    const bffSession = await resolveBffSession(request);
    if (!bffSession) {
      return NextResponse.json({
        authenticated: false,
        client: { clientId: client.clientId, clientName: displayClientName },
        params: { clientId, redirectUri, scope, state, codeChallenge, codeChallengeMethod, resource },
      });
    }
    const identity = await loadWebIdentity(growdeskFetch, bffSession.accessToken);
    const babies = identity.families.flatMap((family) => family.babies.map((baby) => ({
      id: baby.id,
      nickname: baby.nickname,
      gender: baby.gender,
      birthDate: baby.birthDate,
      familyName: family.family.name,
    })));
    return NextResponse.json({
      authenticated: true,
      user: {
        id: bffSession.user.id,
        username: bffSession.user.username,
        displayName: bffSession.user.displayName,
      },
      babies,
      client: { clientId: client.clientId, clientName: displayClientName },
      params: { clientId, redirectUri, scope, state, codeChallenge, codeChallengeMethod, resource },
    });
  }

  const sessionUser = await getAuthSession(request);

  if (!sessionUser) {
    return NextResponse.json({
      authenticated: false,
      client: {
        clientId: client.clientId,
        clientName: displayClientName,
      },
      params: {
        clientId,
        redirectUri,
        scope,
        state,
        codeChallenge,
        codeChallengeMethod,
        resource,
      },
    });
  }

  const allBabies = sessionUser.memberships.flatMap((m) =>
    m.family.babies.map((b) => ({
      id: b.id,
      nickname: b.nickname,
      gender: b.gender,
      birthDate: b.birthDate,
      familyName: m.family.name,
    }))
  );

  return NextResponse.json({
    authenticated: true,
    user: {
      id: sessionUser.id,
      username: sessionUser.username,
      displayName: sessionUser.displayName,
    },
    babies: allBabies,
    client: {
      clientId: client.clientId,
      clientName: displayClientName,
    },
    params: {
      clientId,
      redirectUri,
      scope,
      state,
      codeChallenge,
      codeChallengeMethod,
      resource,
    },
  });
}

export async function POST(request: Request) {
  if (GROWDESK_CONFIG.enabled) {
    const csrfError = verifyBffCsrf(request);
    if (csrfError) return csrfError;
  }
  const ip = getClientIp(request);
  const body = await request.json().catch(() => ({}));

  const {
    clientId,
    redirectUri,
    scope = "baby:read baby:write",
    state = "",
    codeChallenge,
    codeChallengeMethod = "S256",
    resource,
    babyId,
    decision, // "allow" | "deny"
    username,
    password,
  } = body;

  if (!clientId || !redirectUri || !codeChallenge) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Missing required parameters" },
      { status: 400 }
    );
  }

  const client = await findClient(clientId);
  if (!client || !validateRedirectUri(client, redirectUri, {
    allowUnregisteredGoogleCallback: !GROWDESK_CONFIG.enabled,
  })) {
    return NextResponse.json(
      { error: "invalid_client", error_description: "Invalid client or redirect URI" },
      { status: 400 }
    );
  }

  if (decision === "deny") {
    const errorUrl = new URL(redirectUri);
    errorUrl.searchParams.set("error", "access_denied");
    errorUrl.searchParams.set("error_description", "User denied authorization request");
    if (state) errorUrl.searchParams.set("state", state);
    return NextResponse.json({ redirect_url: errorUrl.toString() });
  }

  if (GROWDESK_CONFIG.enabled) {
    try {
      let bffSession = await resolveBffSession(request);
      let newSessionSecret: string | undefined;
      if (!bffSession && username && password) {
        const rateLimit = checkRateLimit(`login:${ip}`, 10, 60_000);
        if (!rateLimit.success) {
          return NextResponse.json(
            { error: "slow_down", error_description: `Login rate limit exceeded. Retry in ${rateLimit.resetSeconds}s` },
            { status: 429 }
          );
        }
        const cleanUsername = String(username).trim().toLowerCase();
        if (typeof password !== "string" || password.length > 72) {
          return NextResponse.json({ error: "invalid_credentials", error_description: "用户名或密码错误" }, { status: 401 });
        }
        const login = await loginBffSession(cleanUsername, password);
        if (!login.success || !login.sessionSecret) {
          return NextResponse.json(
            { error: "invalid_credentials", error_description: login.error || "用户名或密码错误" },
            { status: login.status || 401 }
          );
        }
        newSessionSecret = login.sessionSecret;
        const sessionRequest = new Request(request.url, {
          headers: { cookie: `${GROWDESK_CONFIG.cookieName}=${encodeURIComponent(newSessionSecret)}` },
        });
        bffSession = await resolveBffSession(sessionRequest);
      }
      if (!bffSession) {
        return NextResponse.json(
          { error: "unauthorized", error_description: "Please login to approve authorization" },
          { status: 401 }
        );
      }

      const identity = await loadWebIdentity(growdeskFetch, bffSession.accessToken);
      const selectedBabyId = babyId ? String(babyId) : identity.baby?.id;
      if (!selectedBabyId || identity.babies.length === 0) {
        return NextResponse.json({ error: "invalid_request", error_description: "该账号没有可授权的宝宝档案" }, { status: 400 });
      }
      if (!identity.babies.some((baby) => baby.id === selectedBabyId)) {
        return NextResponse.json(
          { error: "invalid_request", error_description: "Selected baby does not belong to the authenticated user" },
          { status: 403 }
        );
      }

      const code = await createAuthorizationCode({
        clientId,
        userId: bffSession.user.id,
        babyId: selectedBabyId,
        redirectUri,
        scope,
        resource,
        codeChallenge,
        codeChallengeMethod,
        accessToken: bffSession.accessToken,
      });
      const callbackUrl = new URL(redirectUri);
      callbackUrl.searchParams.set("code", code);
      if (state) callbackUrl.searchParams.set("state", state);
      const response = NextResponse.json({ redirect_url: callbackUrl.toString() });
      if (newSessionSecret) {
        response.cookies.set({
          name: GROWDESK_CONFIG.cookieName,
          value: newSessionSecret,
          httpOnly: true,
          secure: config.isProduction,
          sameSite: "lax",
          path: "/",
          maxAge: 30 * 24 * 60 * 60,
        });
      }
      return response;
    } catch (error) {
      if (error instanceof OAuthError) {
        return NextResponse.json({ error: error.error, error_description: error.errorDescription }, { status: error.statusCode });
      }
      if (error instanceof BridgeError) {
        return NextResponse.json({ error: error.code, error_description: error.message }, { status: error.status });
      }
      console.error("[OAuth Shared Authorize Error]:", error);
      return NextResponse.json({ error: "server_error", error_description: "Failed to authorize MCP client" }, { status: 502 });
    }
  }

  // Resolve user: either from current session or from inline login credentials
  let user = await getAuthSession(request);
  let newSessionToken: string | null = null;

  if (!user && username && password) {
    const rateLimit = checkRateLimit(`login:${ip}`, 10, 60_000);
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: "slow_down", error_description: `Login rate limit exceeded. Retry in ${rateLimit.resetSeconds}s` },
        { status: 429 }
      );
    }

    const cleanUsername = String(username).trim().toLowerCase();
    const candidate = await prisma.user.findUnique({
      where: { username: cleanUsername },
      include: {
        memberships: {
          include: {
            family: {
              include: {
                babies: true,
              },
            },
          },
        },
      },
    });

    const DUMMY_HASH = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8.PxHqXn5rJQWvFPGf1PVLfZGmOB7a";
    const isValid = await verifyPassword(String(password), candidate?.passwordHash ?? DUMMY_HASH);
    if (!candidate || !isValid) {
      return NextResponse.json(
        { error: "invalid_credentials", error_description: "用户名或密码错误" },
        { status: 401 }
      );
    }

    user = candidate;
    newSessionToken = await signAuthToken({
      userId: candidate.id,
      username: candidate.username,
    });
  }

  if (!user) {
    return NextResponse.json(
      { error: "unauthorized", error_description: "Please login to approve authorization" },
      { status: 401 }
    );
  }

  // Validate baby selection
  const userBabies = user.memberships.flatMap((m) => m.family.babies);
  let selectedBabyId = babyId;
  if (!selectedBabyId && userBabies.length > 0) {
    selectedBabyId = userBabies[0].id;
  }

  if (selectedBabyId) {
    const babyExists = userBabies.some((b) => b.id === selectedBabyId);
    if (!babyExists) {
      return NextResponse.json(
        { error: "invalid_request", error_description: "Selected baby does not belong to user's families" },
        { status: 403 }
      );
    }
  }

  // Create Authorization Code
  const code = await createAuthorizationCode({
    clientId,
    userId: user.id,
    babyId: selectedBabyId,
    redirectUri,
    scope,
    resource,
    codeChallenge,
    codeChallengeMethod,
  });

  // Record/Update user consent
  if (selectedBabyId) {
    await prisma.oAuthConsent.upsert({
      where: {
        userId_clientId_babyId: {
          userId: user.id,
          clientId,
          babyId: selectedBabyId,
        },
      },
      create: {
        userId: user.id,
        clientId,
        babyId: selectedBabyId,
        scope,
      },
      update: {
        scope,
        updatedAt: new Date(),
      },
    }).catch(() => {});
  }

  await logOAuthAudit({
    clientId,
    userId: user.id,
    babyId: selectedBabyId,
    action: "auth_grant",
    authResult: "success",
    statusCode: 200,
    ip,
    metadata: { scope, redirectUri },
  });

  const callbackUrl = new URL(redirectUri);
  callbackUrl.searchParams.set("code", code);
  if (state) callbackUrl.searchParams.set("state", state);

  const response = NextResponse.json({ redirect_url: callbackUrl.toString() });

  if (newSessionToken) {
    response.cookies.set({
      name: AUTH_COOKIE_NAME,
      value: newSessionToken,
      httpOnly: true,
      secure: config.isProduction,
      sameSite: "lax",
      path: "/",
      maxAge: AUTH_CONFIG.cookieMaxAge,
    });
  }

  return response;
}
