import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, getActiveBaby } from "@/lib/api-helpers";
import { safeJsonParse } from "@/lib/json";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status"); // tried, to_try, or all

  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const active = await getActiveBaby(user.id);
    const familyId = active.family?.id;

    const foodItems = await prisma.foodItem.findMany({
      orderBy: { recommendedFromMonth: "asc" },
    });

    const familyStatuses = familyId
      ? await prisma.familyFoodStatus.findMany({
          where: { familyId },
        })
      : [];

    const statusMap = new Map(familyStatuses.map((s) => [s.foodId, s]));

    const parsed = foodItems.map((f) => {
      const customStatus = statusMap.get(f.foodId);
      return {
        ...f,
        status: customStatus?.status ?? "to_try",
        firstAddedDate: customStatus?.firstAddedDate ?? null,
        acceptance: customStatus?.acceptance ?? 0,
        preparation: safeJsonParse(f.preparationJson, []),
        nutrition: safeJsonParse(f.nutritionJson, []),
        textureByAge: safeJsonParse(f.textureByAgeJson, []),
        sourceRefs: safeJsonParse(f.sourceRefsJson, []),
      };
    });

    const filtered = status && status !== "all"
      ? parsed.filter((item) => item.status === status)
      : parsed;

    return NextResponse.json(filtered);
  } catch (error) {
    console.error("Error fetching food items:", error);
    return NextResponse.json(
      { error: "Failed to fetch food items" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const active = await getActiveBaby(user.id);
    const familyId = active.family?.id;

    if (!familyId) {
      return NextResponse.json(
        { error: "未找到家庭档案，请先初始化宝宝及家庭信息" },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => ({}));

    if (typeof body.name !== "string" || body.name.trim() === "") {
      return NextResponse.json(
        { error: "name 必填且不能为空" },
        { status: 400 }
      );
    }

    const foodId = body.foodId || `user_${Date.now()}`;

    // Upsert or create food item
    const foodItem = await prisma.foodItem.upsert({
      where: { foodId },
      update: {},
      create: {
        foodId,
        name: body.name.trim(),
        icon: body.icon || "🍽️",
        category: body.category || "other",
        foodGroup: body.foodGroup ?? null,
        recommendedFromMonth: body.recommendedFromMonth ?? null,
        recommendedToMonth: body.recommendedToMonth ?? null,
        exactMonthEvidence: body.exactMonthEvidence ?? false,
        guidance: body.guidance ?? null,
        isCommonAllergen: body.isCommonAllergen ?? null,
        allergenIntroductionGuidance: body.allergenIntroductionGuidance ?? null,
        highRiskInfantNeedsMedicalAdvice: body.highRiskInfantNeedsMedicalAdvice ?? null,
        chokingRisk: body.chokingRisk ?? false,
        chokingNotes: body.chokingNotes ?? null,
        preparationJson: body.preparation ? JSON.stringify(body.preparation) : "[]",
        avoidBeforeMonths: body.avoidBeforeMonths ?? null,
        nutritionJson: body.nutrition ? JSON.stringify(body.nutrition) : "[]",
        textureByAgeJson: body.textureByAge ? JSON.stringify(body.textureByAge) : "[]",
        notes: body.notes ?? null,
        sourceRefsJson: body.sourceRefs ? JSON.stringify(body.sourceRefs) : "[]",
      },
    });

    await prisma.familyFoodStatus.upsert({
      where: {
        familyId_foodId: {
          familyId,
          foodId,
        },
      },
      update: {
        status: body.status === "tried" ? "tried" : "to_try",
        firstAddedDate: body.firstAddedDate ?? null,
        acceptance: typeof body.acceptance === "number" ? body.acceptance : 0,
      },
      create: {
        familyId,
        foodId,
        status: body.status === "tried" ? "tried" : "to_try",
        firstAddedDate: body.firstAddedDate ?? null,
        acceptance: typeof body.acceptance === "number" ? body.acceptance : 0,
      },
    });

    return NextResponse.json(
      {
        ...foodItem,
        status: body.status === "tried" ? "tried" : "to_try",
        firstAddedDate: body.firstAddedDate ?? null,
        acceptance: typeof body.acceptance === "number" ? body.acceptance : 0,
        preparation: safeJsonParse(foodItem.preparationJson, []),
        nutrition: safeJsonParse(foodItem.nutritionJson, []),
        textureByAge: safeJsonParse(foodItem.textureByAgeJson, []),
        sourceRefs: safeJsonParse(foodItem.sourceRefsJson, []),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating food item:", error);
    return NextResponse.json(
      { error: "Failed to create food item" },
      { status: 500 }
    );
  }
}
