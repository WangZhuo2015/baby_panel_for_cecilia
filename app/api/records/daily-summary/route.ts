import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") ?? new Date().toISOString().split("T")[0];

    // Fetch all records for the given date in parallel
    const [feedingRecords, sleepRecords, diaperRecords, foodLogs] = await Promise.all([
      prisma.feedingRecord.findMany({
        where: { timestamp: { startsWith: date } },
      }),
      prisma.sleepRecord.findMany(),
      prisma.diaperRecord.findMany({
        where: { timestamp: { startsWith: date } },
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

    // Total sleep minutes: filter sleep records that overlap with the given date,
    // then calculate duration from startTime/endTime ISO strings
    let totalSleepMinutes = 0;
    for (const record of sleepRecords) {
      const startDate = record.startTime.substring(0, 10);
      const endDate = record.endTime.substring(0, 10);

      // Include if either start or end falls on the target date
      if (startDate === date || endDate === date) {
        const start = new Date(record.startTime).getTime();
        const end = new Date(record.endTime).getTime();
        const durationMs = end - start;
        if (durationMs > 0) {
          totalSleepMinutes += Math.round(durationMs / 60000);
        }
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
