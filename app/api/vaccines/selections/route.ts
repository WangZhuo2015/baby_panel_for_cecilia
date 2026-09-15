import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireBaby } from "@/lib/api-helpers";
import { getLocalDateStr } from "@/lib/date";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { verifyBffCsrf } from "@/lib/growdesk/csrf";
import { growdeskFetch } from "@/lib/growdesk/client";
import { loadWebBaby } from "@/lib/growdesk/bridge-identity";
import { buildVaccineSelections } from "@/lib/growdesk/vaccine-compat";

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

      const recRes = await growdeskFetch<any[]>(`/api/v1/babies/${babyId}/vaccines/records`, {
        accessToken: bffSession.accessToken,
      });
      const records = Array.isArray(recRes.data) ? recRes.data : (recRes.data as any)?.data || [];

      const planRes = await growdeskFetch<any>(`/api/v1/babies/${babyId}/food-plan`, {
        accessToken: bffSession.accessToken,
      });
      const planData = planRes.data?.data?.planData || planRes.data?.planData || {};
      const savedSelections = planData.vaccineSelections || {};

      const selections = buildVaccineSelections(records, savedSelections);
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

      if (completed === true) {
        await growdeskFetch(`/api/v1/babies/${babyId}/vaccines/records`, {
          method: "POST",
          accessToken: bffSession.accessToken,
          body: {
            vaccineCode: vaccineId.trim(),
            administeredDate: getLocalDateStr(),
            notes: `第${dose}剂`,
          },
        });
      } else if (completed === false) {
        const recRes = await growdeskFetch<any[]>(`/api/v1/babies/${babyId}/vaccines/records`, {
          accessToken: bffSession.accessToken,
        });
        const records = Array.isArray(recRes.data) ? recRes.data : (recRes.data as any)?.data || [];
        const existing = records.find(
          (r: any) =>
            (r.vaccineCode === vaccineId || r.notes?.includes(vaccineId)) &&
            (r.notes?.includes(`第${dose}剂`) || (!r.notes && dose === 1))
        );
        if (existing?.id) {
          await growdeskFetch(`/api/v1/babies/${babyId}/vaccines/records/${existing.id}`, {
            method: "DELETE",
            accessToken: bffSession.accessToken,
          });
        }
      }

      const planRes = await growdeskFetch<any>(`/api/v1/babies/${babyId}/food-plan`, {
        accessToken: bffSession.accessToken,
      });
      const currentPlanData = planRes.data?.data?.planData || planRes.data?.planData || {};
      const currentSelections = currentPlanData.vaccineSelections || {};
      const key = `${vaccineId.trim()}-${dose}`;
      currentSelections[key] = {
        selected: selected !== undefined ? selected : currentSelections[key]?.selected ?? true,
        completed: completed !== undefined ? completed : currentSelections[key]?.completed ?? false,
      };

      await growdeskFetch(`/api/v1/babies/${babyId}/food-plan`, {
        method: "PUT",
        accessToken: bffSession.accessToken,
        body: {
          planData: {
            ...currentPlanData,
            vaccineSelections: currentSelections,
          },
        },
      });

      return NextResponse.json({
        vaccineId: vaccineId.trim(),
        doseNumber: dose,
        selected: currentSelections[key].selected,
        completed: currentSelections[key].completed,
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
    console.error("PUT /api/vaccines/selections error:", error);
    return NextResponse.json(
      { error: "Failed to save vaccine selection" },
      { status: 500 }
    );
  }
}
