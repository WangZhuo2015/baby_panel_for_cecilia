import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireBaby } from "@/lib/api-helpers";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { verifyBffCsrf } from "@/lib/growdesk/csrf";
import { growdeskFetch } from "@/lib/growdesk/client";
import { loadWebBaby } from "@/lib/growdesk/bridge-identity";
import { BridgeError, bridgeErrorResponse, requireData, pathId } from "@/lib/growdesk/bridge-protocol";
import { readJsonObject } from "@/lib/growdesk/record-route-helpers";
import { matchVaccineProduct, projectVaccineLedgerRecord } from "@/lib/vaccine-records";
import { buildVaccineSelections, fromGrowDeskVaccineCatalog, projectLegacyVaccineSelections, type GrowDeskVaccineRecord } from "@/lib/growdesk/vaccine-compat";
import { wantsExtendedRepresentation } from "@/lib/growdesk/legacy-projections";

export async function GET(request: Request) {
  try {
    if (GROWDESK_CONFIG.enabled) {
      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }
      const { searchParams } = new URL(request.url);
      let babyId = searchParams.get("babyId");
      if (!babyId) {
        const baby = await loadWebBaby(growdeskFetch, bffSession.accessToken);
        babyId = baby?.id || null;
      }
      if (!babyId) {
        return NextResponse.json({ error: "请提供 babyId" }, { status: 400 });
      }

      const [recRes, catalogRes, selectionRes] = await Promise.all([
        growdeskFetch<GrowDeskVaccineRecord[]>(`/api/v1/babies/${pathId(babyId)}/vaccines/records`, {
          accessToken: bffSession.accessToken, headers: { "x-growdesk-representation": "ledger" },
        }),
        growdeskFetch<any>(`/api/v1/vaccines/catalog`, { accessToken: bffSession.accessToken }),
        growdeskFetch<any[]>(`/api/v1/babies/${babyId}/vaccines/selections`, { accessToken: bffSession.accessToken }),
      ]);
      const recordsData = requireData(recRes);
      if (!Array.isArray(recordsData) || recordsData.some(record => !record || record.babyId !== babyId)) {
        throw new BridgeError(502, "UPSTREAM_SCOPE_MISMATCH", "疫苗记录不属于当前宝宝");
      }
      const records = recordsData;
      const catalog = fromGrowDeskVaccineCatalog(requireData(catalogRes));
      const normalizedSelections = requireData(selectionRes);
      const savedSelections: Record<string, { selected?: boolean; completed?: boolean; id?: string; updatedAt?: string }> = {};
      const catalogById = new Map<string, any>();
      for (const vaccine of (catalog.vaccines || []) as any[]) {
        catalogById.set(String(vaccine.id), vaccine);
        if (vaccine.normalizedId) catalogById.set(String(vaccine.normalizedId), vaccine);
        if (vaccine.vaccineCode) catalogById.set(String(vaccine.vaccineCode), vaccine);
        if (vaccine.vaccineId) catalogById.set(String(vaccine.vaccineId), vaccine);
      }
      for (const selection of Array.isArray(normalizedSelections) ? normalizedSelections : []) {
        const vaccine = catalogById.get(String(selection.vaccineId));
        const legacyId = vaccine?.vaccineId || vaccine?.vaccineCode || selection.vaccineId;
        savedSelections[`${legacyId}-${selection.doseNumber}`] = {
          selected: Boolean(selection.selected),
          completed: Boolean(selection.completed),
          id: selection.id,
          updatedAt: selection.updatedAt,
        };
      }

      const selections = wantsExtendedRepresentation(request)
        ? buildVaccineSelections(records, savedSelections, catalog)
        : projectLegacyVaccineSelections(records, savedSelections, babyId);
      return NextResponse.json(selections);
    }

    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const { searchParams } = new URL(request.url);
    const requestedBabyId = searchParams.get("babyId");

    const babyResult = await requireBaby(user.id, requestedBabyId);
    if (babyResult.errorResponse) return babyResult.errorResponse;

    const babyId = babyResult.baby.id;
    const [saved, rows, vaccines] = await Promise.all([
      prisma.vaccineSelection.findMany({ where: { babyId }, orderBy: [{ vaccineId: "asc" }, { doseNumber: "asc" }] }),
      prisma.vaccineRecord.findMany({ where: { babyId } }),
      prisma.vaccine.findMany({ include: { doses: true } }),
    ]);
    const preferences = Object.fromEntries(saved.map(row => [`${row.vaccineId}-${row.doseNumber}`, {
      id: row.id, selected: row.selected, updatedAt: row.updatedAt.toISOString(),
    }]));
    const records: GrowDeskVaccineRecord[] = rows.map(row => {
      const projected = projectVaccineLedgerRecord(row);
      return {
        ...projected, familyId: babyResult.family.id,
        vaccineCode: row.vaccineId || (!row.recordStatus ? matchVaccineProduct(row.name, vaccines)?.vaccineId : null) || row.name,
        legacyName: row.name, legacyDose: row.dose,
        createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      };
    });
    const selections = wantsExtendedRepresentation(request)
      ? buildVaccineSelections(records, preferences, { vaccines })
      : projectLegacyVaccineSelections(records, preferences, babyId);
    return NextResponse.json(selections, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof BridgeError) return bridgeErrorResponse(error);
    console.error("GET /api/vaccines/selections error:", error);
    return NextResponse.json(
      { error: "Failed to fetch vaccine selections" },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    // Selection is a preference only. Completion requires an actual dated record.
    if (GROWDESK_CONFIG.enabled) {
      const csrf = verifyBffCsrf(request);
      if (csrf) return csrf;
      const session = await resolveBffSession(request);
      if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 });
      const body = await readJsonObject(request);
      validateSelection(body);
      let babyId = typeof body.babyId === "string" ? body.babyId : null;
      if (!babyId) babyId = (await loadWebBaby(growdeskFetch, session.accessToken))?.id || null;
      if (!babyId) throw new BridgeError(400, "BABY_REQUIRED", "请先选择宝宝");
      const saved = requireData(await growdeskFetch<any>(`/api/v1/babies/${pathId(babyId)}/vaccines/selections`, {
        method: "PUT", accessToken: session.accessToken,
        body: { vaccineId: String(body.vaccineId).trim(), doseNumber: body.doseNumber, selected: body.selected,
          ...(body.baseVersion !== undefined ? { baseVersion: body.baseVersion } : {}),
        },
      }));
      return NextResponse.json({ ...saved, vaccineId: String(body.vaccineId).trim(), doseNumber: body.doseNumber,
        selected: Boolean(saved.selected), completed: Boolean(saved.completed),
      }, { headers: { "cache-control": "no-store" } });
    }
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const body = await readJsonObject(request);
    validateSelection(body);
    const babyResult = await requireBaby(auth.user, typeof body.babyId === "string" ? body.babyId : null);
    if (babyResult.errorResponse) return babyResult.errorResponse;
    const babyId = babyResult.baby.id;
    const doseNumber = body.doseNumber as number;
    const requested = String(body.vaccineId).trim();
    const result = await prisma.$transaction(async tx => {
      const vaccines = await tx.vaccine.findMany({ select: { id: true, vaccineId: true, name: true, shortName: true } });
      const product = vaccines.find(row => row.vaccineId === requested || row.id === requested);
      if (!product) throw new BridgeError(400, "UNKNOWN_VACCINE_PRODUCT", "未找到所选疫苗产品");
      const vaccineId = product.vaccineId;
      const selection = await tx.vaccineSelection.upsert({
        where: { babyId_vaccineId_doseNumber: { babyId, vaccineId, doseNumber } },
        update: { selected: body.selected as boolean },
        create: { babyId, vaccineId, doseNumber, selected: body.selected as boolean, completed: false },
      });
      const records = await tx.vaccineRecord.findMany({ where: { babyId } });
      const completed = records.some(row => {
        const record = projectVaccineLedgerRecord(row);
        const code = row.vaccineId || matchVaccineProduct(row.name, vaccines)?.vaccineId;
        return record.isCompleted && record.doseNumber === doseNumber && code === vaccineId;
      });
      return { ...selection, completed };
    });
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof BridgeError || GROWDESK_CONFIG.enabled) return bridgeErrorResponse(error);
    console.error("PUT /api/vaccines/selections error:", error);
    return NextResponse.json({ error: "疫苗选择保存失败" }, { status: 500 });
  }
}

function validateSelection(body: Record<string, unknown>): void {
  if (body.completed !== undefined) throw new BridgeError(400, "READ_ONLY_VACCINE_COMPLETION", "已接种状态由接种记录生成，请补录或编辑实际接种日期");
  if (typeof body.vaccineId !== "string" || !body.vaccineId.trim()) throw new BridgeError(400, "INVALID_VACCINE_PRODUCT", "请选择疫苗产品");
  if (typeof body.doseNumber !== "number" || !Number.isInteger(body.doseNumber) || body.doseNumber < 1 || body.doseNumber > 12) throw new BridgeError(400, "INVALID_VACCINE_DOSE", "请选择 1–12 的剂次");
  if (typeof body.selected !== "boolean") throw new BridgeError(400, "INVALID_VACCINE_SELECTION", "selected 必须为布尔值");
}
