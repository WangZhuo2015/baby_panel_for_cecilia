import { NextResponse } from "next/server";
import { requireAuth, requireBaby } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { growdeskFetch } from "@/lib/growdesk/client";
import { assertExpectedActor, requireNutritionBaby } from "@/lib/growdesk/nutrition-scope";
import { BridgeError, bridgeErrorResponse } from "@/lib/growdesk/bridge-protocol";
import { dayBoundsInTimeZone, familyTimeZone, fetchLegacyRecordList } from "@/lib/growdesk/record-list";
import { fromGrowDeskFeedingRecord, type GrowDeskFeedingRecord } from "@/lib/growdesk/feeding-compat";
import { type GrowDeskSleepRecord } from "@/lib/growdesk/sleep-compat";
import { type GrowDeskDiaperRecord } from "@/lib/growdesk/diaper-compat";
import { type GrowDeskFoodRecord } from "@/lib/growdesk/food-compat";
import { aggregateCareTrends, dateInTimeZone } from "@/lib/care-trends";
import { addDays, isValidDateStr } from "@/lib/date";

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const rawDays = query.get("days") ?? "7";
    if (rawDays !== "7" && rawDays !== "30") return NextResponse.json({ error: "仅支持 7 天或 30 天" }, { status: 400 });
    const days = Number(rawDays) as 7 | 30;
    const requested = query.get("babyId");
    if (!requested) return NextResponse.json({ error: "请选择宝宝" }, { status: 400 });
    const range = (timeZone: string) => {
      const today = dateInTimeZone(new Date(), timeZone);
      const endDate = query.get("endDate") || today;
      if (!isValidDateStr(endDate) || endDate > today) throw new BridgeError(400, "INVALID_DATE", "结束日期必须为有效的非未来日期");
      return { timeZone, endDate, days };
    };
    let result;
    if (GROWDESK_CONFIG.enabled) {
      const session = await resolveBffSession(request);
      if (!session) return NextResponse.json({ error: "请重新登录" }, { status: 401 });
      assertExpectedActor(request, session.user.id);
      const baby = await requireNutritionBaby(growdeskFetch, session.accessToken, { babyId: requested, familyId: query.get("familyId") });
      if (!baby) return NextResponse.json({ error: "未找到宝宝" }, { status: 404 });
      const period = range(await familyTimeZone(growdeskFetch, session.accessToken, baby.id));
      // Each history is scanned once, never once per chart day. Pagination fails closed.
      const [feeding, sleep, diaper, food] = await Promise.all([
        fetchLegacyRecordList<GrowDeskFeedingRecord>(growdeskFetch, session.accessToken, baby.id, new URLSearchParams(), "feeding"),
        fetchLegacyRecordList<GrowDeskSleepRecord>(growdeskFetch, session.accessToken, baby.id, new URLSearchParams(), "sleep"),
        fetchLegacyRecordList<GrowDeskDiaperRecord>(growdeskFetch, session.accessToken, baby.id, new URLSearchParams(), "diaper"),
        fetchLegacyRecordList<GrowDeskFoodRecord>(growdeskFetch, session.accessToken, baby.id, new URLSearchParams(), "food"),
      ]);
      result = aggregateCareTrends({ ...period, babyId: baby.id,
        feeding: feeding.map(fromGrowDeskFeedingRecord),
        sleep: sleep.map(r => ({ startTime: r.startedAt, endTime: r.endedAt })),
        diaper: diaper.map(r => ({ timestamp: r.occurredAt })),
        food: food.map(r => ({ date: r.recordDate })),
      });
    } else {
      const auth = await requireAuth(request);
      if (auth.errorResponse) return auth.errorResponse;
      assertExpectedActor(request, auth.user.id);
      const selected = await requireBaby(auth.user.id, requested);
      if (selected.errorResponse) return selected.errorResponse;
      const babyId = selected.baby.id;
      const period = range("Asia/Shanghai");
      const start = dayBoundsInTimeZone(addDays(period.endDate, 1 - days), period.timeZone).start.toISOString();
      const end = dayBoundsInTimeZone(period.endDate, period.timeZone).end.toISOString();
      const [feeding, sleep, diaper, food] = await Promise.all([
        prisma.feedingRecord.findMany({ where: { babyId, timestamp: { gte: start, lt: end } } }),
        prisma.sleepRecord.findMany({ where: { babyId, startTime: { lt: end }, endTime: { gt: start } } }),
        prisma.diaperRecord.findMany({ where: { babyId, timestamp: { gte: start, lt: end } } }),
        prisma.foodLogRecord.findMany({ where: { babyId, date: { gte: addDays(period.endDate, 1 - days), lte: period.endDate } } }),
      ]);
      result = aggregateCareTrends({ ...period, babyId, feeding, sleep, diaper, food });
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof BridgeError) return bridgeErrorResponse(error);
    console.error("Care trends failed:", error);
    return NextResponse.json({ error: "趋势数据暂时无法读取，请重试" }, { status: 500 });
  }
}
