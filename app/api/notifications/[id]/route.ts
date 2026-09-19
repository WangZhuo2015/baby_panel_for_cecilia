import { NextResponse } from "next/server";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { growdeskFetch } from "@/lib/growdesk/client";
import { bridgeErrorResponse, BridgeError, pathId, requireData } from "@/lib/growdesk/bridge-protocol";
import { verifyBffCsrf } from "@/lib/growdesk/csrf";
import { requireAuth } from "@/lib/api-helpers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing notification id" }, { status: 400 });
  }

  if (GROWDESK_CONFIG.enabled) {
    const csrfErr = verifyBffCsrf(request);
    if (csrfErr) return csrfErr;

    const bffSession = await resolveBffSession(request);
    if (!bffSession) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const result = await growdeskFetch(`/api/v1/notifications/${pathId(id)}/read`, {
        method: "POST",
        accessToken: bffSession.accessToken,
      });
      requireData(result);
      return NextResponse.json({ success: true });
    } catch (error) {
      return bridgeErrorResponse(error);
    }
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
