import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireBaby } from "@/lib/api-helpers";
import { getWhoStandard, WHO_MONTHS } from "@/lib/who-growth-standards";

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const { searchParams } = new URL(request.url);
    const requestedBabyId = searchParams.get("babyId");

    const babyResult = await requireBaby(user.id, requestedBabyId);
    if (babyResult.errorResponse) return babyResult.errorResponse;
    const baby = babyResult.baby;

    const measurements = await prisma.growthMeasurement.findMany({
      where: { babyId: baby.id },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
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
