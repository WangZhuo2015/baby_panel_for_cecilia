import { familyTimeZone } from "@/lib/growdesk/record-list";
import { growdeskRouteBoundary } from "@/lib/growdesk/route-boundary";
import { readWebDailySummary, enqueueWebDailySummary } from "@/lib/growdesk/daily-summary";
import { readJsonObject } from "@/lib/growdesk/record-route-helpers";
import { NextResponse } from "next/server";
import { requireAuth, requireBaby } from "@/lib/api-helpers";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { generateAiDailySummary } from "@/lib/ai-daily-summary";
import { isValidDateStr, getLocalDateStr } from "@/lib/date";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { loadWebBaby } from "@/lib/growdesk/bridge-identity";
import { growdeskFetch } from "@/lib/growdesk/client";

export const maxDuration = 120;

export async function GET(request: Request) {
  try {
    if (GROWDESK_CONFIG.enabled) return growdeskRouteBoundary(request,async()=>{
      const session=await resolveBffSession(request);
      if(!session) return NextResponse.json({error:"会话已过期"},{status:401});
      const query=new URL(request.url).searchParams;
      return NextResponse.json(await readWebDailySummary(growdeskFetch,session.accessToken,session.user.id,query.get("babyId"),query.get("date")));
    });

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
    if (GROWDESK_CONFIG.enabled) return growdeskRouteBoundary(request,async()=>{
      const session=await resolveBffSession(request);
      if(!session) return NextResponse.json({error:"会话已过期"},{status:401});
      const body=await readJsonObject(request);
      if(!body.date) {
        const baby=await loadWebBaby(growdeskFetch,session.accessToken,body.babyId);
        if(!baby) return NextResponse.json({error:"宝宝不存在"},{status:404});
        const zone=await familyTimeZone(growdeskFetch,session.accessToken,baby.id);
        body.date=new Intl.DateTimeFormat("en-CA",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
      }
      const job=await enqueueWebDailySummary(growdeskFetch,session.accessToken,session.user.id,body);
      return NextResponse.json({jobId:job.id,babyId:job.babyId,status:"processing"},{status:202});
    });

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
