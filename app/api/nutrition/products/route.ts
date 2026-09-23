import { NextResponse } from "next/server";
import { requireAuth, requireBaby, getActiveBaby } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { PRESET_FORMULA_PRODUCTS, PRESET_SUPPLEMENT_PRODUCTS } from "@/lib/nutrition/presets";
import type { FormulaProduct, SupplementProduct, NutrientsMap } from "@/types/nutrition";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { verifyBffCsrf } from "@/lib/growdesk/csrf";
import { growdeskFetch } from "@/lib/growdesk/client";
import { loadWebBaby, loadWebIdentity } from "@/lib/growdesk/bridge-identity";
import { BridgeError, bridgeErrorResponse, requireData } from "@/lib/growdesk/bridge-protocol";
import { foodPlanWriteBody, readGrowDeskFoodPlan, type GrowDeskFoodPlanState } from "@/lib/growdesk/food-plan-state";
import { fetchCompleteList } from "@/lib/growdesk/paged-list";
import {
  fromGrowDeskFormulaProduct,
  toGrowDeskFormulaCreatePayload,
  toGrowDeskFormulaUpdatePayload,
  extractSupplementStateFromFoodPlan,
  mergeSupplementStateIntoFoodPlan,
  fromGrowDeskSupplementProduct,
  type GrowDeskSupplementProduct,
  type GrowDeskFormulaProduct,
} from "@/lib/growdesk/nutrition-compat";

function throwPartialFoodPlanMutation(error: unknown, resourceId: string): never {
  if (error instanceof BridgeError) {
    const details = error.details && typeof error.details === "object" && !Array.isArray(error.details)
      ? { ...(error.details as Record<string, unknown>) }
      : error.details === undefined ? {} : { upstreamDetails: error.details };
    throw new BridgeError(error.status, error.code, error.message, {
      ...details,
      partialMutation: true,
      resourceId,
    });
  }
  throw new BridgeError(500, "PARTIAL_MUTATION", "产品已保存，但饮食计划同步失败", {
    partialMutation: true,
    resourceId,
  });
}

function readFoodPlan(response: Awaited<ReturnType<typeof growdeskFetch>>, babyId: string): GrowDeskFoodPlanState {
  return readGrowDeskFoodPlan(response, babyId);
}

