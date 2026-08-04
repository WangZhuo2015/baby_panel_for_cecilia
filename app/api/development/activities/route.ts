import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const safeJsonParse = (str: string | null | undefined, fallback: any = []) => {
  try { return str ? JSON.parse(str) : fallback } catch { return fallback }
}

export async function GET() {
  try {
    const activities = await prisma.activityRecommendation.findMany({
      orderBy: { ageMinMonths: 'asc' }
    })

    const parsed = activities.map(a => ({
      ...a,
      categories: safeJsonParse(a.categoriesJson),
      developmentGoals: safeJsonParse(a.developmentGoalsJson),
      materials: safeJsonParse(a.materialsJson),
      steps: safeJsonParse(a.stepsJson),
      safety: safeJsonParse(a.safetyJson),
      stopConditions: safeJsonParse(a.stopConditionsJson),
      sourceRefs: safeJsonParse(a.sourceRefsJson),
    }))

    return NextResponse.json(parsed)
  } catch (error) {
    console.error('Error fetching activities:', error)
    return NextResponse.json(
      { error: 'Failed to fetch activity recommendations' },
      { status: 500 }
    )
  }
}
