import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireBaby } from "@/lib/api-helpers";
import { safeJsonParse } from "@/lib/json";
import { isValidDateStr } from "@/lib/date";

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");
    const requestedBabyId = searchParams.get("babyId");

    const babyResult = await requireBaby(user.id, requestedBabyId);
    if (babyResult.errorResponse) return babyResult.errorResponse;
    const babyId = babyResult.baby.id;

    const where: any = { babyId };
    if (date) {
      if (!isValidDateStr(date)) {
        return NextResponse.json({ error: "Invalid date format, expected YYYY-MM-DD" }, { status: 400 });
      }
      where.date = date;
    }


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
