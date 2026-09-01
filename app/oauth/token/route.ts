import { NextResponse } from "next/server";
import {
  exchangeAuthorizationCode,
  refreshAccessToken,
  OAuthError,
} from "@/lib/oauth/service";
import { getBaseUrl } from "@/lib/oauth/config";
import { getClientIp, checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

async function parseRequestBody(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await request.text();
    const params = new URLSearchParams(text);
    const result: Record<string, string> = {};
    for (const [k, v] of params.entries()) {
      result[k] = v;
    }
    return result;
  }
  if (contentType.includes("application/json")) {
    const json = await request.json().catch(() => ({}));
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(json)) {
      if (v != null) result[k] = String(v);
    }
    return result;
  }

  // Fallback: try parsing form-urlencoded then json
  const raw = await request.text();
  try {
    const json = JSON.parse(raw);
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(json)) {
      if (v != null) result[k] = String(v);
    }
    return result;
  } catch {
    const params = new URLSearchParams(raw);
    const result: Record<string, string> = {};
    for (const [k, v] of params.entries()) {
      result[k] = v;
    }
    return result;
  }
}

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const rateLimit = checkRateLimit(`oauth_token:${ip}`, 30, 60_000);
  if (!rateLimit.success) {
    return NextResponse.json(
      {
        error: "slow_down",
        error_description: `Token rate limit exceeded. Retry after ${rateLimit.resetSeconds}s.`,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.resetSeconds),
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }

  const baseUrl = getBaseUrl(request);

  try {
    const body = await parseRequestBody(request);

    // Extract basic auth credentials if present
    let clientId = body.client_id;
    let clientSecret = body.client_secret;

    const authHeader = request.headers.get("authorization");
    if (authHeader?.startsWith("Basic ")) {
      try {
        const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf-8");
        const colonIdx = decoded.indexOf(":");
        if (colonIdx !== -1) {
          clientId = decoded.slice(0, colonIdx);
          clientSecret = decoded.slice(colonIdx + 1);
        }
      } catch {}
    }

    if (!clientId) {
      return NextResponse.json(
        { error: "invalid_client", error_description: "client_id is required" },
        { status: 400 }
      );
    }

    const grantType = body.grant_type;

    if (grantType === "authorization_code") {
      const code = body.code;
      const redirectUri = body.redirect_uri;
      const codeVerifier = body.code_verifier;
      const resource = body.resource;

      if (!code) {
        return NextResponse.json(
          { error: "invalid_request", error_description: "code is required" },
          { status: 400 }
        );
      }
      if (!redirectUri) {
        return NextResponse.json(
          { error: "invalid_request", error_description: "redirect_uri is required" },
          { status: 400 }
        );
      }
      if (!codeVerifier) {
        return NextResponse.json(
          { error: "invalid_request", error_description: "code_verifier (PKCE) is required" },
          { status: 400 }
        );
      }

      const tokenResponse = await exchangeAuthorizationCode({
        code,
        clientId,
        clientSecret,
        redirectUri,
        codeVerifier,
        resource,
        baseUrl,
        ip,
      });

      return NextResponse.json(tokenResponse, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          Pragma: "no-cache",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    if (grantType === "refresh_token") {
      const refreshToken = body.refresh_token;
      const scope = body.scope;
      const resource = body.resource;

      if (!refreshToken) {
        return NextResponse.json(
          { error: "invalid_request", error_description: "refresh_token is required" },
          { status: 400 }
        );
      }

      const tokenResponse = await refreshAccessToken({
        refreshToken,
        clientId,
        clientSecret,
        scope,
        resource,
        baseUrl,
        ip,
      });

      return NextResponse.json(tokenResponse, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          Pragma: "no-cache",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    return NextResponse.json(
      {
        error: "unsupported_grant_type",
        error_description: `Grant type '${grantType}' is not supported`,
      },
      { status: 400 }
    );
  } catch (err: any) {
    if (err instanceof OAuthError) {
      return NextResponse.json(
        { error: err.error, error_description: err.errorDescription },
        { status: err.statusCode }
      );
    }
    console.error("[OAuth Token Endpoint Error]:", err);
    return NextResponse.json(
      { error: "server_error", error_description: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
