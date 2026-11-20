import { NextResponse } from "next/server";
import { OAuthError, revokeToken } from "@/lib/oauth/service";
import { getClientIp } from "@/lib/rate-limit";
import { GROWDESK_CONFIG } from "@/lib/config";

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

  try {
    const body = await parseRequestBody(request);
    let clientId = body.client_id || "";
    let clientSecret = body.client_secret;
    let clientAuthMethod = body.client_auth_method;

    const authHeader = request.headers.get("authorization");
    if (authHeader?.startsWith("Basic ")) {
      try {
        const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf-8");
        const colonIdx = decoded.indexOf(":");
        if (colonIdx <= 0) throw new Error("malformed basic credentials");
        const basicClientId = decoded.slice(0, colonIdx);
        if (clientId && clientId !== basicClientId) {
          return NextResponse.json({ error: "invalid_client", error_description: "Basic authorization client_id mismatch" }, { status: 401 });
        }
        if (clientAuthMethod && clientAuthMethod !== "client_secret_basic") {
          return NextResponse.json({ error: "invalid_client", error_description: "Client authentication method mismatch" }, { status: 401 });
        }
        clientId = basicClientId;
        clientSecret = decoded.slice(colonIdx + 1);
        clientAuthMethod = "client_secret_basic";
      } catch {
        return NextResponse.json({ error: "invalid_client", error_description: "Malformed Basic authorization" }, { status: 401 });
      }
    }
    if (!clientAuthMethod) clientAuthMethod = clientSecret ? "client_secret_post" : "none";
    if (!["none", "client_secret_post", "client_secret_basic"].includes(clientAuthMethod)) {
      return NextResponse.json({ error: "invalid_client", error_description: "Unsupported client authentication method" }, { status: 401 });
    }

    const token = body.token;
    if (!token) {
      return NextResponse.json(
        { error: "invalid_request", error_description: "token is required" },
        { status: 400 }
      );
    }

    await revokeToken({
      token,
      clientId,
      clientSecret,
      ip,
      clientAuthMethod: clientAuthMethod as "none" | "client_secret_post" | "client_secret_basic",
    });

    return new NextResponse(null, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        Pragma: "no-cache",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err: any) {
    console.error("[OAuth Revoke Error]:", err);
    if (GROWDESK_CONFIG.enabled && err instanceof OAuthError) {
      return NextResponse.json({ error: err.error, error_description: err.errorDescription }, { status: err.statusCode });
    }
    return new NextResponse(null, { status: 200 }); // RFC 7009: return 200 even on lookup failure
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
