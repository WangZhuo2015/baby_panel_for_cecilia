import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");

    const where = date ? { date } : {};

    const plans = await prisma.foodPlan.findMany({
      where,
      orderBy: { date: "desc" },
    });

    const parsed = plans.map((p) => ({
      ...p,
      tags: safeJsonParse(p.tags, []),
      ingredients: safeJsonParse(p.ingredients, []),
      steps: safeJsonParse(p.steps, []),
    }));

    return NextResponse.json(parsed);
  } catch (error) {
    console.error("GET /api/food/plans error:", error);
    return NextResponse.json(
      { error: "Failed to fetch food plans" },
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
