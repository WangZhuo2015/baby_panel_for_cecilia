import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-helpers";
import { getMcpUsageStatistics, type McpUsageDashboardData } from "@/lib/mcp/usage-service";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { loadWebBaby } from "@/lib/growdesk/bridge-identity";
import { growdeskFetch } from "@/lib/growdesk/client";
import { BridgeError } from "@/lib/growdesk/bridge-protocol";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    if (GROWDESK_CONFIG.enabled) {
      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }
      const { searchParams } = new URL(request.url);
      const requestedBabyId = searchParams.get("babyId");
      const baby = await loadWebBaby(growdeskFetch, bffSession.accessToken, requestedBabyId);

      if (!baby) {
        return NextResponse.json(
          { success: false, error: "家庭中未创建宝宝档案" },
          { status: 400 }
        );
      }

      // Keep the same response contract as the legacy statistics service.
      // A successful response must always contain an authorized baby.
      const data: McpUsageDashboardData = {
        baby: {
          id: baby.id,
          nickname: baby.nickname,
          familyId: baby.familyId,
          familyName: "家庭",
        },
        overview: {
          totalCalls: 0,
          todayCalls: 0,
          last7DaysCalls: 0,
          connectedAgentsCount: 0,
          successRate: 100,
          avgDurationMs: 0,
          readCallsCount: 0,
          writeCallsCount: 0,
          manageCallsCount: 0,
          totalRecordsCreatedByAi: 0,
        },
        connectedAgents: [],
        toolUsageRanking: [],
        dailyActivityTrend: [],
        recentAuditLogs: [],
      };
      return NextResponse.json({ success: true, data });
    }

    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;

    const { searchParams } = new URL(request.url);
    const babyId = searchParams.get("babyId");

    const data = await getMcpUsageStatistics(auth.user.id, babyId);
    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    if (error instanceof BridgeError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: error.status }
      );
    }
    console.error("GET /api/mcp/usage error:", error);
    const message = error instanceof Error ? error.message : "获取 AI 使用统计失败";
    const isClientError =
      message.includes("未加入任何家庭") ||
      message.includes("不存在或无权访问") ||
      message.includes("未创建宝宝档案");
    return NextResponse.json(
      { success: false, error: message },
      { status: isClientError ? 400 : 500 }
    );
  }
}
