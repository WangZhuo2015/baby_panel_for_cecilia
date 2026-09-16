import { growdeskRouteBoundary } from "@/lib/growdesk/route-boundary";
import { NextResponse } from "next/server";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { growdeskFetch } from "@/lib/growdesk/client";
import { bffNotificationStore } from "@/lib/growdesk/notifications";
import { requireAuth } from "@/lib/api-helpers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return growdeskRouteBoundary(request, async () => {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing notification id" }, { status: 400 });
  }

  if (GROWDESK_CONFIG.enabled) {
    const bffSession = await resolveBffSession(request);
    if (!bffSession) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const updated = await bffNotificationStore.markAsRead(bffSession.user.id, id, bffSession.accessToken);
    if (!updated) return NextResponse.json({ error: "通知不存在" }, { status: 404 });
    return NextResponse.json({ success: true });
  }

  const auth = await requireAuth(request);
  if (auth.errorResponse) return auth.errorResponse;

  return NextResponse.json({ success: true });
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return growdeskRouteBoundary(request, async () => {
  return POST(request, { params });
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return growdeskRouteBoundary(request, async () => {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing notification id" }, { status: 400 });
  }

  if (GROWDESK_CONFIG.enabled) {
    const bffSession = await resolveBffSession(request);
    if (!bffSession) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const deleted = await bffNotificationStore.deleteNotification(bffSession.user.id, id, bffSession.accessToken);
    if (!deleted) return NextResponse.json({ error: "通知不存在" }, { status: 404 });
    return NextResponse.json({ success: true });
  }

  const auth = await requireAuth(request);
  if (auth.errorResponse) return auth.errorResponse;

  return NextResponse.json({ success: true });
  });
}
