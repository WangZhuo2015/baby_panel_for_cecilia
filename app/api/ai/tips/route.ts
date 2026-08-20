import { NextResponse } from "next/server";
import { getAiTips } from "@/lib/ai-tips";
import { getAuthSession, getActiveBabyForUser } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const user = await getAuthSession(request);
    let babyId: string | undefined;
    if (user) {
      const active = await getActiveBabyForUser(user.id);
      babyId = active?.baby?.id;
    }

    const tips = await getAiTips(babyId);
    return NextResponse.json(tips);
  } catch (error: any) {
    console.error("GET /api/ai/tips error:", error);
    return NextResponse.json(
      { error: error?.message || "AI 育儿建议服务暂时不可用" },
      { status: 503 }
    );
  }
}
