import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireBaby } from "@/lib/api-helpers";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { verifyBffCsrf } from "@/lib/growdesk/csrf";
import { growdeskFetch } from "@/lib/growdesk/client";
import { loadWebBaby } from "@/lib/growdesk/bridge-identity";
import { BridgeError, bridgeErrorResponse, pathId, requireData } from "@/lib/growdesk/bridge-protocol";
import { buildVaccineSelections, fromGrowDeskVaccineCatalog, projectLegacyVaccineSelections, parseDoseNumber, readGrowDeskVaccineRecords, type GrowDeskVaccineRecord } from "@/lib/growdesk/vaccine-compat";
import { wantsExtendedRepresentation } from "@/lib/growdesk/legacy-projections";
import { completedVaccineFacts } from "@/lib/growdesk/vaccine-selection-facts";

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
          accessToken: bffSession.accessToken,
        }),
        growdeskFetch<any>(`/api/v1/vaccines/catalog`, { accessToken: bffSession.accessToken }),
        growdeskFetch<any[]>(`/api/v1/babies/${pathId(babyId)}/vaccines/selections`, { accessToken: bffSession.accessToken }),
      ]);
      const records = readGrowDeskVaccineRecords(requireData(recRes), babyId);
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
      for (const record of records) {
        const legacyId = record.vaccineCode;
        const dose = record.doseNumber ?? parseDoseNumber(record.legacyDose || record.notes);
        if (dose === null || record.isCompleted === false) continue;
        const key = `${legacyId}-${dose}`;
        if (!savedSelections[key]) {
          savedSelections[key] = {
            selected: true,
            completed: true,
            id: record.id,
            updatedAt: record.updatedAt,
          };
        }
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

    const [selections, records, catalog] = await Promise.all([
      prisma.vaccineSelection.findMany({ where: { babyId: babyResult.baby.id }, orderBy: [{ vaccineId: "asc" }, { doseNumber: "asc" }] }),
      prisma.vaccineRecord.findMany({ where: { babyId: babyResult.baby.id, isCompleted: true } }),
      prisma.vaccine.findMany({ select: { id: true, vaccineId: true, name: true, shortName: true } }),
    ]);
    const facts = completedVaccineFacts(records, catalog);
    const rows = selections.map(selection => ({ ...selection, completed: facts.has(`${selection.vaccineId}-${selection.doseNumber}`), recordId: facts.get(`${selection.vaccineId}-${selection.doseNumber}`) ?? null }));
    const seen = new Set(rows.map(row => `${row.vaccineId}-${row.doseNumber}`));
    for (const [key, recordId] of facts) {
      if (seen.has(key)) continue;
      const separator = key.lastIndexOf("-");
      const record = records.find(item => item.id === recordId)!;
      rows.push({ id: recordId, babyId: babyResult.baby.id, vaccineId: key.slice(0, separator), doseNumber: Number(key.slice(separator + 1)), selected: true, completed: true, recordId, updatedAt: record.updatedAt });
    }
    return NextResponse.json(rows);

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
    if (GROWDESK_CONFIG.enabled) {
      const csrfErr = verifyBffCsrf(request);
      if (csrfErr) return csrfErr;

      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }

      const body = await request.json().catch(() => ({}));
      const { vaccineId, doseNumber, selected, completed } = body;
      let babyId = body.babyId;
      if (!babyId) {
        const baby = await loadWebBaby(growdeskFetch, bffSession.accessToken);
        babyId = baby?.id || null;
      }
      if (!babyId) {
        return NextResponse.json({ error: "请提供 babyId" }, { status: 400 });
      }
      if (!vaccineId || typeof vaccineId !== "string") {
        return NextResponse.json({ error: "vaccineId 必填" }, { status: 400 });
      }
      const dose = doseNumber;
      if (typeof dose !== "number" || !Number.isInteger(dose) || dose < 1 || dose > 12) {
        return NextResponse.json({ error: "doseNumber 必须为 1-12 之间的整数" }, { status: 400 });
      }
      if ((selected !== undefined && typeof selected !== "boolean") || (completed !== undefined && typeof completed !== "boolean") || (selected === undefined && completed === undefined)) {
        return NextResponse.json({ error: "selected 或 completed 必须为布尔值" }, { status: 400 });
      }
      const saved = requireData(await growdeskFetch<any>(`/api/v1/babies/${pathId(babyId)}/vaccines/selections`, {
        method: "PUT",
        accessToken: bffSession.accessToken,
        body: {
          vaccineId: vaccineId.trim(),
          doseNumber: dose,
          ...(selected !== undefined ? { selected: Boolean(selected) } : {}),
          ...(completed !== undefined ? { completed: Boolean(completed) } : {}),
          ...(body.baseVersion !== undefined ? { baseVersion: body.baseVersion } : {}),
        },
      }));
      return NextResponse.json({
        ...saved,
        vaccineId: vaccineId.trim(),
        doseNumber: dose,
        selected: Boolean(saved.selected),
        completed: Boolean(saved.completed),
      });
    }

    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const body = await request.json().catch(() => ({}));
    const { babyId: reqBabyId, vaccineId, doseNumber, selected, completed } = body;

    const babyResult = await requireBaby(user.id, reqBabyId);
    if (babyResult.errorResponse) return babyResult.errorResponse;
    const baby = babyResult.baby;

    if (typeof vaccineId !== "string" || vaccineId.trim() === "") {
      return NextResponse.json(
        { error: "vaccineId 必填" },
        { status: 400 }
      );
    }
    const dose = doseNumber;
    if (typeof dose !== "number" || !Number.isInteger(dose) || dose < 1 || dose > 12) {
      return NextResponse.json({ error: "doseNumber 必须为 1-12 的整数" }, { status: 400 });
    }
    if ((selected !== undefined && typeof selected !== "boolean") || (completed !== undefined && typeof completed !== "boolean") || (selected === undefined && completed === undefined)) {
      return NextResponse.json({ error: "selected 或 completed 必须为布尔值" }, { status: 400 });
    }
    const result = await prisma.$transaction(async tx => {
      const records = await tx.vaccineRecord.findMany({ where: { babyId: baby.id, isCompleted: true } });
      const catalog = await tx.vaccine.findMany({ select: { id: true, vaccineId: true, name: true, shortName: true } });
      const recordId = completedVaccineFacts(records, catalog).get(`${vaccineId.trim()}-${dose}`);
      const actualCompleted = Boolean(recordId);
      if (completed !== undefined && completed !== actualCompleted) {
        throw new BridgeError(400, "VACCINE_RECORD_REQUIRED", "请在接种记录中录入或更正实际接种信息；选择方案不会改变接种历史");
      }
      const selection = await tx.vaccineSelection.upsert({
        where: { babyId_vaccineId_doseNumber: { babyId: baby.id, vaccineId: vaccineId.trim(), doseNumber: dose } },
        update: { ...(selected === undefined ? {} : { selected }), completed: actualCompleted },
        create: { babyId: baby.id, vaccineId: vaccineId.trim(), doseNumber: dose, selected: selected ?? true, completed: actualCompleted },
      });
      return { ...selection, completed: actualCompleted, recordId: recordId ?? null };
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof BridgeError) return bridgeErrorResponse(error);
    console.error("PUT /api/vaccines/selections error:", error);
    return NextResponse.json(
      { error: "Failed to save vaccine selection" },
      { status: 500 }
    );
  }
}
