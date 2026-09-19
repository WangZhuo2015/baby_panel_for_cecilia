import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, getActiveBaby } from "@/lib/api-helpers";
import { safeJsonParse } from "@/lib/json";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { verifyBffCsrf } from "@/lib/growdesk/csrf";
import { growdeskFetch } from "@/lib/growdesk/client";
import { compareLegacyFoodItems, fromGrowDeskFoodLibraryItem } from "@/lib/growdesk/food-library-compat";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status"); // tried, to_try, or all
  const requestedFamilyId = searchParams.get("familyId");

  try {
    if (GROWDESK_CONFIG.enabled) {
      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }
      const upstreamQuery = requestedFamilyId ? `?familyId=${encodeURIComponent(requestedFamilyId)}` : "";
      const res = await growdeskFetch<any[]>(`/api/v1/food/items${upstreamQuery}`, {
        method: "GET",
        accessToken: bffSession.accessToken,
      });
      if (!res.ok) {
        return NextResponse.json(
          { error: res.error?.message || "Failed to fetch food items" },
          { status: res.status },
        );
      }
      const rawList = Array.isArray(res.data) ? res.data : (res.data as any)?.data || [];
      const parsedList = rawList.map(fromGrowDeskFoodLibraryItem).sort(compareLegacyFoodItems);
      const filtered = status && status !== "all"
        ? parsedList.filter((item: any) => item.status === status)
        : parsedList;
      return NextResponse.json(filtered);
    }

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
    if (GROWDESK_CONFIG.enabled) {
      const csrfErr = verifyBffCsrf(request);
      if (csrfErr) return csrfErr;

      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }

      const body = await request.json().catch(() => ({}));
      const familyId = typeof body.familyId === "string" && body.familyId.trim()
        ? body.familyId.trim()
        : undefined;
      const res = await growdeskFetch("/api/v1/food/items", {
        method: "POST",
        accessToken: bffSession.accessToken,
        body: {
          ...(familyId ? { familyId } : {}),
          name: body.name,
          category: body.category || "other",
          recommendedAgeMonths: Number(body.recommendedFromMonth ?? 6),
          // Legacy allergen lists have no severity: conservatively map nonempty
          // lists to high; absent/empty lists to low. Explicit valid risk wins.
          allergenRisk: ["low", "medium", "high"].includes(body.allergenRisk)
            ? body.allergenRisk : (Array.isArray(body.allergens) && body.allergens.length > 0 ? "high" : "low"),
          // Legacy "create as tried" flows mark the new item tried immediately.
          ...(body.status === "tried" ? { tried: true } : {}),
        },
      });

      if (!res.ok) {
        return NextResponse.json(
          { error: res.error?.message || "Failed to create food item" },
          { status: res.status },
        );
      }

      return NextResponse.json(res.data, { status: 201 });
    }

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

    // Enforce isolated custom foodId namespace; system foodIds require admin
    let foodId: string;
    if (typeof body.foodId === "string" && body.foodId.trim() !== "") {
      const requested = body.foodId.trim();
      // user_ prefix is isolated namespace; otherwise require admin
      if (!requested.startsWith("user_")) {
        const membership = await prisma.familyMember.findFirst({
          where: { familyId, userId: user.id },
          select: { role: true },
        });
        if (membership?.role !== "admin") {
          return NextResponse.json(
            { error: "仅管理员可创建或覆盖系统食材，普通成员仅可创建自定义食材" },
            { status: 403 }
          );
        }
        // admin may specify system id, but prevent overwrite via upsert update:{}
        foodId = requested;
      } else {
        // Ensure user_ id is scoped to current user to avoid cross-user collision
        foodId = requested.startsWith(`user_${user.id}_`) ? requested : `user_${user.id}_${Date.now()}`;
      }
    } else {
      foodId = `user_${user.id}_${Date.now()}`;
    }

    // Upsert or create food item
    const foodItem = await prisma.foodItem.upsert({
      where: { foodId },
      update: {},
      create: {
        foodId,
        name: body.name.trim().slice(0, 100),
        icon: body.icon || "🍽️",
        category: body.category || "other",
        foodGroup: body.foodGroup ?? null,
        recommendedFromMonth: body.recommendedFromMonth ?? null,
        recommendedToMonth: body.recommendedToMonth ?? null,
        exactMonthEvidence: body.exactMonthEvidence ?? false,
        guidance: body.guidance ? String(body.guidance).slice(0, 2000) : null,
        isCommonAllergen: body.isCommonAllergen ?? null,
        allergenIntroductionGuidance: body.allergenIntroductionGuidance ?? null,
        highRiskInfantNeedsMedicalAdvice: body.highRiskInfantNeedsMedicalAdvice ?? null,
        chokingRisk: body.chokingRisk ?? false,
        chokingNotes: body.chokingNotes ? String(body.chokingNotes).slice(0, 1000) : null,
        preparationJson: body.preparation ? JSON.stringify(body.preparation).slice(0, 10000) : "[]",
        avoidBeforeMonths: body.avoidBeforeMonths ?? null,
        nutritionJson: body.nutrition ? JSON.stringify(body.nutrition).slice(0, 10000) : "[]",
        textureByAgeJson: body.textureByAge ? JSON.stringify(body.textureByAge).slice(0, 10000) : "[]",
        notes: body.notes ? String(body.notes).slice(0, 2000) : null,
        sourceRefsJson: body.sourceRefs ? JSON.stringify(body.sourceRefs).slice(0, 10000) : "[]",
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
