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

    // Total sleep minutes
    let totalSleepMinutes = 0;
    for (const record of sleepRecords) {
      const startMs = new Date(record.startTime).getTime();
      const endMs = new Date(record.endTime).getTime();
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue;
      const overlapMs =
        Math.min(endMs, dayEndMs) - Math.max(startMs, dayStartMs);
      if (overlapMs > 0) {
        totalSleepMinutes += Math.round(overlapMs / 60000);
      }
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
