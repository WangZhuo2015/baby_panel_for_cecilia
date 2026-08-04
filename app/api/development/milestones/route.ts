import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category");
    const month = searchParams.get("month");

    const where: Record<string, unknown> = {};
    if (category) where.category = category;
    if (month) where.month = parseInt(month, 10);

    const milestones = await prisma.developmentMilestone.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      orderBy: { month: "asc" },
    });

    return NextResponse.json(milestones);
  } catch (error) {
    console.error("GET /api/development/milestones error:", error);
    return NextResponse.json(
      { error: "Failed to fetch milestones" },
      { status: 500 }
    );
  }
}
