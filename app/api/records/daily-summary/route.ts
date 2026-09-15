import { NextResponse } from "next/server";
import { requireAuth, requireBaby } from "@/lib/api-helpers";
import * as records from "@/lib/records/service";
import { ValidationError } from "@/lib/records/service";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { growdeskFetch } from "@/lib/growdesk/client";
import { BridgeError, bridgeErrorResponse, calendarDate } from "@/lib/growdesk/bridge-protocol";
import { fetchLegacyRecordList, familyDayBounds, familyTimeZone } from "@/lib/growdesk/record-list";
import { fromGrowDeskFeedingRecord, type GrowDeskFeedingRecord } from "@/lib/growdesk/feeding-compat";
import { fromGrowDeskSleepRecord, type GrowDeskSleepRecord } from "@/lib/growdesk/sleep-compat";
import { fromGrowDeskDiaperRecord, type GrowDeskDiaperRecord } from "@/lib/growdesk/diaper-compat";
import { fromGrowDeskFoodRecord, type GrowDeskFoodRecord } from "@/lib/growdesk/food-compat";
import { getFeedingEffectiveMl } from "@/lib/nutrition/breastmilk";

function currentLocalDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

async function growDeskDailySummary(request: Request): Promise<Response> {
  const bffSession = await resolveBffSession(request);
  if (!bffSession) return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const babyId = searchParams.get("babyId");
  if (!babyId) return NextResponse.json({ error: "请提供 babyId" }, { status: 400 });

  const requestedDate = searchParams.get("date");
  const date = requestedDate
    ? calendarDate(requestedDate)
    : currentLocalDate(new Date(), await familyTimeZone(growdeskFetch, bffSession.accessToken, babyId));
  const dateQuery = new URLSearchParams({ date });
  const [feedingRaw, sleepRaw, diaperRaw, foodRaw, bounds] = await Promise.all([
    fetchLegacyRecordList<GrowDeskFeedingRecord>(growdeskFetch, bffSession.accessToken, babyId, dateQuery, "feeding"),
    fetchLegacyRecordList<GrowDeskSleepRecord>(growdeskFetch, bffSession.accessToken, babyId, dateQuery, "sleep"),
    fetchLegacyRecordList<GrowDeskDiaperRecord>(growdeskFetch, bffSession.accessToken, babyId, dateQuery, "diaper"),
    fetchLegacyRecordList<GrowDeskFoodRecord>(growdeskFetch, bffSession.accessToken, babyId, dateQuery, "food"),
    familyDayBounds(growdeskFetch, bffSession.accessToken, babyId, date),
  ]);
  const feedingRecords = feedingRaw.map(fromGrowDeskFeedingRecord);
  const sleepRecords = sleepRaw.map(fromGrowDeskSleepRecord);
  const diaperRecords = diaperRaw.map(fromGrowDeskDiaperRecord);
  const foodRecords = foodRaw.map(fromGrowDeskFoodRecord);

  const totalFeedingMl = feedingRecords.reduce((sum, record) => sum + getFeedingEffectiveMl(record), 0);
  const intervals = sleepRecords
    .map((record) => ({ start: new Date(record.startTime ?? record.startedAt ?? "").getTime(), end: record.endTime ? new Date(record.endTime ?? record.endedAt ?? "").getTime() : NaN }))
    .filter((interval) => Number.isFinite(interval.start) && Number.isFinite(interval.end) && interval.end > interval.start)
    .map((interval) => ({ start: Math.max(interval.start, bounds.start.getTime()), end: Math.min(interval.end, bounds.end.getTime()) }))
    .filter((interval) => interval.end > interval.start)
    .sort((left, right) => left.start - right.start);
  let totalSleepMinutes = 0;
  let mergedStart = 0;
  let mergedEnd = 0;
  for (const interval of intervals) {
    if (mergedEnd === 0 || interval.start > mergedEnd) {
      if (mergedEnd > 0) totalSleepMinutes += Math.round((mergedEnd - mergedStart) / 60000);
      mergedStart = interval.start;
      mergedEnd = interval.end;
    } else {
      mergedEnd = Math.max(mergedEnd, interval.end);
    }
  }
  if (mergedEnd > 0) totalSleepMinutes += Math.round((mergedEnd - mergedStart) / 60000);

  return NextResponse.json({ date, totalFeedingMl, totalSleepMinutes, diaperCount: diaperRecords.length, foodCount: foodRecords.length }, {
    headers: { "cache-control": "no-store" },
  });
}

export async function GET(request: Request) {
  try {
    if (GROWDESK_CONFIG.enabled) return await growDeskDailySummary(request);

    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get("date");
    const babyResult = await requireBaby(auth.user, searchParams.get("babyId"));
    if (babyResult.errorResponse) return babyResult.errorResponse;
    const ctx = { userId: auth.user.id, babyId: babyResult.baby.id, baby: babyResult.baby };
    const summary = await records.getDailySummary(ctx, dateParam || undefined);
    return NextResponse.json(summary);
  } catch (e) {
    if (e instanceof BridgeError) return bridgeErrorResponse(e);
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("GET /api/records/daily-summary error:", e);
    return NextResponse.json({ error: "Failed to fetch daily summary" }, { status: 500 });
  }
}
