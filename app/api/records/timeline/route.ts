import { NextResponse } from "next/server";
import { requireAuth, requireBaby } from "@/lib/api-helpers";
import * as records from "@/lib/records/service";
import { ValidationError } from "@/lib/records/service";
import { BridgeError, bridgeErrorResponse, pathId, requireData } from "@/lib/growdesk/bridge-protocol";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { growdeskFetch } from "@/lib/growdesk/client";
import {
  fromGrowDeskTimelineResponse,
  type GrowDeskTimelineEntry,
  type TimelineEnrichmentContext,
} from "@/lib/growdesk/timeline-compat";
import { fetchTimelineDetailMaps } from "@/lib/growdesk/timeline-details";
import { fetchNativeTimelineDetailMaps } from "@/lib/growdesk/native-timeline-details";
import { fetchNativeTimelineSupplementProducts } from "@/lib/growdesk/native-timeline-products";
import { familyDayBounds, fetchLegacyRecordList } from "@/lib/growdesk/record-list";
import { fetchCompleteList } from "@/lib/growdesk/paged-list";
import { getLocalDateStr } from "@/lib/date";
import { loadWebBaby } from "@/lib/growdesk/bridge-identity";
import { extractSupplementStateFromFoodPlan } from "@/lib/growdesk/nutrition-compat";
import { projectLegacyTimelineResponse, wantsExtendedRepresentation } from "@/lib/growdesk/legacy-projections";

function objectData(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", "GrowDesk 返回了无效的时间线补充数据");
  }
  return value as Record<string, unknown>;
}

async function listData(path: string, accessToken: string): Promise<Record<string, unknown>[]> {
  const data = requireData(await growdeskFetch<unknown>(path, { accessToken }));
  if (!Array.isArray(data)) {
    throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", "GrowDesk 未返回有效的列表");
  }
  return data.map(objectData);
}

async function supplementPlanData(babyId: string, accessToken: string): Promise<Record<string, unknown>> {
  const response = await growdeskFetch<unknown>(`/api/v1/babies/${pathId(babyId)}/food-plan`, { accessToken });
  // Retained only for the pre-existing TypeScript compatibility mode.
  if (!response.ok && response.status === 404) return {};
  const plan = objectData(requireData(response));
  return plan.planData === null || plan.planData === undefined ? {} : objectData(plan.planData);
}

async function supplementProductsData(babyId: string, familyId: string, accessToken: string): Promise<Map<string, Record<string, unknown>>> {
  if (GROWDESK_CONFIG.usesGoBackend) {
    return fetchNativeTimelineSupplementProducts(growdeskFetch, accessToken, familyId);
  }
  const result = new Map<string, Record<string, unknown>>();
  const state = extractSupplementStateFromFoodPlan(await supplementPlanData(babyId, accessToken));
  for (const product of state.supplementProducts || []) {
    const item = objectData(product);
    if (typeof item.id !== "string" || !item.id) {
      throw new BridgeError(502, "UPSTREAM_INVALID_RECORD", "GrowDesk 返回了无效的补剂档案");
    }
    result.set(item.id, item);
  }
  return result;
}

export async function GET(request: Request) {
  try {
    if (GROWDESK_CONFIG.enabled) {
      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }
      const { searchParams } = new URL(request.url);
      const extended = wantsExtendedRepresentation(request);
      const babyId = searchParams.get("babyId");
      if (!babyId) return NextResponse.json({ error: "请提供 babyId" }, { status: 400 });
      const token = bffSession.accessToken;
      // Preserve the public default day and family-local interval semantics.
      if (!searchParams.get("date")) searchParams.set("date", getLocalDateStr());
      const list = await fetchLegacyRecordList<GrowDeskTimelineEntry>(growdeskFetch, token, babyId, searchParams, "timeline");
      if (list.length === 0) {
        return NextResponse.json([], { headers: { "cache-control": "no-store" } });
      }
      const dateParam = searchParams.get("date");
      const dayBounds = dateParam
        ? await familyDayBounds(growdeskFetch, token, babyId, dateParam)
        : undefined;
      const baby = await loadWebBaby(growdeskFetch, token, babyId);
      if (!baby?.familyId) {
        throw new BridgeError(502, "UPSTREAM_INVALID_RECORD", "GrowDesk 未返回宝宝所属家庭");
      }
      const familyPath = `/api/v1/families/${pathId(baby.familyId)}`;
      const hasFeeding = list.some(entry => entry.entityType === "feeding");
      const hasSupplement = list.some(entry => entry.entityType === "supplement");
      const [details, formulaProducts, supplementProducts, members] = await Promise.all([
        GROWDESK_CONFIG.usesGoBackend
          ? fetchNativeTimelineDetailMaps(growdeskFetch, token, babyId, baby.familyId, list)
          : fetchTimelineDetailMaps(growdeskFetch, token, babyId, list),
        hasFeeding ? fetchCompleteList<Record<string, unknown>>(growdeskFetch, token, `${familyPath}/nutrition/products?includeArchived=true`) : Promise.resolve([]),
        hasSupplement ? supplementProductsData(babyId, baby.familyId, token) : Promise.resolve(new Map<string, Record<string, unknown>>()),
        listData(`${familyPath}/members`, token),
      ]);
      const formulaProductsMap = new Map<string, Record<string, unknown>>();
      for (const product of formulaProducts) {
        if (typeof product.id !== "string" || !product.id) {
          throw new BridgeError(502, "UPSTREAM_INVALID_RECORD", "GrowDesk 返回了无效的奶粉档案");
        }
        formulaProductsMap.set(product.id, product);
      }
      const memberNames = new Map<string, string>();
      for (const member of members) {
        if (typeof member.userId !== "string" || typeof member.displayName !== "string") {
          throw new BridgeError(502, "UPSTREAM_INVALID_RECORD", "GrowDesk 返回了无效的家庭成员资料");
        }
        memberNames.set(member.userId, member.displayName);
      }
      const context: TimelineEnrichmentContext = {
        ...details,
        formulaProducts: formulaProductsMap,
        supplementProducts,
        memberNames,
        dayStartMs: dayBounds?.start.getTime(),
      };
      const mapped = fromGrowDeskTimelineResponse(list, context);
      return NextResponse.json(extended ? mapped : projectLegacyTimelineResponse(mapped), {
        headers: { "cache-control": "no-store" },
      });
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
