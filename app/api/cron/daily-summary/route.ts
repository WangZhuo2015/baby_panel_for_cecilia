import { NextResponse } from "next/server";
import { runDailySummaryCron } from "@/lib/cron/daily-summary";
import { isValidDateStr } from "@/lib/date";
import { verifyCronAuth } from "@/lib/cron/auth";

export const maxDuration = 300;

export async function GET(request: Request) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized cron request" }, { status: 401 });
  }

  const url = new URL(request.url);
  const targetDate = url.searchParams.get("date") || undefined;
  const babyId = url.searchParams.get("babyId") || undefined;
  const todayOnly = url.searchParams.get("todayOnly") === "1" || url.searchParams.get("todayOnly") === "true";
  const forceRefresh = url.searchParams.get("force") !== "0";

  if (targetDate && !isValidDateStr(targetDate)) {
    return NextResponse.json({ error: "Invalid date format, expected YYYY-MM-DD" }, { status: 400 });
  }

  try {
    const results = await runDailySummaryCron({
      targetDate,
      babyId,
      todayOnly,
      forceRefresh,
    });

    const successCount = results.filter((r) => r.isAiGenerated || !r.error).length;
    const failedCount = results.filter((r) => r.error).length;

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      count: results.length,
      successCount,
      failedCount,
      results: results.map((r) => ({
        babyId: r.babyId,
        date: r.date,
        isAiGenerated: r.isAiGenerated,
        durationMs: r.durationMs,
        error: r.error,
      })),
    });
  } catch (error: any) {
    console.error("[CRON GET /api/cron/daily-summary] Error:", error);
    return NextResponse.json(
      { error: error?.message || "Cron execution failed" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized cron request" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const targetDate = body.date || undefined;
  const babyId = body.babyId || undefined;
  const todayOnly = body.todayOnly === true;
  const forceRefresh = body.force !== false;

  if (targetDate && !isValidDateStr(targetDate)) {
    return NextResponse.json({ error: "Invalid date format, expected YYYY-MM-DD" }, { status: 400 });
  }

  try {
    const results = await runDailySummaryCron({
      targetDate,
      babyId,
      todayOnly,
      forceRefresh,
    });

    const successCount = results.filter((r) => r.isAiGenerated || !r.error).length;
    const failedCount = results.filter((r) => r.error).length;

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      count: results.length,
      successCount,
      failedCount,
      results: results.map((r) => ({
        babyId: r.babyId,
        date: r.date,
        isAiGenerated: r.isAiGenerated,
        durationMs: r.durationMs,
        error: r.error,
      })),
    });
  } catch (error: any) {
    console.error("[CRON POST /api/cron/daily-summary] Error:", error);
    return NextResponse.json(
      { error: error?.message || "Cron execution failed" },
      { status: 500 }
    );
  }
}
