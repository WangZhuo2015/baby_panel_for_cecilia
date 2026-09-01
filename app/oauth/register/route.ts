import { NextResponse } from "next/server";
import { registerClient, OAuthError } from "@/lib/oauth/service";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const rateLimit = checkRateLimit(`oauth_register:${ip}`, 10, 60_000);
  if (!rateLimit.success) {
    return NextResponse.json(
      {
        error: "slow_down",
        error_description: `Registration rate limit exceeded. Retry after ${rateLimit.resetSeconds}s.`,
      },
      { status: 429 }
    );
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "invalid_request", error_description: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const client = await registerClient(body, ip);

    return NextResponse.json(client, {
      status: 201,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        Pragma: "no-cache",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err: any) {
    if (err instanceof OAuthError) {
      return NextResponse.json(
        { error: err.error, error_description: err.errorDescription },
        { status: err.statusCode }
      );
    }
    console.error("[OAuth Register Error]:", err);
    return NextResponse.json(
      { error: "server_error", error_description: "Failed to register client" },
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
