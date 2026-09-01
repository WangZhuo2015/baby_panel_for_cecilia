import { NextResponse } from "next/server";
import { requireAuth, requireBaby } from "@/lib/api-helpers";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { generateAiDailySummary } from "@/lib/ai-daily-summary";
import { isValidDateStr, getLocalDateStr } from "@/lib/date";

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const rateLimit = checkRateLimit(`ai_daily_summary:${user.id || getClientIp(request)}`, 30, 60_000);
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: "请求过于频繁，请稍后再试" },
        { status: 429, headers: { "Retry-After": String(rateLimit.resetSeconds) } }
      );
    }

    const { searchParams } = new URL(request.url);
    const requestedBabyId = searchParams.get("babyId");
    const dateParam = searchParams.get("date");
    const forceParam = searchParams.get("force");

    const date = dateParam && isValidDateStr(dateParam) ? dateParam : getLocalDateStr();
    if (dateParam && !isValidDateStr(dateParam)) {
      return NextResponse.json({ error: "日期格式无效，必须为 YYYY-MM-DD" }, { status: 400 });
    }

    const babyResult = await requireBaby(user.id, requestedBabyId);
    if (babyResult.errorResponse) return babyResult.errorResponse;

    const summary = await generateAiDailySummary(
      { userId: user.id, babyId: babyResult.baby.id, baby: babyResult.baby },
      date,
      { forceRefresh: forceParam === "true" || forceParam === "1" }
    );

    return NextResponse.json({ summary });
  } catch (error: unknown) {
    console.error("GET /api/ai/daily-summary error:", error);
    const message = error instanceof Error ? error.message : "获取每日 AI 总结失败";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const rateLimit = checkRateLimit(`ai_daily_summary_post:${user.id || getClientIp(request)}`, 20, 60_000);
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: "重新生成过于频繁，请稍后再试" },
        { status: 429, headers: { "Retry-After": String(rateLimit.resetSeconds) } }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { babyId, date: dateParam, force } = body;

    const date = dateParam && isValidDateStr(dateParam) ? dateParam : getLocalDateStr();
    if (dateParam && !isValidDateStr(dateParam)) {
      return NextResponse.json({ error: "日期格式无效，必须为 YYYY-MM-DD" }, { status: 400 });
    }

    const babyResult = await requireBaby(user.id, babyId);
    if (babyResult.errorResponse) return babyResult.errorResponse;

    const summary = await generateAiDailySummary(
      { userId: user.id, babyId: babyResult.baby.id, baby: babyResult.baby },
      date,
      { forceRefresh: force !== false }
    );

    return NextResponse.json({ summary });
  } catch (error: any) {
    console.error("POST /api/ai/daily-summary error:", error);
    return NextResponse.json(
      { error: error?.message || "生成每日 AI 总结失败" },
      { status: 500 }
    );
  }
}
