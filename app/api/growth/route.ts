import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const measurements = await prisma.growthMeasurement.findMany({
      orderBy: { date: "asc" },
    });

    return NextResponse.json(measurements);
  } catch (error) {
    console.error("GET /api/growth error:", error);
    return NextResponse.json(
      { error: "Failed to fetch growth measurements" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { date, ageLabel, weightKg, heightCm, headCircumferenceCm, percentile } = body;

    const measurement = await prisma.growthMeasurement.create({
      data: {
        date,
        ageLabel,
        weightKg: weightKg ?? null,
        heightCm: heightCm ?? null,
        headCircumferenceCm: headCircumferenceCm ?? null,
        percentile: percentile ?? null,
      },
    });

    return NextResponse.json(measurement, { status: 201 });
  } catch (error) {
    console.error("POST /api/growth error:", error);
    return NextResponse.json(
      { error: "Failed to create growth measurement" },
      { status: 500 }
    );
  }
}
