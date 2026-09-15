import { NextResponse } from "next/server";
import { requireAuth, requireBaby } from "@/lib/api-helpers";
import * as records from "@/lib/records/service";
import { ValidationError } from "@/lib/records/service";
import { BridgeError, bridgeErrorResponse } from "@/lib/growdesk/bridge-protocol";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { growdeskFetch } from "@/lib/growdesk/client";
import {
  fromGrowDeskTimelineResponse,
  type GrowDeskTimelineEntry,
  type TimelineEnrichmentContext,
} from "@/lib/growdesk/timeline-compat";
import { fetchLegacyRecordList } from "@/lib/growdesk/record-list";
import { loadWebBaby } from "@/lib/growdesk/bridge-identity";
import { extractSupplementStateFromFoodPlan } from "@/lib/growdesk/nutrition-compat";

export async function GET(request: Request) {
  try {
    if (GROWDESK_CONFIG.enabled) {
      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }
      const { searchParams } = new URL(request.url);
      const babyId = searchParams.get("babyId");
      if (!babyId) return NextResponse.json({ error: "请提供 babyId" }, { status: 400 });
      const list = await fetchLegacyRecordList<GrowDeskTimelineEntry>(growdeskFetch, bffSession.accessToken, babyId, searchParams, "timeline");

      if (list.length === 0) {
        return NextResponse.json([], { headers: { "cache-control": "no-store" } });
      }

      const baby = await loadWebBaby(growdeskFetch, bffSession.accessToken, babyId).catch(() => null);
      const familyId = baby?.familyId;

      const hasFeeding = list.some((e) => e.entityType === "feeding");
      const hasSleep = list.some((e) => e.entityType === "sleep");
      const hasDiaper = list.some((e) => e.entityType === "diaper");
      const hasFood = list.some((e) => e.entityType === "food");
      const hasSupplement = list.some((e) => e.entityType === "supplement");

      const [feedRes, sleepRes, diaperRes, foodRes, suppRes, formulaRes, suppPlanRes, membersRes] = await Promise.allSettled([
        hasFeeding
          ? growdeskFetch<any>(`/api/v1/babies/${babyId}/records/feeding?limit=200`, { accessToken: bffSession.accessToken })
          : Promise.resolve(null),
        hasSleep
          ? growdeskFetch<any>(`/api/v1/babies/${babyId}/records/sleep?limit=200`, { accessToken: bffSession.accessToken })
          : Promise.resolve(null),
        hasDiaper
          ? growdeskFetch<any>(`/api/v1/babies/${babyId}/records/diaper?limit=200`, { accessToken: bffSession.accessToken })
          : Promise.resolve(null),
        hasFood
          ? growdeskFetch<any>(`/api/v1/babies/${babyId}/records/food?limit=200`, { accessToken: bffSession.accessToken })
          : Promise.resolve(null),
        hasSupplement
          ? growdeskFetch<any>(`/api/v1/babies/${babyId}/records/supplement?limit=200`, { accessToken: bffSession.accessToken })
          : Promise.resolve(null),
        familyId && hasFeeding
          ? growdeskFetch<any>(`/api/v1/families/${familyId}/nutrition/products?limit=50`, { accessToken: bffSession.accessToken })
          : Promise.resolve(null),
        hasSupplement
          ? growdeskFetch<any>(`/api/v1/babies/${babyId}/food-plan`, { accessToken: bffSession.accessToken })
          : Promise.resolve(null),
        familyId
          ? growdeskFetch<any>(`/api/v1/families/${familyId}/members`, { accessToken: bffSession.accessToken })
          : Promise.resolve(null),
      ]);

      const toList = (settledResult: PromiseSettledResult<any>) => {
        if (settledResult.status !== "fulfilled" || !settledResult.value?.ok || !settledResult.value.data) return [];
        const d = settledResult.value.data;
        return Array.isArray(d) ? d : (Array.isArray(d.data) ? d.data : []);
      };

      const feedingMap = new Map<string, any>();
      for (const item of toList(feedRes)) {
        if (item?.id) feedingMap.set(item.id, item);
      }

      const sleepMap = new Map<string, any>();
      for (const item of toList(sleepRes)) {
        if (item?.id) sleepMap.set(item.id, item);
      }

      const diaperMap = new Map<string, any>();
      for (const item of toList(diaperRes)) {
        if (item?.id) diaperMap.set(item.id, item);
      }

      const foodMap = new Map<string, any>();
      for (const item of toList(foodRes)) {
        if (item?.id) foodMap.set(item.id, item);
      }

      const supplementMap = new Map<string, any>();
      for (const item of toList(suppRes)) {
        if (item?.id) supplementMap.set(item.id, item);
      }

      const formulaProductsMap = new Map<string, any>();
      for (const item of toList(formulaRes)) {
        if (item?.id) formulaProductsMap.set(item.id, item);
      }

      const supplementProductsMap = new Map<string, any>();
      if (suppPlanRes.status === "fulfilled" && suppPlanRes.value?.ok && suppPlanRes.value.data) {
        const planData = suppPlanRes.value.data.data?.planData || suppPlanRes.value.data.planData || {};
        const suppState = extractSupplementStateFromFoodPlan(planData);
        for (const sp of suppState.supplementProducts || []) {
          if (sp?.id) supplementProductsMap.set(sp.id, sp);
        }
      }

      const memberNames = new Map<string, string>();
      if (membersRes.status === "fulfilled" && membersRes.value?.ok && membersRes.value.data) {
        const membersData = membersRes.value.data.data || membersRes.value.data;
        const members = Array.isArray(membersData) ? membersData : (membersData.members || []);
        for (const m of members) {
          if (m?.userId && m?.displayName) memberNames.set(m.userId, m.displayName);
        }
      }

      const context: TimelineEnrichmentContext = {
        feedings: feedingMap,
        sleeps: sleepMap,
        diapers: diaperMap,
        foods: foodMap,
        supplements: supplementMap,
        formulaProducts: formulaProductsMap,
        supplementProducts: supplementProductsMap,
        memberNames,
      };

      const timelineItems = fromGrowDeskTimelineResponse(list, context);
      return NextResponse.json(timelineItems, { headers: { "cache-control": "no-store" } });
    }
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get("date");
    const babyResult = await requireBaby(auth.user, searchParams.get("babyId"));
    if (babyResult.errorResponse) return babyResult.errorResponse;
    const ctx = { userId: auth.user.id, babyId: babyResult.baby.id, baby: babyResult.baby, familyId: babyResult.family.id };
    const data = await records.getTimeline(ctx, dateParam || undefined);
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof BridgeError) return bridgeErrorResponse(e);
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("GET /api/records/timeline error:", e);
    return NextResponse.json({ error: "Failed to fetch timeline" }, { status: 500 });
  }
}
