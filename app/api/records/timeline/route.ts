import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getLocalDateStr,
  getLocalDayUtcRange,
  formatIsoToLocalTime,
} from "@/lib/date";
import { requireAuth, requireBaby } from "@/lib/api-helpers";
import { safeJsonParse } from "@/lib/json";

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") ?? getLocalDateStr();
    const requestedBabyId = searchParams.get("babyId");

    const babyResult = await requireBaby(user.id, requestedBabyId);
    if (babyResult.errorResponse) return babyResult.errorResponse;
    const babyId = babyResult.baby.id;

    const { start, end } = getLocalDayUtcRange(date);

    const feedingWhere: any = { babyId, timestamp: { gte: start, lt: end } };
    const sleepWhere: any = { babyId, startTime: { lt: end }, endTime: { gt: start } };
    const diaperWhere: any = { babyId, timestamp: { gte: start, lt: end } };
    const foodWhere: any = { babyId, date };

    const [feedingRecords, sleepRecords, diaperRecords, foodLogs] = await Promise.all([
      prisma.feedingRecord.findMany({
        where: feedingWhere,
        orderBy: { timestamp: "desc" },
      }),
      prisma.sleepRecord.findMany({
        where: sleepWhere,
        orderBy: { startTime: "desc" },
      }),
      prisma.diaperRecord.findMany({
        where: diaperWhere,
        orderBy: { timestamp: "desc" },
      }),
      prisma.foodLogRecord.findMany({
        where: foodWhere,
        orderBy: { time: "desc" },
      }),
    ]);

    const typeLabels: Record<string, string> = {
      breast: "母乳亲喂",
      formula: "配方奶",
      bottle_breast: "瓶喂母乳",
      mixed: "混合喂养",
      solid: "辅食餐点",
      night: "夜间睡眠",
      day: "白天小睡",
      pee: "嘘嘘 (尿)",
      poop: "便便",
      both: "嘘嘘 + 便便",
    };

    const typeIcons: Record<string, string> = {
      breast: "🤱",
      formula: "🍼",
      bottle_breast: "🍼",
      mixed: "🍼",
      solid: "🥣",
      night: "🌙",
      day: "💤",
      pee: "💧",
      poop: "💩",
      both: "💧💩",
      food: "🍽️",
    };

    const timeline: any[] = [];
    const dayStartMs = new Date(start).getTime();

    for (const r of feedingRecords) {

      const time = formatIsoToLocalTime(r.timestamp);
      let detail = "";
      if (r.amountMl) {
        detail += `${r.amountMl}ml`;
      }
      if (r.leftMinutes || r.rightMinutes) {
        const sides = [];
        if (r.leftMinutes) sides.push(`左${r.leftMinutes}分`);
        if (r.rightMinutes) sides.push(`右${r.rightMinutes}分`);
        detail += detail ? ` (${sides.join("+")})` : sides.join("+");
      }
      if (r.spitUp) {
        detail += detail ? " · 吐奶" : "吐奶";
      }
      if (r.notes) {
        detail += detail ? ` · ${r.notes}` : r.notes;
      }

      timeline.push({
        id: r.id,
        time,
        sortMs: new Date(r.timestamp).getTime(),
        type: "feeding" as const,
        title: typeLabels[r.type] || "喂奶",
        detail: detail || undefined,
        icon: typeIcons[r.type] || "🍼",
      });
    }

    for (const r of sleepRecords) {
      const startStr = formatIsoToLocalTime(r.startTime);
      const endStr = formatIsoToLocalTime(r.endTime);
      const startMs = new Date(r.startTime).getTime();
      const endMs = new Date(r.endTime).getTime();
      const isOvernight = startMs < dayStartMs;
      const durationMin = Math.round((endMs - startMs) / 60000);
      const h = Math.floor(durationMin / 60);
      const m = durationMin % 60;
      const durationText = h > 0 ? `${h}小时${m > 0 ? `${m}分` : ""}` : `${m}分钟`;
      let detail = `${durationText}（${startStr}–${endStr}）`;
      if (r.nightWakingCount > 0) {
        detail += ` · 夜醒 ${r.nightWakingCount}次`;
      }
      if (r.notes) {
        detail += ` · ${r.notes}`;
      }

      timeline.push({
        id: r.id,
        time: isOvernight ? "00:00" : startStr,
        sortMs: isOvernight ? dayStartMs : startMs,
        type: "sleep" as const,
        title: isOvernight ? "跨夜睡眠 (接昨日)" : (typeLabels[r.type] || "睡觉"),
        detail,
        icon: typeIcons[r.type] || "🌙",
      });
    }

    for (const r of diaperRecords) {
      const time = formatIsoToLocalTime(r.timestamp);
      let detail = typeLabels[r.type] || "";
      if (r.poopColor) {
        const colorMap: Record<string, string> = { yellow: "黄色", green: "绿色", brown: "棕色", other: "其他" };
        detail += ` · ${colorMap[r.poopColor] || r.poopColor}`;
      }
      if (r.poopConsistency) {
        const consMap: Record<string, string> = { loose: "稀便", paste: "糊状", formed: "成形" };
        detail += ` · ${consMap[r.poopConsistency] || r.poopConsistency}`;
      }
      if (r.notes) {
        detail += ` · ${r.notes}`;
      }

      timeline.push({
        id: r.id,
        time,
        sortMs: new Date(r.timestamp).getTime(),
        type: "diaper" as const,
        title: "换尿布",
        detail: detail || undefined,
        icon: typeIcons[r.type] || "💧",
      });
    }

    for (const r of foodLogs) {
      const foods = safeJsonParse<string[]>(r.foods, []);
      const foodMs = new Date(`${date}T${(r.time || "12:00").padStart(5, "0")}:00+08:00`).getTime();
      timeline.push({
        id: r.id,
        time: r.time,
        sortMs: Number.isNaN(foodMs) ? dayStartMs : foodMs,
        type: "food" as const,
        title: "辅食餐点",
        detail: Array.isArray(foods) && foods.length > 0 ? foods.join("、") : undefined,
        icon: "🥣",
      });
    }

    timeline.sort((a: any, b: any) => (b.sortMs ?? 0) - (a.sortMs ?? 0));
    const responseList = timeline.map(({ sortMs: _sortMs, ...rest }: any) => rest);
    return NextResponse.json(responseList);

  } catch (error) {
    console.error("GET /api/records/timeline error:", error);
    return NextResponse.json(
      { error: "Failed to fetch timeline" },
      { status: 500 }
    );
  }
}
