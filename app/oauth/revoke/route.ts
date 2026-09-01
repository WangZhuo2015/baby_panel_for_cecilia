import { NextResponse } from "next/server";
import { revokeToken } from "@/lib/oauth/service";
import { getClientIp } from "@/lib/rate-limit";

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
