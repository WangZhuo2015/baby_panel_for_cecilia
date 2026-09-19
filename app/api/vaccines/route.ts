import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { safeJsonParse } from '@/lib/json'
import { requireAuth, requireBaby } from '@/lib/api-helpers'
import { getLocalDateStr, isValidDateStr } from '@/lib/date'
import { GROWDESK_CONFIG } from "@/lib/config"
import { resolveBffSession } from "@/lib/growdesk/session"
import { verifyBffCsrf } from "@/lib/growdesk/csrf"
import { growdeskFetch } from "@/lib/growdesk/client"
import {
  toGrowDeskVaccineRecordPayload,
  fromGrowDeskVaccineRecord,
  loadFullVaccineKnowledge,
  type GrowDeskVaccineRecord,
} from "@/lib/growdesk/vaccine-compat"
import { loadWebBaby } from "@/lib/growdesk/bridge-identity"
import { bridgeErrorResponse } from "@/lib/growdesk/bridge-protocol"
import {
  createLegacyPendingVaccine,
  mergeLegacyPendingVaccine,
  removeLegacyPendingVaccine,
} from "@/lib/growdesk/vaccine-pending-compat"
import { foodPlanWriteBody, readGrowDeskFoodPlan } from "@/lib/growdesk/food-plan-state"
import crypto from "node:crypto"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const regionCode = searchParams.get('regionCode') || 'CN-JS' // default to Jiangsu

  try {
    if (GROWDESK_CONFIG.enabled) {
      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }
      const fullKb = loadFullVaccineKnowledge(regionCode);
      return NextResponse.json(fullKb);
    }

    // Fetch all vaccines
    const vaccines = await prisma.vaccine.findMany({
      include: { doses: { orderBy: { doseNumber: 'asc' } } }
    })

    // Parse JSON fields
    const parsed = vaccines.map(v => ({
      ...v,
      diseases: safeJsonParse(v.diseases),
      catchUpRules: safeJsonParse(v.catchUpRules),
      substitutionRules: safeJsonParse(v.substitutionRules),
      contraindications: safeJsonParse(v.contraindications),
      precautions: safeJsonParse(v.precautions),
      specialPopulations: safeJsonParse(v.specialPopulations),
      regionalOverrides: safeJsonParse(v.regionalOverrides),
      regimenOptions: safeJsonParse(v.regimenOptions),
      sourceRefsJson: safeJsonParse(v.sourceRefsJson),
      doses: v.doses.map(d => ({
        ...d,
        sourceRefsJson: safeJsonParse(d.sourceRefsJson)
      }))
    }))

    // Apply regional overrides
    const withOverrides = parsed.map(v => {
      if (v.regionalOverrides && v.regionalOverrides.length > 0) {
        const override = v.regionalOverrides.find((o: any) => o.regionCode === regionCode)
        if (override) {
          return {
            ...v,
            programType: override.programType,
            feeType: override.feeType,
            regionalOverride: override
          }
        }
      }
      return v
    })

    // Group by program type
    const national = withOverrides.filter(v => v.programType === 'national_immunization_program')
    const nonProgram = withOverrides.filter(v => v.programType === 'non_program')
    const provincial = withOverrides.filter(v => v.programType === 'provincial_immunization_program')

    // Get strategy groups
    const strategyGroups = await prisma.vaccineStrategyGroup.findMany()
    const parsedGroups = strategyGroups.map(g => ({
      ...g,
      optionsJson: safeJsonParse(g.optionsJson),
      sourceRefsJson: safeJsonParse(g.sourceRefsJson)
    }))

    // Get schedule entries
    const scheduleEntries = await prisma.vaccineScheduleEntry.findMany({
      orderBy: [{ ageMonths: 'asc' }, { doseNumber: 'asc' }]
    })
    const parsedSchedule = scheduleEntries.map(s => ({
      ...s,
      sourceRefsJson: safeJsonParse(s.sourceRefsJson)
    }))

    // Get engine rules
    const engineRules = await prisma.scheduleEngineRule.findMany()
    const parsedRules = engineRules.map(r => ({
      ...r,
      vaccineIdsJson: safeJsonParse(r.vaccineIdsJson),
      sourceRefsJson: safeJsonParse(r.sourceRefsJson)
    }))

    // Get data release info
    const dataRelease = await prisma.dataRelease.findFirst({
      include: { sources: true }
    })

    return NextResponse.json({
      national,
      nonProgram,
      provincial,
      strategyGroups: parsedGroups,
      schedule: parsedSchedule,
      engineRules: parsedRules,
      dataRelease
    })
  } catch (error) {
    console.error('Error fetching vaccines:', error)
    return NextResponse.json(
      { error: 'Failed to fetch vaccine data' },
      { status: 500 }
    )
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
      let babyId = body.babyId;
      if (!babyId) {
        const baby = await loadWebBaby(growdeskFetch, bffSession.accessToken);
        babyId = baby?.id || null;
      }
      if (!babyId) {
        return NextResponse.json({ error: "请提供 babyId" }, { status: 400 });
      }

      if (body.isCompleted === false) {
        const pending = createLegacyPendingVaccine(body, babyId);
        const planRes = await growdeskFetch<any>(`/api/v1/babies/${babyId}/food-plan`, {
          accessToken: bffSession.accessToken,
        });
        if (!planRes.ok) {
          return NextResponse.json({ error: planRes.error?.message || "Failed to fetch food plan" }, { status: planRes.status });
        }
        const plan = readGrowDeskFoodPlan(planRes, babyId);
        const merged = mergeLegacyPendingVaccine(plan, pending);
        if (!merged.created) {
          return NextResponse.json({ record: merged.item }, { status: 201 });
        }
        const saveRes = await growdeskFetch(`/api/v1/babies/${babyId}/food-plan`, {
          method: "PUT",
          accessToken: bffSession.accessToken,
          body: foodPlanWriteBody(plan, merged.planData),
        });
        if (!saveRes.ok) {
          return NextResponse.json({ error: saveRes.error?.message || "Failed to save pending vaccine" }, { status: saveRes.status });
        }
        return NextResponse.json({ record: merged.item }, { status: 201 });
      }

      const payload = toGrowDeskVaccineRecordPayload(body);
      const idempotencyKey =
        body.clientId || request.headers.get("idempotency-key") || crypto.randomUUID();

      const res = await growdeskFetch<GrowDeskVaccineRecord>(
        `/api/v1/babies/${babyId}/vaccines/records`,
        {
          method: "POST",
          accessToken: bffSession.accessToken,
          idempotencyKey,
          body: payload,
        },
      );

      if (!res.ok || !res.data) {
        return NextResponse.json(
          { error: res.error?.message || "Failed to save vaccine record" },
          { status: res.status },
        );
      }

      const rec = fromGrowDeskVaccineRecord(res.data);
      return NextResponse.json({ record: rec }, { status: 201 });
    }

    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const body = await request.json().catch(() => ({}));
    const {
      babyId: reqBabyId,
      vaccineId: requestedVaccineId,
      name,
      dose,
      scheduledDate,
      completedDate,
      isCompleted: requestedCompleted,
    } = body;

    const babyResult = await requireBaby(user.id, reqBabyId);
    if (babyResult.errorResponse) return babyResult.errorResponse;
    const baby = babyResult.baby;

    if (typeof name !== "string" || !name.trim() || name.trim().length > 200) {
      return NextResponse.json({ error: "疫苗名称必须为 1-200 个字符" }, { status: 400 });
    }
    if (dose !== undefined && (typeof dose !== "string" || !dose.trim() || dose.trim().length > 50)) {
      return NextResponse.json({ error: "dose 必须为不超过 50 个字符的文本" }, { status: 400 });
    }
    if (requestedVaccineId !== undefined && (typeof requestedVaccineId !== "string" || !requestedVaccineId.trim())) {
      return NextResponse.json({ error: "vaccineId 无效" }, { status: 400 });
    }
    if (requestedCompleted !== undefined && typeof requestedCompleted !== "boolean") {
      return NextResponse.json({ error: "isCompleted 必须为布尔值" }, { status: 400 });
    }

    const completed = requestedCompleted ?? true;
    const suppliedScheduledDate = scheduledDate ?? completedDate;
    if (
      suppliedScheduledDate !== undefined &&
      (typeof suppliedScheduledDate !== "string" || !isValidDateStr(suppliedScheduledDate.trim()))
    ) {
      return NextResponse.json({ error: "scheduledDate/completedDate 必须是有效的 YYYY-MM-DD 日期" }, { status: 400 });
    }
    if (
      completedDate !== undefined &&
      (typeof completedDate !== "string" || !isValidDateStr(completedDate.trim()))
    ) {
      return NextResponse.json({ error: "completedDate 必须是有效的 YYYY-MM-DD 日期" }, { status: 400 });
    }

    const today = getLocalDateStr();
    const validScheduledDate = typeof suppliedScheduledDate === "string"
      ? suppliedScheduledDate.trim()
      : today;
    const validCompletedDate = completed
      ? (typeof completedDate === "string" ? completedDate.trim() : validScheduledDate)
      : null;
    const doseStr = typeof dose === "string" && dose.trim() ? dose.trim() : "第1剂";
    const doseMatch = doseStr.match(/\d+/);
    const doseNum = doseMatch ? parseInt(doseMatch[0], 10) : 1;
    if (doseNum < 1 || doseNum > 12) {
      return NextResponse.json({ error: "dose 必须包含 1-12 的剂次" }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const trimmedName = name.trim();
      let matched: { vaccineId: string; name: string } | null = null;
      if (typeof requestedVaccineId === "string") {
        matched = await tx.vaccine.findUnique({
          where: { vaccineId: requestedVaccineId.trim() },
          select: { vaccineId: true, name: true },
        });
      } else {
        const all = await tx.vaccine.findMany({ select: { vaccineId: true, name: true, shortName: true } });
        const lower = trimmedName.toLowerCase();
        matched = all.find((v) => v.name === trimmedName || (v as any).shortName === trimmedName || (v as any).shortName?.toLowerCase() === lower) 
          ?? all.find((v) => trimmedName.length >= 3 && (v.name.includes(trimmedName) || trimmedName.includes(v.name) || (v as any).shortName?.toLowerCase().includes(lower) || lower.includes((v as any).shortName?.toLowerCase() || ""))) ?? null;
      }

      const record = await tx.vaccineRecord.create({
        data: {
          babyId: baby.id,
          name: name.trim(),
          dose: doseStr,
          scheduledDate: validScheduledDate,
          completedDate: validCompletedDate,
          isCompleted: completed,
        },
      });

      if (matched) {
        await tx.vaccineSelection.upsert({
          where: {
            babyId_vaccineId_doseNumber: {
              babyId: baby.id,
              vaccineId: matched.vaccineId,
              doseNumber: doseNum,
            },
          },
          create: {
            babyId: baby.id,
            vaccineId: matched.vaccineId,
            doseNumber: doseNum,
            selected: true,
            completed,
          },
          update: {
            selected: true,
            completed,
          },
        });
      }

      return record;
    });

    return NextResponse.json({ record: result }, { status: 201 });
  } catch (error) {
    if (GROWDESK_CONFIG.enabled) return bridgeErrorResponse(error);
    console.error("POST /api/vaccines error:", error);
    return NextResponse.json(
      { error: "Failed to save vaccine record" },
      { status: 500 }
    );
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

      const { searchParams } = new URL(request.url);
      let id = searchParams.get("id");
      let babyId = searchParams.get("babyId");
      if (!id) {
        const body = await request.json().catch(() => ({} as any));
        id = body?.id;
        babyId = babyId || body?.babyId;
      }
      if (!id || typeof id !== "string") {
        return NextResponse.json({ error: "请提供要删除的接种记录 ID" }, { status: 400 });
      }
      if (!babyId) {
        const baby = await loadWebBaby(growdeskFetch, bffSession.accessToken);
        babyId = baby?.id || null;
      }
      if (!babyId) {
        return NextResponse.json({ error: "请提供 babyId" }, { status: 400 });
      }

      const planRes = await growdeskFetch<any>(`/api/v1/babies/${babyId}/food-plan`, {
        accessToken: bffSession.accessToken,
      });
      if (!planRes.ok) {
        return NextResponse.json({ error: planRes.error?.message || "Failed to fetch food plan" }, { status: planRes.status });
      }
      const plan = readGrowDeskFoodPlan(planRes, babyId);
      const pendingRemoval = removeLegacyPendingVaccine(plan, id);
      if (pendingRemoval.found) {
        const saveRes = await growdeskFetch(`/api/v1/babies/${babyId}/food-plan`, {
          method: "PUT",
          accessToken: bffSession.accessToken,
          body: foodPlanWriteBody(plan, pendingRemoval.planData),
        });
        if (!saveRes.ok) {
          return NextResponse.json({ error: saveRes.error?.message || "Failed to delete pending vaccine" }, { status: saveRes.status });
        }
        return NextResponse.json({ success: true, id });
      }

      const res = await growdeskFetch(
        `/api/v1/babies/${babyId}/vaccines/records/${id}`,
        {
          method: "DELETE",
          accessToken: bffSession.accessToken,
        },
      );

      if (!res.ok) {
        if (res.status === 404) {
          return NextResponse.json({ success: true, id, alreadyDeleted: true });
        }
        return NextResponse.json(
          { error: res.error?.message || "Failed to delete vaccine record" },
          { status: res.status },
        );
      }

      return NextResponse.json({ success: true, id });
    }

    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "请提供要删除的记录 ID" }, { status: 400 });

    const rec = await prisma.vaccineRecord.findUnique({ where: { id } });
    if (!rec) return NextResponse.json({ error: "记录不存在" }, { status: 404 });
    const babyCheck = await requireBaby(auth.user.id, rec.babyId);
    if (babyCheck.errorResponse) return babyCheck.errorResponse;

    await prisma.vaccineRecord.delete({ where: { id } });
    return NextResponse.json({ success: true, id });
  } catch (error: any) {
    if (GROWDESK_CONFIG.enabled) return bridgeErrorResponse(error);
    console.error("DELETE /api/vaccines error:", error);
    return NextResponse.json({ error: error?.message || "Failed to delete vaccine record" }, { status: 500 });
  }
}
