import { NextResponse } from "next/server";
import { getAiTips } from "@/lib/ai-tips";
import { requireAuth, requireBaby } from "@/lib/api-helpers";

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const { searchParams } = new URL(request.url);
    const requestedBabyId = searchParams.get("babyId");

    const babyResult = await requireBaby(user.id, requestedBabyId);
    if (babyResult.errorResponse) return babyResult.errorResponse;

    const tips = await getAiTips(babyResult.baby.id);
    return NextResponse.json(tips);
  } catch (error: any) {
    console.error("GET /api/ai/tips error:", error);
    return NextResponse.json(
      { error: error?.message || "AI 育儿建议服务暂时不可用" },
      { status: 503 }
    );
  }
}
