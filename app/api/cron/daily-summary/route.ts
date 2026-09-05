import { NextResponse } from "next/server";
import { getClientIp } from "@/lib/rate-limit";
import { runDailySummaryCron } from "@/lib/cron/daily-summary";
import { isValidDateStr } from "@/lib/date";

export const maxDuration = 300;

function verifyCronAuth(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;

  // 1. If CRON_SECRET is configured in environment, it MUST strictly be validated
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader === `Bearer ${cronSecret}`) return true;

    const url = new URL(request.url);
    if (url.searchParams.get("secret") === cronSecret) return true;

    return false;
  }

  // 2. If no CRON_SECRET is configured, only allow loopback requests (systemd timer / localhost curl)
  const ip = getClientIp(request);
  const isLocal = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  return isLocal;
}

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
