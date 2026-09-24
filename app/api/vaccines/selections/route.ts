import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireBaby } from "@/lib/api-helpers";
import { getLocalDateStr } from "@/lib/date";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { verifyBffCsrf } from "@/lib/growdesk/csrf";
import { growdeskFetch } from "@/lib/growdesk/client";
import { loadWebBaby } from "@/lib/growdesk/bridge-identity";
import { BridgeError, bridgeErrorResponse, requireData } from "@/lib/growdesk/bridge-protocol";
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
        growdeskFetch<GrowDeskVaccineRecord[]>(`/api/v1/babies/${babyId}/vaccines/records`, {
          accessToken: bffSession.accessToken,
        }),
        growdeskFetch<any>(`/api/v1/vaccines/catalog`, { accessToken: bffSession.accessToken }),
        growdeskFetch<any[]>(`/api/v1/babies/${babyId}/vaccines/selections`, { accessToken: bffSession.accessToken }),
      ]);
      const recordsData = requireData(recRes);
      const records = Array.isArray(recordsData) ? recordsData : [];
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
        const dose = record.doseNumber || 1;
        const key = `${legacyId}-${dose}`;
        if (!savedSelections[key]) {
          savedSelections[key] = {
            selected: true,
            completed: record.isCompleted !== false,
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

    const selections = await prisma.vaccineSelection.findMany({
      where: { babyId: babyResult.baby.id },
      orderBy: [{ vaccineId: "asc" }, { doseNumber: "asc" }],
    });

    return NextResponse.json(selections);
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
      const dose = typeof doseNumber === "number" ? doseNumber : 1;
      if (!Number.isInteger(dose) || dose < 1 || dose > 12) {
        return NextResponse.json({ error: "doseNumber 必须为 1-12 之间的整数" }, { status: 400 });
      }
      if (typeof selected !== "boolean" && typeof completed !== "boolean") {
        return NextResponse.json({ error: "selected 或 completed 必须为布尔值" }, { status: 400 });
      }
      const saved = requireData(await growdeskFetch<any>(`/api/v1/babies/${babyId}/vaccines/selections`, {
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
    let dose = 1;
    if (doseNumber !== undefined && doseNumber !== null) {
      if (!Number.isInteger(doseNumber) || doseNumber < 1 || doseNumber > 12) {
        return NextResponse.json(
          { error: "doseNumber 必须为 1-12 之间的整数" },
          { status: 400 }
        );
      }
      dose = doseNumber;
    }
    if (typeof selected !== "boolean" && typeof completed !== "boolean") {
      return NextResponse.json(
        { error: "selected 或 completed 必须为布尔值" },
        { status: 400 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const selection = await tx.vaccineSelection.upsert({
        where: {
          babyId_vaccineId_doseNumber: {
            babyId: baby.id,
            vaccineId: vaccineId.trim(),
            doseNumber: dose,
          },
        },
        update: {
          selected: selected !== undefined ? selected : undefined,
          completed: completed !== undefined ? completed : undefined,
        },
        create: {
          babyId: baby.id,
          vaccineId: vaccineId.trim(),
          doseNumber: dose,
          selected: selected ?? true,
          completed: completed ?? false,
        },
      });

      if (completed === true) {
        const vaccine = await tx.vaccine.findUnique({ where: { vaccineId: vaccineId.trim() } });
        const vName = vaccine?.name || vaccineId.trim();
        const doseStr = `第${dose}剂`;
        const todayStr = getLocalDateStr();

        const existingRecord = await tx.vaccineRecord.findFirst({
          where: {
            babyId: baby.id,
            name: vName,
            dose: doseStr,
          },
        });

        if (existingRecord) {
          await tx.vaccineRecord.update({
            where: { id: existingRecord.id },
            data: { isCompleted: true, completedDate: existingRecord.completedDate || todayStr },
          });
        } else {
          await tx.vaccineRecord.create({
            data: {
              babyId: baby.id,
              name: vName,
              dose: doseStr,
              scheduledDate: todayStr,
              completedDate: todayStr,
              isCompleted: true,
            },
          });
        }
      } else if (completed === false) {
        const vaccine = await tx.vaccine.findUnique({ where: { vaccineId: vaccineId.trim() } });
        const vName = vaccine?.name || vaccineId.trim();
        const doseStr = `第${dose}剂`;
        await tx.vaccineRecord.deleteMany({
          where: {
            babyId: baby.id,
            name: vName,
            dose: doseStr,
          },
        });
      }

      return selection;
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
