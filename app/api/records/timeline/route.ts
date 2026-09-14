import { NextResponse } from "next/server";
import { requireAuth, requireBaby } from "@/lib/api-helpers";
import * as records from "@/lib/records/service";
import { ValidationError } from "@/lib/records/service";
import { BridgeError, bridgeErrorResponse } from "@/lib/growdesk/bridge-protocol";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { growdeskFetch } from "@/lib/growdesk/client";
import { fromGrowDeskTimelineResponse, type GrowDeskTimelineEntry } from "@/lib/growdesk/timeline-compat";
import { fetchLegacyRecordList } from "@/lib/growdesk/record-list";

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
      return NextResponse.json(fromGrowDeskTimelineResponse(list), { headers: { "cache-control": "no-store" } });
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
