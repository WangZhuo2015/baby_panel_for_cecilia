import { NextResponse } from "next/server";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { growdeskFetch } from "@/lib/growdesk/client";
import { bridgeErrorResponse, BridgeError, pathId, requireData } from "@/lib/growdesk/bridge-protocol";
import { verifyBffCsrf } from "@/lib/growdesk/csrf";
import { requireAuth } from "@/lib/api-helpers";
import { assertExpectedActor } from "@/lib/growdesk/nutrition-scope";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing notification id" }, { status: 400 });
  }

  if (GROWDESK_CONFIG.enabled) {
    try {
      const csrfErr = verifyBffCsrf(request, { enforceInTest: true });
      if (csrfErr) return csrfErr;
      const bffSession = await resolveBffSession(request);
      if (!bffSession) throw new BridgeError(401, "UNAUTHORIZED", "请先登录");
      assertExpectedActor(request, bffSession.user.id);
      const result = requireData(await growdeskFetch<{ success: boolean }>(
        `/api/v1/notifications/${pathId(id)}/read`, {
          method: "POST", accessToken: bffSession.accessToken,
        },
      ));
      if (result?.success !== true) throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", "服务端未确认已读状态");
      return NextResponse.json({ success: true }, { headers: { "cache-control": "no-store" } });
    } catch (error) { return bridgeErrorResponse(error); }
  }

  const auth = await requireAuth(request);
  if (auth.errorResponse) return auth.errorResponse;

  return NextResponse.json({ success: true });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return POST(request, { params });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing notification id" }, { status: 400 });
  }

  if (GROWDESK_CONFIG.enabled) {
    const bffSession = await resolveBffSession(request);
    if (!bffSession) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return bridgeErrorResponse(new BridgeError(
      501,
      "NOTIFICATION_DELETE_UNSUPPORTED",
      "GrowDesk 通知暂不支持服务端删除；daily/vaccine 等派生提醒仅支持浏览器本地清除",
    ));
  }

  const auth = await requireAuth(request);
  if (auth.errorResponse) return auth.errorResponse;

  return NextResponse.json({ success: true });
}
