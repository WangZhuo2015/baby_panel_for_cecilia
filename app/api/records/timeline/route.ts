import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getLocalDateStr,
  getLocalDayUtcRange,
  formatIsoToLocalTime,
} from "@/lib/date";
import { getAuthSession, getActiveBabyForUser } from "@/lib/auth";

const safeJsonParse = (str: string | null | undefined, fallback: any = []) => {
  try { return str ? JSON.parse(str) : fallback } catch { return fallback }
}

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

    for (const r of feedingRecords) {
      const time = formatIsoToLocalTime(r.timestamp);
      let detail = "";
      if (r.type === "breast") {
        detail = `左侧 ${r.leftMinutes || 0}分 · 右侧 ${r.rightMinutes || 0}分`;
      } else if (r.type === "formula") {
        detail = `配方奶 ${r.amountMl || 0}ml`;
      } else if (r.type === "bottle_breast") {
        detail = `瓶喂母乳 ${r.amountMl || 0}ml`;
      } else if (r.type === "mixed") {
        detail = `亲喂 ${(r.leftMinutes || 0) + (r.rightMinutes || 0)}分 + 奶粉 ${r.amountMl || 0}ml`;
      } else if (r.type === "solid") {
        detail = r.notes || "辅食";
      }

      if (r.spitUp) {
        detail += detail ? " · 吐奶 ⚠️" : "吐奶 ⚠️";
      }
      if (r.notes && r.type !== "solid") {
        detail += ` (${r.notes})`;
      }

      timeline.push({
        id: r.id,
        time,
        type: "feeding" as const,
        title: typeLabels[r.type] || "喂奶",
        detail: detail || undefined,
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
      const durationText = h > 0 ? `${h}小时${m > 0 ? `${m}分` : ""}` : `${m}分钟`;
      let detail = `${durationText}（${start}–${end}）`;
      if (r.nightWakingCount > 0) {
        detail += ` · 夜醒 ${r.nightWakingCount}次`;
      }
      if (r.notes) {
        detail += ` · ${r.notes}`;
      }

      timeline.push({
        id: r.id,
        time: start,
        type: "sleep" as const,
        title: typeLabels[r.type] || "睡觉",
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
        type: "diaper" as const,
        title: "换尿布",
        detail: detail || undefined,
        icon: typeIcons[r.type] || "💧",
      });
    }

    for (const r of foodLogs) {
      const foods = safeJsonParse(r.foods);
      timeline.push({
        id: r.id,
        time: r.time,
        type: "food" as const,
        title: "辅食餐点",
        detail: foods.length > 0 ? foods.join("、") : undefined,
        icon: "🥣",
      });
    }

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
