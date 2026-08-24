import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { safeJsonParse } from '@/lib/json'

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
