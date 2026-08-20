import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthSession, getActiveBabyForUser } from "@/lib/auth";
import { getWhoStandard, WHO_MONTHS } from "@/lib/who-growth-standards";

export async function GET(request: Request) {
  try {
    const user = await getAuthSession(request);
    let babyId: string | undefined;
    let gender = "female";

    if (user) {
      const active = await getActiveBabyForUser(user.id);
      if (active?.baby) {
        babyId = active.baby.id;
        gender = active.baby.gender;
      }
    }

    const { searchParams } = new URL(request.url);
    const requestedBabyId = searchParams.get("babyId") || babyId;

    const measurements = requestedBabyId
      ? await prisma.growthMeasurement.findMany({
          where: { babyId: requestedBabyId },
          orderBy: { date: "asc" },
        })
      : await prisma.growthMeasurement.findMany({
          orderBy: { date: "asc" },
        });

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
