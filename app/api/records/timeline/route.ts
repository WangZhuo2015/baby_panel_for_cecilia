import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getLocalDateStr,
  getLocalDayUtcRange,
  formatIsoToLocalTime,
} from "@/lib/date";

const safeJsonParse = (str: string | null | undefined, fallback: any = []) => {
  try { return str ? JSON.parse(str) : fallback } catch { return fallback }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") ?? getLocalDateStr();
    const { start, end } = getLocalDayUtcRange(date);

    const [feedingRecords, sleepRecords, diaperRecords, foodLogs] = await Promise.all([
      prisma.feedingRecord.findMany({
        where: { timestamp: { gte: start, lt: end } },
        orderBy: { timestamp: "desc" },
      }),
      prisma.sleepRecord.findMany({
        where: { startTime: { lt: end }, endTime: { gt: start } },
        orderBy: { startTime: "desc" },
      }),
      prisma.diaperRecord.findMany({
        where: { timestamp: { gte: start, lt: end } },
        orderBy: { timestamp: "desc" },
      }),
      prisma.foodLogRecord.findMany({
        where: { date },
        orderBy: { time: "desc" },
      }),
    ]);

    const typeLabels: Record<string, string> = {
      breast: "母乳",
      formula: "配方奶",
      mixed: "混合喂养",
      night: "夜间睡眠",
      day: "白天小睡",
      pee: "尿",
      poop: "便便",
      both: "尿 + 便",
    };

    const typeIcons: Record<string, string> = {
      breast: "🍼",
      formula: "🍼",
      mixed: "🍼",
      night: "🌙",
      day: "💤",
      pee: "💧",
      poop: "💩",
      both: "💧💩",
      food: "🍽️",
    };

    const timeline: any[] = [];

    for (const r of feedingRecords) {
      const time = formatIsoToLocalTime(r.timestamp);
      timeline.push({
        id: r.id,
        time,
        type: "feeding" as const,
        title: typeLabels[r.type] || "喂奶",
        detail: r.amountMl ? `配方奶 ${r.amountMl}ml` : undefined,
        icon: typeIcons[r.type] || "🍼",
      });
    }

    for (const r of sleepRecords) {
      const start = formatIsoToLocalTime(r.startTime);
      const end = formatIsoToLocalTime(r.endTime);
      const startMs = new Date(r.startTime).getTime();
      const endMs = new Date(r.endTime).getTime();
      const durationMin = Math.round((endMs - startMs) / 60000);
      const h = Math.floor(durationMin / 60);
      const m = durationMin % 60;
      timeline.push({
        id: r.id,
        time: start,
        type: "sleep" as const,
        title: typeLabels[r.type] || "睡觉",
        detail: `${h}h${m}m（${start}–${end}）`,
        icon: typeIcons[r.type] || "🌙",
      });
    }

    for (const r of diaperRecords) {
      const time = formatIsoToLocalTime(r.timestamp);
      timeline.push({
        id: r.id,
        time,
        type: "diaper" as const,
        title: "尿布",
        detail: typeLabels[r.type] || undefined,
        icon: typeIcons[r.type] || "💧",
      });
    }

    for (const r of foodLogs) {
      const foods = safeJsonParse(r.foods);
      timeline.push({
        id: r.id,
        time: r.time,
        type: "food" as const,
        title: "辅食",
        detail: foods.length > 0 ? foods.join("、") : undefined,
        icon: "🍽️",
      });
    }

    // Sort by time descending (HH:MM strings sort correctly)
    timeline.sort((a, b) => b.time.localeCompare(a.time));

    return NextResponse.json(timeline);
  } catch (error) {
    console.error("GET /api/records/timeline error:", error);
    return NextResponse.json(
      { error: "Failed to fetch timeline" },
      { status: 500 }
    );
  }
}
