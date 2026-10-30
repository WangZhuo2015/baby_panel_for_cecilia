import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-helpers";
import { GROWDESK_CONFIG } from "@/lib/config";
import {
  getDefaultLlmModelInfo,
  getLlmPreferences,
  getLlmProfileCatalog,
  LlmPreferenceError,
  saveLlmPreference,
} from "@/lib/llm-preferences";
import { BridgeError, bridgeErrorResponse } from "@/lib/growdesk/bridge-protocol";
import { verifyBffCsrf } from "@/lib/growdesk/csrf";
import { resolveBffSession } from "@/lib/growdesk/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PrincipalResult =
  | { userId: string; accessToken?: string }
  | { errorResponse: Response };

async function principal(request: Request, mutation: boolean): Promise<PrincipalResult> {
  if (GROWDESK_CONFIG.enabled) {
    if (mutation) {
      const csrf = verifyBffCsrf(request);
      if (csrf) return { errorResponse: csrf };
    }
    const session = await resolveBffSession(request);
    if (!session) {
      return { errorResponse: NextResponse.json({ error: "请先登录", code: "UNAUTHORIZED" }, { status: 401 }) };
    }
    return { userId: session.user.id, accessToken: session.accessToken };
  }

  const auth = await requireAuth(request);
  if (auth.errorResponse) return { errorResponse: auth.errorResponse };
  return { userId: auth.user.id };
}

function errorResponse(error: unknown): Response {
  if (error instanceof LlmPreferenceError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (error instanceof BridgeError) return bridgeErrorResponse(error);
  return NextResponse.json(
    { error: "AI preferences could not be loaded or saved", code: "llm_preferences_unavailable" },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request): Promise<Response> {
  try {
    const auth = await principal(request, false);
    if ("errorResponse" in auth) return auth.errorResponse;
    const preferences = await getLlmPreferences(auth.userId, auth.accessToken);
    return NextResponse.json(
      {
        data: {
          preferences,
          profiles: getLlmProfileCatalog(),
          activeProfileId: getDefaultLlmModelInfo().profileId,
          defaultModelInfo: getDefaultLlmModelInfo(),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const auth = await principal(request, true);
    if ("errorResponse" in auth) return auth.errorResponse;

    const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (contentType !== "application/json") {
      return NextResponse.json(
        { error: "Request must use application/json", code: "invalid_content_type" },
        { status: 415, headers: { "Cache-Control": "no-store" } },
      );
    }
    const raw = await request.text();
    if (raw.length > 2048) {
      return NextResponse.json(
        { error: "Request is too large", code: "request_too_large" },
        { status: 413, headers: { "Cache-Control": "no-store" } },
      );
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json(
        { error: "Request JSON is invalid", code: "invalid_json" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const selection = await saveLlmPreference(auth.userId, body, auth.accessToken);
    return NextResponse.json(
      { data: selection },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
