import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getLocalDateStr, getLocalDayUtcRange } from "@/lib/date";
import { getAuthSession, getActiveBabyForUser } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const user = await getAuthSession(request);
    let babyId: string | undefined;
    if (user) {
      const active = await getActiveBabyForUser(user.id);
      babyId = active?.baby?.id;
    }

    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") ?? getLocalDateStr();
    const targetBabyId = searchParams.get("babyId") || babyId;

    const { start, end } = getLocalDayUtcRange(date);
    const dayStartMs = new Date(start).getTime();
    const dayEndMs = new Date(end).getTime();

    const feedingWhere: any = { timestamp: { gte: start, lt: end } };
    const sleepWhere: any = { startTime: { lt: end }, endTime: { gt: start } };
    const diaperWhere: any = { timestamp: { gte: start, lt: end } };
    const foodWhere: any = { date };

    if (targetBabyId) {
      feedingWhere.babyId = targetBabyId;
      sleepWhere.babyId = targetBabyId;
      diaperWhere.babyId = targetBabyId;
      foodWhere.babyId = targetBabyId;
    }

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