export async function GET(request: Request) {
  try {
    if (GROWDESK_CONFIG.enabled) {
      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }

      const identity = await loadWebIdentity(growdeskFetch, bffSession.accessToken);
      const { searchParams } = new URL(request.url);
      const requestedBabyId = searchParams.get("babyId");
      const selectedBaby = requestedBabyId
        ? await loadWebBaby(growdeskFetch, bffSession.accessToken, requestedBabyId)
        : identity.baby;
      const familyId = selectedBaby?.familyId || identity.family?.id;
      const babyId = selectedBaby?.id || null;

      if (!familyId) {
        return NextResponse.json({
          formulas: [],
          supplements: [],
          presets: {
            formulas: PRESET_FORMULA_PRODUCTS,
            supplements: PRESET_SUPPLEMENT_PRODUCTS,
          },
        });
      }

      const type = searchParams.get("type"); // 'formula' | 'supplement'
      const includeInactive = searchParams.get("includeInactive") === "true";

      let formulas: FormulaProduct[] = [];
      let supplements: SupplementProduct[] = [];

      // Fetch food plan for formula defaults. Supplement products are
      // canonical family rows on the new backend; they must not depend on the
      // compatibility JSON plan state.
      let foodPlanData: Record<string, unknown> = {};
      if (babyId && (!type || type === "formula")) {
        const foodPlan = readFoodPlan(await growdeskFetch<any>(`/api/v1/babies/${babyId}/food-plan`, {
          method: "GET",
          accessToken: bffSession.accessToken,
        }), babyId);
        foodPlanData = foodPlan.planData;
      }
      const suppState = extractSupplementStateFromFoodPlan(foodPlanData);

      if (!type || type === "formula") {
        const rawList = await fetchCompleteList<GrowDeskFormulaProduct>(
          growdeskFetch,
          bffSession.accessToken,
          `/api/v1/families/${familyId}/nutrition/products${includeInactive ? "?includeArchived=true" : ""}`,
        );

        let firstActiveSeen = false;
        formulas = rawList.map((raw) => {
          const isFirst = !firstActiveSeen && !raw.isArchived;
          if (isFirst) firstActiveSeen = true;

          return fromGrowDeskFormulaProduct(raw, {
            defaultFormulaId: suppState.defaultFormulaId,
            customNutrients: suppState.customFormulaNutrients?.[raw.id],
            isFirstActive: isFirst,
          });
        });

        if (!includeInactive) {
          formulas = formulas.filter((f) => f.isActive);
        }

        formulas.sort((a, b) => {
          if (a.isDefault && !b.isDefault) return -1;
          if (!a.isDefault && b.isDefault) return 1;
          return 0;
        });
      }

      if (!type || type === "supplement") {
        const rawSupplements = await fetchCompleteList<GrowDeskSupplementProduct>(
          growdeskFetch,
          bffSession.accessToken,
          `/api/v1/families/${familyId}/nutrition/supplement-products${includeInactive ? "?includeArchived=true" : ""}`,
        );
        supplements = rawSupplements.map(fromGrowDeskSupplementProduct);
        if (!includeInactive) {
          supplements = supplements.filter((s) => s.isActive !== false);
        }
      }

      return NextResponse.json({
        formulas,
        supplements,
        presets: {
          formulas: PRESET_FORMULA_PRODUCTS,
          supplements: PRESET_SUPPLEMENT_PRODUCTS,
        },
      });
    }

    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;

    const activeBabyResult = await getActiveBaby(auth.user.id);
    if (activeBabyResult.errorResponse) return activeBabyResult.errorResponse;
    const familyId = activeBabyResult.family?.id;

    if (!familyId) {
      return NextResponse.json({
        formulas: [],
        supplements: [],
        presets: {
          formulas: PRESET_FORMULA_PRODUCTS,
          supplements: PRESET_SUPPLEMENT_PRODUCTS,
        },
      });
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type"); // 'formula' | 'supplement'
    const includeInactive = searchParams.get("includeInactive") === "true";

    let formulas: FormulaProduct[] = [];
    let supplements: SupplementProduct[] = [];

    if (!type || type === "formula") {
      const dbFormulas = await prisma.formulaProduct.findMany({
        where: includeInactive ? { familyId } : { familyId, isActive: true },
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      });
      formulas = dbFormulas.map((f) => ({
        id: f.id,
        familyId: f.familyId,
        name: f.name,
        brand: f.brand,
        stage: f.stage,
        scoopWeightG: f.scoopWeightG,
        waterPerScoopMl: f.waterPerScoopMl,
        reconstitutionRatio: f.reconstitutionRatio,
        servingSizeUnit: f.servingSizeUnit,
        nutrients: (f.nutrientsJson ? JSON.parse(f.nutrientsJson) : {}) as NutrientsMap,
        notes: f.notes,
        isActive: f.isActive,
        isDefault: Boolean(f.isDefault),
        createdAt: f.createdAt.toISOString(),
        updatedAt: f.updatedAt.toISOString(),
      }));
    }

    if (!type || type === "supplement") {
      const dbSupplements = await prisma.supplementProduct.findMany({
        where: includeInactive ? { familyId } : { familyId, isActive: true },
        orderBy: { createdAt: "desc" },
      });
      supplements = dbSupplements.map((s) => ({
        id: s.id,
        familyId: s.familyId,
        name: s.name,
        brand: s.brand,
        dosageForm: s.dosageForm,
        unitName: s.unitName,
        defaultDose: s.defaultDose,
        nutrients: (s.nutrientsJson ? JSON.parse(s.nutrientsJson) : {}) as NutrientsMap,
        notes: s.notes,
        isActive: s.isActive,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      }));
    }

    return NextResponse.json({
      formulas,
      supplements,
      presets: {
        formulas: PRESET_FORMULA_PRODUCTS,
        supplements: PRESET_SUPPLEMENT_PRODUCTS,
      },
    });
  } catch (error: any) {
    if (error instanceof BridgeError) return bridgeErrorResponse(error);
    console.error("GET /api/nutrition/products error:", error);
    return NextResponse.json({ error: "获取产品库失败" }, { status: 500 });
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

      const identity = await loadWebIdentity(growdeskFetch, bffSession.accessToken);
      const familyId = identity.family?.id;
      const babyId = identity.baby?.id;

      if (!familyId) {
        return NextResponse.json({ error: "请先加入家庭" }, { status: 400 });
      }

      const body = await request.json().catch(() => ({}));
      const { type = "formula" } = body;

      if (type === "formula") {
        let payload: Record<string, unknown>;
        try {
          payload = toGrowDeskFormulaCreatePayload(body);
        } catch (e: any) {
          return NextResponse.json({ error: e.message }, { status: 400 });
        }

        const res = await growdeskFetch<any>(`/api/v1/families/${familyId}/nutrition/products`, {
          method: "POST",
          accessToken: bffSession.accessToken,
          body: payload,
        });

        if (!res.ok || !res.data) {
          return NextResponse.json(
            { error: res.error?.message || "添加奶粉失败" },
            { status: res.status }
          );
        }

        const createdRaw: GrowDeskFormulaProduct = res.data.data || res.data;

        // If isDefault or custom nutrients provided, update food-plan
        if (babyId) {
          try {
            const foodPlan = readFoodPlan(await growdeskFetch<any>(`/api/v1/babies/${babyId}/food-plan`, {
              method: "GET",
              accessToken: bffSession.accessToken,
            }), babyId);
            const suppState = extractSupplementStateFromFoodPlan(foodPlan.planData);

            const shouldBeDefault = Boolean(body.isDefault) || !suppState.defaultFormulaId;
            const patch: Partial<typeof suppState> = {};
            if (shouldBeDefault) {
              patch.defaultFormulaId = createdRaw.id;
            }
            if (body.nutrients && typeof body.nutrients === "object") {
              patch.customFormulaNutrients = {
                ...suppState.customFormulaNutrients,
                [createdRaw.id]: body.nutrients,
              };
            }
            if (Object.keys(patch).length > 0) {
              const merged = mergeSupplementStateIntoFoodPlan(foodPlan.planData, patch);
              requireData(await growdeskFetch(`/api/v1/babies/${babyId}/food-plan`, {
                method: "PUT",
                accessToken: bffSession.accessToken,
                body: foodPlanWriteBody(foodPlan, merged),
              }));
            }
          } catch (error) {
            throwPartialFoodPlanMutation(error, createdRaw.id);
          }
        }

        const formula = fromGrowDeskFormulaProduct(createdRaw, {
          defaultFormulaId: body.isDefault ? createdRaw.id : undefined,
          customNutrients: body.nutrients,
        });

        return NextResponse.json(formula, { status: 201 });
      } else if (type === "supplement") {
        const {
          name,
          brand,
          dosageForm = "drops",
          unitName = "滴",
          defaultDose = 1.0,
          nutrients = {},
          notes,
        } = body;

        if (!name || typeof name !== "string" || !name.trim()) {
          return NextResponse.json({ error: "补剂名称必填" }, { status: 400 });
        }

        const res = await growdeskFetch<GrowDeskSupplementProduct>(
          `/api/v1/families/${familyId}/nutrition/supplement-products`,
          {
            method: "POST",
            accessToken: bffSession.accessToken,
            body: {
              name: name.trim(),
              brand: (brand || name).trim(),
              dosageForm: dosageForm || "drops",
              unitName: unitName || "滴",
              defaultDose: String(Number(defaultDose) || 1.0),
              nutrientsJson: nutrients || {},
              notes: notes ? String(notes).trim() : null,
            },
          },
        );
        if (!res.ok || !res.data) {
          return NextResponse.json({ error: res.error?.message || "添加补剂失败" }, { status: res.status });
        }
        const newSupp = fromGrowDeskSupplementProduct((res.data as any).data || res.data);
        return NextResponse.json(newSupp, { status: 201 });
      } else {
        return NextResponse.json({ error: "type 必须为 formula 或 supplement" }, { status: 400 });
      }
    }

    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;

    const activeBabyResult = await getActiveBaby(auth.user.id);
    if (activeBabyResult.errorResponse) return activeBabyResult.errorResponse;
    const familyId = activeBabyResult.family?.id;

    if (!familyId) {
      return NextResponse.json({ error: "请先加入家庭" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const { type = "formula" } = body;

    if (type === "formula") {
      const {
        name,
        brand,
        stage,
        scoopWeightG = 4.3,
        waterPerScoopMl = 30.0,
        reconstitutionRatio = 0.135,
        servingSizeUnit = "per_100g",
        nutrients = {},
        notes,
        isDefault = false,
      } = body;

      if (!name || typeof name !== "string" || !name.trim()) {
        return NextResponse.json({ error: "奶粉名称必填" }, { status: 400 });
      }

      const parsedScoopWeight = Number(scoopWeightG);
      const parsedWaterPerScoop = Number(waterPerScoopMl);
      if (Number.isNaN(parsedScoopWeight) || parsedScoopWeight <= 0) {
        return NextResponse.json({ error: "单勺克重必须为大于 0 的有效数值" }, { status: 400 });
      }
      if (Number.isNaN(parsedWaterPerScoop) || parsedWaterPerScoop <= 0) {
        return NextResponse.json({ error: "每勺加水量必须为大于 0 的有效数值" }, { status: 400 });
      }

      // 检查当前家庭是否已有活跃奶粉。若没有，则将此款自动设为默认主力奶粉
      const existingCount = await prisma.formulaProduct.count({
        where: { familyId, isActive: true },
      });
      const shouldBeDefault = Boolean(isDefault) || existingCount === 0;

      if (shouldBeDefault) {
        await prisma.formulaProduct.updateMany({
          where: { familyId },
          data: { isDefault: false },
        });
      }

      const created = await prisma.formulaProduct.create({
        data: {
          familyId,
          name: name.trim(),
          brand: (brand || name).trim(),
          stage: typeof stage === "number" ? stage : null,
          scoopWeightG: Number(scoopWeightG) || 4.3,
          waterPerScoopMl: Number(waterPerScoopMl) || 30.0,
          reconstitutionRatio: Number(reconstitutionRatio) || 0.135,
          servingSizeUnit: servingSizeUnit || "per_100g",
          nutrientsJson: JSON.stringify(nutrients || {}),
          notes: notes ? String(notes).trim() : null,
          isActive: true,
          isDefault: shouldBeDefault,
        },
      });

      return NextResponse.json(
        {
          ...created,
          nutrients: JSON.parse(created.nutrientsJson),
          isDefault: created.isDefault,
        },
        { status: 201 }
      );
    } else if (type === "supplement") {
      const {
        name,
        brand,
        dosageForm = "drops",
        unitName = "滴",
        defaultDose = 1.0,
        nutrients = {},
        notes,
      } = body;

      if (!name || typeof name !== "string" || !name.trim()) {
        return NextResponse.json({ error: "补剂名称必填" }, { status: 400 });
      }

      const created = await prisma.supplementProduct.create({
        data: {
          familyId,
          name: name.trim(),
          brand: (brand || name).trim(),
          dosageForm: dosageForm || "drops",
          unitName: unitName || "滴",
          defaultDose: Number(defaultDose) || 1.0,
          nutrientsJson: JSON.stringify(nutrients || {}),
          notes: notes ? String(notes).trim() : null,
        },
      });

      return NextResponse.json(
        {
          ...created,
          nutrients: JSON.parse(created.nutrientsJson),
        },
        { status: 201 }
      );
    } else {
      return NextResponse.json({ error: "type 必须为 formula 或 supplement" }, { status: 400 });
    }
  } catch (error: any) {
    if (error instanceof BridgeError) return bridgeErrorResponse(error);
    console.error("POST /api/nutrition/products error:", error);
    return NextResponse.json({ error: "添加产品失败" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    if (GROWDESK_CONFIG.enabled) {
      const csrfErr = verifyBffCsrf(request);
      if (csrfErr) return csrfErr;

      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }

      const identity = await loadWebIdentity(growdeskFetch, bffSession.accessToken);
      const familyId = identity.family?.id;
      const babyId = identity.baby?.id;

      const body = await request.json().catch(() => ({}));
      const { id, type = "formula" } = body;

      if (!id || typeof id !== "string") {
        return NextResponse.json({ error: "请提供要修改的产品 ID" }, { status: 400 });
      }

      if (type === "formula") {
        let updatePayload: Record<string, unknown>;
        try {
          updatePayload = toGrowDeskFormulaUpdatePayload(body);
        } catch (e: any) {
          return NextResponse.json({ error: e.message }, { status: 400 });
        }

        const res = await growdeskFetch<any>(`/api/v1/families/${familyId}/nutrition/products/${id}`, {
          method: "PATCH",
          accessToken: bffSession.accessToken,
          body: updatePayload,
        });

        if (!res.ok || !res.data) {
          return NextResponse.json(
            { error: res.error?.message || "更新奶粉失败" },
            { status: res.status }
          );
        }

        const updatedRaw: GrowDeskFormulaProduct = res.data.data || res.data;

        // Update defaultFormulaId or custom nutrients if provided. The product
        // PATCH has already committed, so a later plan failure is reported as a
        // partial mutation instead of returning a false success.
        const hasNutrientsPatch = body.nutrients && typeof body.nutrients === "object";
        if (babyId && (body.isDefault !== undefined || hasNutrientsPatch)) {
          try {
            const foodPlan = readFoodPlan(await growdeskFetch<any>(`/api/v1/babies/${babyId}/food-plan`, {
              method: "GET",
              accessToken: bffSession.accessToken,
            }), babyId);
            const suppState = extractSupplementStateFromFoodPlan(foodPlan.planData);

            const patch: Partial<typeof suppState> = {};
            if (body.isDefault !== undefined) {
              patch.defaultFormulaId = body.isDefault ? id : null;
            }
            if (hasNutrientsPatch) {
              patch.customFormulaNutrients = {
                ...suppState.customFormulaNutrients,
                [id]: body.nutrients,
              };
            }
            const merged = mergeSupplementStateIntoFoodPlan(foodPlan.planData, patch);
            requireData(await growdeskFetch(`/api/v1/babies/${babyId}/food-plan`, {
              method: "PUT",
              accessToken: bffSession.accessToken,
              body: foodPlanWriteBody(foodPlan, merged),
            }));
          } catch (error) {
            throwPartialFoodPlanMutation(error, id);
          }
        }

        const formula = fromGrowDeskFormulaProduct(updatedRaw, {
          defaultFormulaId: body.isDefault ? id : undefined,
          customNutrients: body.nutrients,
        });

        return NextResponse.json(formula);
      } else if (type === "supplement") {
        const res = await growdeskFetch<GrowDeskSupplementProduct>(
          `/api/v1/families/${familyId}/nutrition/supplement-products/${id}`,
          {
            method: "PATCH",
            accessToken: bffSession.accessToken,
            body: {
              ...(body.name !== undefined ? { name: String(body.name).trim() } : {}),
              ...(body.brand !== undefined ? { brand: body.brand ? String(body.brand).trim() : null } : {}),
              ...(body.dosageForm !== undefined ? { dosageForm: body.dosageForm ? String(body.dosageForm).trim() : null } : {}),
              ...(body.unitName !== undefined ? { unitName: String(body.unitName).trim() } : {}),
              ...(body.defaultDose !== undefined ? { defaultDose: String(Number(body.defaultDose)) } : {}),
              ...(body.nutrients !== undefined ? { nutrientsJson: body.nutrients } : {}),
              ...(body.notes !== undefined ? { notes: body.notes ? String(body.notes).trim() : null } : {}),
              ...(body.isActive !== undefined ? { isActive: Boolean(body.isActive), isArchived: !Boolean(body.isActive) } : {}),
            },
          },
        );
        if (!res.ok || !res.data) {
          return NextResponse.json({ error: res.error?.message || "更新补剂失败" }, { status: res.status });
        }
        return NextResponse.json(fromGrowDeskSupplementProduct((res.data as any).data || res.data));
      }

      return NextResponse.json({ error: "无效的产品类型" }, { status: 400 });
    }

    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;

    const activeBabyResult = await getActiveBaby(auth.user.id);
    if (activeBabyResult.errorResponse) return activeBabyResult.errorResponse;
    const familyId = activeBabyResult.family?.id;

    const body = await request.json().catch(() => ({}));
    const { id, type = "formula" } = body;

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "请提供要修改的产品 ID" }, { status: 400 });
    }

    if (type === "formula") {
      const existing = await prisma.formulaProduct.findUnique({ where: { id } });
      if (!existing || existing.familyId !== familyId) {
        return NextResponse.json({ error: "未找到指定的奶粉档案" }, { status: 404 });
      }

      const willBeDefault = body.isDefault !== undefined ? Boolean(body.isDefault) : existing.isDefault;
      const willBeActive = body.isActive !== undefined ? Boolean(body.isActive) : existing.isActive;

      if (willBeDefault) {
        await prisma.formulaProduct.updateMany({
          where: { familyId, id: { not: id } },
          data: { isDefault: false },
        });
      } else if (existing.isDefault && !willBeActive) {
        const nextActive = await prisma.formulaProduct.findFirst({
          where: { familyId, isActive: true, id: { not: id } },
          orderBy: { createdAt: "desc" },
        });
        if (nextActive) {
          await prisma.formulaProduct.update({
            where: { id: nextActive.id },
            data: { isDefault: true },
          });
        }
      }

      const updated = await prisma.formulaProduct.update({
        where: { id },
        data: {
          name: body.name !== undefined ? String(body.name).trim() : existing.name,
          brand: body.brand !== undefined ? String(body.brand).trim() : existing.brand,
          stage: body.stage !== undefined ? (typeof body.stage === "number" ? body.stage : null) : existing.stage,
          scoopWeightG: body.scoopWeightG !== undefined ? Number(body.scoopWeightG) : existing.scoopWeightG,
          waterPerScoopMl: body.waterPerScoopMl !== undefined ? Number(body.waterPerScoopMl) : existing.waterPerScoopMl,
          reconstitutionRatio:
            body.reconstitutionRatio !== undefined ? Number(body.reconstitutionRatio) : existing.reconstitutionRatio,
          servingSizeUnit: body.servingSizeUnit !== undefined ? body.servingSizeUnit : existing.servingSizeUnit,
          nutrientsJson: body.nutrients !== undefined ? JSON.stringify(body.nutrients) : existing.nutrientsJson,
          notes: body.notes !== undefined ? (body.notes ? String(body.notes).trim() : null) : existing.notes,
          isActive: willBeActive,
          isDefault: willBeActive ? willBeDefault : false,
        },
      });

      return NextResponse.json({
        ...updated,
        nutrients: JSON.parse(updated.nutrientsJson),
        isDefault: updated.isDefault,
      });
    } else if (type === "supplement") {
      const existing = await prisma.supplementProduct.findUnique({ where: { id } });
      if (!existing || existing.familyId !== familyId) {
        return NextResponse.json({ error: "未找到指定的补剂档案" }, { status: 404 });
      }

      const updated = await prisma.supplementProduct.update({
        where: { id },
        data: {
          name: body.name !== undefined ? String(body.name).trim() : existing.name,
          brand: body.brand !== undefined ? String(body.brand).trim() : existing.brand,
          dosageForm: body.dosageForm !== undefined ? String(body.dosageForm).trim() : existing.dosageForm,
          unitName: body.unitName !== undefined ? String(body.unitName).trim() : existing.unitName,
          defaultDose: body.defaultDose !== undefined ? Number(body.defaultDose) : existing.defaultDose,
          nutrientsJson: body.nutrients !== undefined ? JSON.stringify(body.nutrients) : existing.nutrientsJson,
          notes: body.notes !== undefined ? (body.notes ? String(body.notes).trim() : null) : existing.notes,
          isActive: body.isActive !== undefined ? Boolean(body.isActive) : existing.isActive,
        },
      });

      return NextResponse.json({
        ...updated,
        nutrients: JSON.parse(updated.nutrientsJson),
      });
    }

    return NextResponse.json({ error: "无效的产品类型" }, { status: 400 });
  } catch (error: any) {
    if (error instanceof BridgeError) return bridgeErrorResponse(error);
    console.error("PUT /api/nutrition/products error:", error);
    return NextResponse.json({ error: "更新产品失败" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    if (GROWDESK_CONFIG.enabled) {
      const csrfErr = verifyBffCsrf(request);
      if (csrfErr) return csrfErr;

      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }

      const identity = await loadWebIdentity(growdeskFetch, bffSession.accessToken);
      const familyId = identity.family?.id;
      const babyId = identity.baby?.id;

      const { searchParams } = new URL(request.url);
      const id = searchParams.get("id");
      const type = searchParams.get("type") || "formula";

      if (!id) {
        return NextResponse.json({ error: "请提供产品 ID" }, { status: 400 });
      }

      if (type === "formula") {
        const res = await growdeskFetch<any>(`/api/v1/families/${familyId}/nutrition/products/${id}`, {
          method: "DELETE",
          accessToken: bffSession.accessToken,
        });

        if (!res.ok) {
          if (res.status === 404) {
            return NextResponse.json({ success: true, id, archived: true });
          }
          return NextResponse.json(
            { error: res.error?.message || "删除产品失败" },
            { status: res.status }
          );
        }

        return NextResponse.json({
          success: true,
          id,
          archived: true,
          message: "已归档停用该奶粉档案（历史记录继续保留）",
        });
      } else if (type === "supplement") {
        const res = await growdeskFetch(`/api/v1/families/${familyId}/nutrition/supplement-products/${id}`, {
          method: "DELETE",
          accessToken: bffSession.accessToken,
        });
        if (!res.ok && res.status !== 404) {
          return NextResponse.json({ error: res.error?.message || "删除补剂失败" }, { status: res.status });
        }
        return NextResponse.json({ success: true, id });
      }

      return NextResponse.json({ error: "无效的产品类型" }, { status: 400 });
    }

    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;

    const activeBabyResult = await getActiveBaby(auth.user.id);
    if (activeBabyResult.errorResponse) return activeBabyResult.errorResponse;
    const familyId = activeBabyResult.family?.id;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const type = searchParams.get("type") || "formula";
    const force = searchParams.get("force") === "true";

    if (!id) {
      return NextResponse.json({ error: "请提供产品 ID" }, { status: 400 });
    }

    if (type === "formula") {
      const existing = await prisma.formulaProduct.findUnique({ where: { id } });
      if (!existing || existing.familyId !== familyId) {
        return NextResponse.json({ error: "未找到指定产品" }, { status: 404 });
      }

      // 检查是否有历史喂养记录引用该奶粉
      const refCount = await prisma.feedingRecord.count({
        where: { formulaProductId: id },
      });

      // 若已有历史喂养记录绑定，且未强制硬删除：执行归档停用（软删除）以保护历史分析准确
      if (refCount > 0 && !force) {
        await prisma.formulaProduct.update({
          where: { id },
          data: { isActive: false, isDefault: false },
        });

        if (existing.isDefault) {
          const nextActive = await prisma.formulaProduct.findFirst({
            where: { familyId, isActive: true },
            orderBy: { createdAt: "desc" },
          });
          if (nextActive) {
            await prisma.formulaProduct.update({
              where: { id: nextActive.id },
              data: { isDefault: true },
            });
          }
        }

        return NextResponse.json({
          success: true,
          id,
          archived: true,
          message: `已有 ${refCount} 条历史喂养记录引用「${existing.name}」。为保护历史营养数据不被篡改，已自动为您归档停用（历史记录和分析继续保留，新记录不再可选）。`,
        });
      }

      // 未曾被使用或明确要求硬删除
      await prisma.formulaProduct.delete({ where: { id } });

      if (existing.isDefault) {
        const nextActive = await prisma.formulaProduct.findFirst({
          where: { familyId, isActive: true },
          orderBy: { createdAt: "desc" },
        });
        if (nextActive) {
          await prisma.formulaProduct.update({
            where: { id: nextActive.id },
            data: { isDefault: true },
          });
        }
      }

      return NextResponse.json({ success: true, id, archived: false });
    } else {
      const existing = await prisma.supplementProduct.findUnique({ where: { id } });
      if (!existing || existing.familyId !== familyId) {
        return NextResponse.json({ error: "未找到指定产品" }, { status: 404 });
      }
      await prisma.supplementProduct.delete({ where: { id } });
      return NextResponse.json({ success: true, id });
    }
  } catch (error: any) {
    if (error instanceof BridgeError) return bridgeErrorResponse(error);
    console.error("DELETE /api/nutrition/products error:", error);
    return NextResponse.json({ error: "删除产品失败" }, { status: 500 });
  }
}
