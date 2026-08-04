import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// WHO percentile reference data for girls (simplified)
const whoPercentiles = {
  weight: {
    P97: [2.8, 4.2, 5.1, 5.8, 6.4, 6.9, 7.3, 7.7, 8.1, 8.5, 8.9],
    P85: [2.6, 3.9, 4.7, 5.3, 5.8, 6.3, 6.7, 7.1, 7.4, 7.8, 8.1],
    P50: [2.2, 3.3, 4.0, 4.5, 5.0, 5.4, 5.8, 6.1, 6.4, 6.7, 7.0],
    P15: [1.9, 2.8, 3.4, 3.8, 4.2, 4.5, 4.8, 5.1, 5.4, 5.6, 5.9],
    P3:  [1.6, 2.4, 2.9, 3.3, 3.6, 3.9, 4.2, 4.4, 4.7, 4.9, 5.1],
  },
};

const monthLabels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export async function GET() {
  try {
    const measurements = await prisma.growthMeasurement.findMany({
      orderBy: { date: "asc" },
    });

    return NextResponse.json({
      measurements,
      whoPercentiles,
      monthLabels,
    });
  } catch (error) {
    console.error("GET /api/growth/chart error:", error);
    return NextResponse.json(
      { error: "Failed to fetch chart data" },
      { status: 500 }
    );
  }
}
