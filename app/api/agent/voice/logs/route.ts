import { growdeskRouteBoundary } from "@/lib/growdesk/route-boundary";
import { bridgeErrorResponse } from "@/lib/growdesk/bridge-protocol";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-helpers";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { bffVoiceLogStore } from "@/lib/growdesk/voice-logs";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return growdeskRouteBoundary(request, async () => {
  try {
    if (GROWDESK_CONFIG.enabled) {
      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ success: false, error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }
      const { searchParams } = new URL(request.url);
      const unreadAsyncOnly = searchParams.get("unreadAsync") === "true";
      const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
      const res = await bffVoiceLogStore.listLogs(bffSession.user.id, { limit, unreadAsyncOnly, accessToken: bffSession.accessToken });
      if (unreadAsyncOnly) {
        return NextResponse.json({ success: true, unreadLog: res.unreadLog || null });
      }
      return NextResponse.json({ success: true, logs: res.logs });
    }

    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;

    const { searchParams } = new URL(request.url);
    const unreadAsyncOnly = searchParams.get("unreadAsync") === "true";

    if (unreadAsyncOnly) {
      // Find the most recent unacknowledged async log in the last 24 hours
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const unreadLog = await prisma.agentVoiceLog.findFirst({
        where: {
          userId: auth.user.id,
          isAsync: true,
          acknowledged: false,
          createdAt: { gte: since24h },
        },
        orderBy: { createdAt: "desc" },
        include: {
          baby: { select: { id: true, nickname: true, gender: true } },
        },
      });

      return NextResponse.json({
        success: true,
        unreadLog,
      });
    }

    // Default list
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
    const logs = await prisma.agentVoiceLog.findMany({
      where: { userId: auth.user.id },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        baby: { select: { id: true, nickname: true, gender: true } },
      },
    });

    return NextResponse.json({ success: true, logs });
  } catch (error: any) {
    if (GROWDESK_CONFIG.enabled) return bridgeErrorResponse(error);
    console.error("GET /api/agent/voice/logs error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "获取语音记录失败" },
      { status: 500 }
    );
  }
  });
}
