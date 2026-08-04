import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getLocalDateStr, getLocalDayUtcRange } from "@/lib/date";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") ?? getLocalDateStr();
    const { start, end } = getLocalDayUtcRange(date);
    const dayStartMs = new Date(start).getTime();
    const dayEndMs = new Date(end).getTime();

    // Fetch all records for the given date in parallel
    const [feedingRecords, sleepRecords, diaperRecords, foodLogs] = await Promise.all([
      prisma.feedingRecord.findMany({
        where: { timestamp: { gte: start, lt: end } },
      }),
      prisma.sleepRecord.findMany({
        where: { startTime: { lt: end }, endTime: { gt: start } },
      }),
      prisma.diaperRecord.findMany({
        where: { timestamp: { gte: start, lt: end } },
      }),
      prisma.foodLogRecord.findMany({
        where: { date },
      }),
    ]);

    // Total feeding ml
    const totalFeedingMl = feedingRecords.reduce(
      (sum, r) => sum + (r.amountMl ?? 0),
      0
    );

    // Total sleep minutes: count only the portion of each sleep record that
    // falls within the target day.
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
