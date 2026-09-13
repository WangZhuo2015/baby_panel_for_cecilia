import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireBaby } from "@/lib/api-helpers";
import { getWhoStandard, WHO_MONTHS } from "@/lib/who-growth-standards";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { growdeskFetch } from "@/lib/growdesk/client";

export async function GET(request: Request) {
  try {
    if (GROWDESK_CONFIG.enabled) {
      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }
      const { searchParams } = new URL(request.url);
      const requestedBabyId = searchParams.get("babyId");
      if (!requestedBabyId) {
        return NextResponse.json({ error: "请提供 babyId" }, { status: 400 });
      }

      const res = await growdeskFetch<any>(
        `/api/v1/babies/${requestedBabyId}/growth-chart`,
        {
          method: "GET",
          accessToken: bffSession.accessToken,
        },
      );

      if (!res.ok) {
        return NextResponse.json(
          { error: res.error?.message || "Failed to fetch growth chart data" },
          { status: res.status },
        );
      }

      return NextResponse.json(res.data?.data || res.data);
    }

    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const { searchParams } = new URL(request.url);
    const requestedBabyId = searchParams.get("babyId");

    const babyResult = await requireBaby(user.id, requestedBabyId);
    if (babyResult.errorResponse) return babyResult.errorResponse;
    const baby = babyResult.baby;

    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10) || 50));

    const measurements = await prisma.growthMeasurement.findMany({
      where: { babyId: baby.id },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: limit,
    });

    const gender = baby.gender || "female";
    const whoStandards = getWhoStandard(gender);

    return NextResponse.json({
      measurements,
      whoPercentiles: whoStandards,
      monthLabels: WHO_MONTHS,
      gender,
    });
  } catch (error) {
    console.error("GET /api/growth/chart error:", error);
    return NextResponse.json(
      { error: "Failed to fetch chart data" },
      { status: 500 }
    );
  }
}
