import { GROWDESK_CONFIG } from "@/lib/config";
import { knowledgeBridge } from "@/lib/growdesk/knowledge-bridge";
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { safeJsonParse } from '@/lib/json'

export async function GET(request: Request) {
  if (GROWDESK_CONFIG.enabled) return knowledgeBridge(request, "activities");
  try {
    const { searchParams } = new URL(request.url);
    const monthParam = searchParams.get("month");
    const month = monthParam ? parseInt(monthParam, 10) : null;
    const where = month !== null && !Number.isNaN(month)
      ? {
          AND: [
            { OR: [{ ageMinMonths: null }, { ageMinMonths: { lte: month } }] },
            { OR: [{ ageMaxMonths: null }, { ageMaxMonths: { gte: month } }] },
          ],
        }
      : undefined;

    const activities = await prisma.activityRecommendation.findMany({
      where,
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
