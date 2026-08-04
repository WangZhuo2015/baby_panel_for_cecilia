import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const activities = await prisma.activityRecommendation.findMany();

    // Parse JSON strings to arrays
    const parsed = activities.map((a) => ({
      ...a,
      materials: safeJsonParse(a.materials, []),
      steps: safeJsonParse(a.steps, []),
    }));

    return NextResponse.json(parsed);
  } catch (error) {
    console.error("GET /api/development/activities error:", error);
    return NextResponse.json(
      { error: "Failed to fetch activity recommendations" },
      { status: 500 }
    );
  }
}

function safeJsonParse<T>(str: string, fallback: T): T {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}
