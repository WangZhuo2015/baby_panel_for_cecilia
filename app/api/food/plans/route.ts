import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireBaby } from "@/lib/api-helpers";
import { safeJsonParse } from "@/lib/json";
import { getLocalDateStr, isValidDateStr } from "@/lib/date";

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

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const body = await request.json().catch(() => ({}));
    const {
      babyId: reqBabyId,
      date,
      name,
      tags = [],
      nutrition = "营养均衡",
      ingredients = [],
      steps = [],
    } = body;

    if (date !== undefined && (typeof date !== "string" || !isValidDateStr(date.trim()))) {
      return NextResponse.json({ error: "date 必须是有效的 YYYY-MM-DD 日期" }, { status: 400 });
    }
    if (typeof name !== "string" || !name.trim() || name.trim().length > 100) {
      return NextResponse.json({ error: "name 必须为 1-100 个字符" }, { status: 400 });
    }
    const isStringArray = (value: unknown): value is string[] =>
      Array.isArray(value) &&
      value.every((item) => typeof item === "string" && item.trim().length > 0 && item.length <= 500);
    if (!isStringArray(tags) || !isStringArray(ingredients) || !isStringArray(steps)) {
      return NextResponse.json({ error: "tags、ingredients、steps 必须为非空字符串数组" }, { status: 400 });
    }
    if (typeof nutrition !== "string" || nutrition.trim().length > 500) {
      return NextResponse.json({ error: "nutrition 必须为不超过 500 个字符的文本" }, { status: 400 });
    }

    const babyResult = await requireBaby(user.id, reqBabyId);
    if (babyResult.errorResponse) return babyResult.errorResponse;
    const babyId = babyResult.baby.id;

    const validDate = typeof date === "string" ? date.trim() : getLocalDateStr();

    const plan = await prisma.foodPlan.create({
      data: {
        babyId,
        date: validDate,
        name: name.trim(),
        tags: JSON.stringify(tags.map((tag) => tag.trim())),
        nutrition: nutrition.trim(),
        ingredients: JSON.stringify(ingredients.map((item) => item.trim())),
        steps: JSON.stringify(steps.map((item) => item.trim())),
      },
    });

    return NextResponse.json({
      ...plan,
      tags: safeJsonParse(plan.tags, []),
      ingredients: safeJsonParse(plan.ingredients, []),
      steps: safeJsonParse(plan.steps, []),
    });
  } catch (error) {
    console.error("POST /api/food/plans error:", error);
    return NextResponse.json(
      { error: "Failed to create food plan" },
      { status: 500 }
    );
  }
}
