import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-helpers";
import { getMcpUsageStatistics } from "@/lib/mcp/usage-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;

    const { searchParams } = new URL(request.url);
    const babyId = searchParams.get("babyId");

    const data = await getMcpUsageStatistics(auth.user.id, babyId);
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error("GET /api/mcp/usage error:", error);
    const message = error?.message || "获取 AI 使用统计失败";
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
