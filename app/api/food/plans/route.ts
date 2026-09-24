import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireBaby } from "@/lib/api-helpers";
import { safeJsonParse } from "@/lib/json";
import { getLocalDateStr, isValidDateStr } from "@/lib/date";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { verifyBffCsrf } from "@/lib/growdesk/csrf";
import { growdeskFetch } from "@/lib/growdesk/client";
import { BridgeError, bridgeErrorResponse, pathId } from "@/lib/growdesk/bridge-protocol";
import { readPlanEnvelope, listRecipes, createRecipe, appendRecipe } from "@/lib/growdesk/food-plan-history";

export async function GET(request: Request) {
  try {
    if (GROWDESK_CONFIG.enabled) {
      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }
      const { searchParams } = new URL(request.url);
      const babyId = searchParams.get("babyId");
      if (!babyId) {
        return NextResponse.json({ error: "请提供 babyId" }, { status: 400 });
      }
      const res = await growdeskFetch<any>(`/api/v1/babies/${pathId(babyId)}/food-plan`, {
        method: "GET",
        accessToken: bffSession.accessToken,
      });
      if (!res.ok) {
        return NextResponse.json(
          { error: res.error?.message || "Failed to fetch food plan" },
          { status: res.status },
        );
      }
      return NextResponse.json(listRecipes(readPlanEnvelope(res.data, babyId), searchParams));
    }

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

    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10) || 50));

    const plans = await prisma.foodPlan.findMany({
      where,
      orderBy: { date: "desc" },
      take: limit,
    });

    const parsed = plans.map((p) => ({
      ...p,
      tags: safeJsonParse(p.tags, []),
      ingredients: safeJsonParse(p.ingredients, []),
      steps: safeJsonParse(p.steps, []),
    }));

    return NextResponse.json(parsed);
  } catch (error) {
    if (error instanceof BridgeError) return bridgeErrorResponse(error);
    console.error("GET /api/food/plans error:", error);
    return NextResponse.json(
      { error: "Failed to fetch food plans" },
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
      const babyId = body.babyId;
      if (!babyId) {
        return NextResponse.json({ error: "请提供 babyId" }, { status: 400 });
      }

      const existingRes = await growdeskFetch<any>(`/api/v1/babies/${pathId(babyId)}/food-plan`, {
        method: "GET",
        accessToken: bffSession.accessToken,
      });
      // Do not replace a plan after a failed read: supplement state may exist.
      if (!existingRes.ok) return NextResponse.json({ error: existingRes.error?.message || "Failed to fetch food plan" }, { status: existingRes.status });
      const plan = readPlanEnvelope(existingRes.data, babyId);
      const recipe = createRecipe(body, babyId);
      const mergedPlanData = appendRecipe(plan, recipe);

      const res = await growdeskFetch(`/api/v1/babies/${pathId(babyId)}/food-plan`, {
        method: "PUT",
        accessToken: bffSession.accessToken,
        body: {
          planData: mergedPlanData,
          baseVersion: plan.version,
        },
      });

      if (!res.ok) {
        return NextResponse.json(
          { error: res.error?.message || "Failed to save food plan" },
          { status: res.status },
        );
      }

      return NextResponse.json(recipe, { status: 201 });
    }

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
    if (tags.length > 20 || ingredients.length > 20 || steps.length > 20) {
      return NextResponse.json({ error: "tags、ingredients、steps 均不能超过 20 项" }, { status: 400 });
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
    if (error instanceof BridgeError) return bridgeErrorResponse(error);
    console.error("POST /api/food/plans error:", error);
    return NextResponse.json(
      { error: "Failed to create food plan" },
      { status: 500 }
    );
  }
}
