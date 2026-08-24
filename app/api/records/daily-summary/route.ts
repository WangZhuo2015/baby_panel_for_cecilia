import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getLocalDateStr, getLocalDayUtcRange, isValidDateStr } from "@/lib/date";
import { requireAuth, requireBaby } from "@/lib/api-helpers";

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get("date");
    if (dateParam && !isValidDateStr(dateParam)) {
      return NextResponse.json({ error: "Invalid date format, expected YYYY-MM-DD" }, { status: 400 });
    }
    const date = dateParam ?? getLocalDateStr();
    const requestedBabyId = searchParams.get("babyId");


    const babyResult = await requireBaby(user.id, requestedBabyId);
    if (babyResult.errorResponse) return babyResult.errorResponse;
    const babyId = babyResult.baby.id;

    const { start, end } = getLocalDayUtcRange(date);
    const dayStartMs = new Date(start).getTime();
    const dayEndMs = new Date(end).getTime();

    const feedingWhere = { babyId, timestamp: { gte: start, lt: end } };
    const sleepWhere = { babyId, startTime: { lt: end }, endTime: { gt: start } };
    const diaperWhere = { babyId, timestamp: { gte: start, lt: end } };
    const foodWhere = { babyId, date };

    // Fetch all records for the given date in parallel
    const [feedingRecords, sleepRecords, diaperRecords, foodLogs] = await Promise.all([
      prisma.feedingRecord.findMany({ where: feedingWhere }),
      prisma.sleepRecord.findMany({ where: sleepWhere }),
      prisma.diaperRecord.findMany({ where: diaperWhere }),
      prisma.foodLogRecord.findMany({ where: foodWhere }),
    ]);

    // Total feeding ml
    const totalFeedingMl = feedingRecords.reduce(
      (sum, r) => sum + (r.amountMl ?? 0),
      0
    );

    // Total sleep minutes —— 先做区间并集合并再求和，重叠/重复段不双计
    const sleepIntervals = sleepRecords
      .map((record) => ({
        startMs: new Date(record.startTime).getTime(),
        endMs: new Date(record.endTime).getTime(),
      }))
      .filter((iv) => !Number.isNaN(iv.startMs) && !Number.isNaN(iv.endMs) && iv.endMs > iv.startMs)
      .map((iv) => ({
        startMs: Math.max(iv.startMs, dayStartMs),
        endMs: Math.min(iv.endMs, dayEndMs),
      }))
      .filter((iv) => iv.endMs > iv.startMs)
      .sort((a, b) => a.startMs - b.startMs);

    let totalSleepMinutes = 0;
    let mergedStartMs = 0;
    let mergedEndMs = 0;
    for (const interval of sleepIntervals) {
      if (mergedEndMs === 0 || interval.startMs > mergedEndMs) {
        // 结算上一段
        if (mergedEndMs > 0) totalSleepMinutes += Math.round((mergedEndMs - mergedStartMs) / 60000);
        mergedStartMs = interval.startMs;
        mergedEndMs = interval.endMs;
      } else {
        mergedEndMs = Math.max(mergedEndMs, interval.endMs);
      }
    }
    if (mergedEndMs > 0) {
      totalSleepMinutes += Math.round((mergedEndMs - mergedStartMs) / 60000);
    }

    const diaperCount = diaperRecords.length;
    const foodCount = foodLogs.length;

    return NextResponse.json({
      totalFeedingMl,
      totalSleepMinutes,
      diaperCount,
      foodCount,
    });
  } catch (error) {
    console.error("GET /api/records/daily-summary error:", error);
    return NextResponse.json(
      { error: "Failed to fetch daily summary" },
      { status: 500 }
    );
  }
}
