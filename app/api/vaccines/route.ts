import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { safeJsonParse } from '@/lib/json'
import { requireAuth, requireBaby } from '@/lib/api-helpers'
import { getLocalDateStr, isValidDateStr } from '@/lib/date'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const regionCode = searchParams.get('regionCode') || 'CN-JS' // default to Jiangsu

  try {
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
      const matched = typeof requestedVaccineId === "string"
        ? await tx.vaccine.findUnique({
            where: { vaccineId: requestedVaccineId.trim() },
            select: { vaccineId: true, name: true },
          })
        : (
            await tx.vaccine.findMany({
              select: { vaccineId: true, name: true },
            })
          ).find((v) => v.name.includes(name.trim()) || name.trim().includes(v.name)) ?? null;

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
    console.error("POST /api/vaccines error:", error);
    return NextResponse.json(
      { error: "Failed to save vaccine record" },
      { status: 500 }
    );
  }
}
