import { NextResponse } from "next/server";
import { requireAuth, requireBaby, getActiveBaby } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { PRESET_FORMULA_PRODUCTS, PRESET_SUPPLEMENT_PRODUCTS } from "@/lib/nutrition/presets";
import type { FormulaProduct, SupplementProduct, NutrientsMap } from "@/types/nutrition";

export async function GET(request: Request) {
  try {
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

    let formulas: FormulaProduct[] = [];
    let supplements: SupplementProduct[] = [];

    if (!type || type === "formula") {
      const dbFormulas = await prisma.formulaProduct.findMany({
        where: { familyId, isActive: true },
        orderBy: { createdAt: "desc" },
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
        createdAt: f.createdAt.toISOString(),
        updatedAt: f.updatedAt.toISOString(),
      }));
    }

    if (!type || type === "supplement") {
      const dbSupplements = await prisma.supplementProduct.findMany({
        where: { familyId, isActive: true },
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
    console.error("GET /api/nutrition/products error:", error);
    return NextResponse.json({ error: "获取产品库失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
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
      } = body;

      if (!name || typeof name !== "string" || !name.trim()) {
        return NextResponse.json({ error: "奶粉名称必填" }, { status: 400 });
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
        },
      });

      return NextResponse.json(
        {
          ...created,
          nutrients: JSON.parse(created.nutrientsJson),
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
    console.error("POST /api/nutrition/products error:", error);
    return NextResponse.json({ error: "添加产品失败" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
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
          isActive: body.isActive !== undefined ? Boolean(body.isActive) : existing.isActive,
        },
      });

      return NextResponse.json({
        ...updated,
        nutrients: JSON.parse(updated.nutrientsJson),
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
    console.error("PUT /api/nutrition/products error:", error);
    return NextResponse.json({ error: "更新产品失败" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;

    const activeBabyResult = await getActiveBaby(auth.user.id);
    if (activeBabyResult.errorResponse) return activeBabyResult.errorResponse;
    const familyId = activeBabyResult.family?.id;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const type = searchParams.get("type") || "formula";

    if (!id) {
      return NextResponse.json({ error: "请提供产品 ID" }, { status: 400 });
    }

    if (type === "formula") {
      const existing = await prisma.formulaProduct.findUnique({ where: { id } });
      if (!existing || existing.familyId !== familyId) {
        return NextResponse.json({ error: "未找到指定产品" }, { status: 404 });
      }
      await prisma.formulaProduct.delete({ where: { id } });
      return NextResponse.json({ success: true, id });
    } else {
      const existing = await prisma.supplementProduct.findUnique({ where: { id } });
      if (!existing || existing.familyId !== familyId) {
        return NextResponse.json({ error: "未找到指定产品" }, { status: 404 });
      }
      await prisma.supplementProduct.delete({ where: { id } });
      return NextResponse.json({ success: true, id });
    }
  } catch (error: any) {
    console.error("DELETE /api/nutrition/products error:", error);
    return NextResponse.json({ error: "删除产品失败" }, { status: 500 });
  }
}
