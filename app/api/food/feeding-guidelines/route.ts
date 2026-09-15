import { GROWDESK_CONFIG } from "@/lib/config";
import { knowledgeBridge } from "@/lib/growdesk/knowledge-bridge";
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { safeJsonParse } from '@/lib/json'

export async function GET(request: Request) {
  if (GROWDESK_CONFIG.enabled) return knowledgeBridge(request, "feeding-guidelines");
  const { searchParams } = new URL(request.url)
  const month = searchParams.get('month')

  try {
    const where: any = {}
    if (month) {
      const m = Number(month)
      if (Number.isInteger(m) && m >= 0) {
        where.ageMinMonths = { lte: m }
        where.ageMaxMonths = { gte: m }
      }
    }

    const guidelines = await prisma.feedingGuideline.findMany({
      where,
      orderBy: { ageMinMonths: 'asc' }
    })

    const parsed = guidelines.map(g => ({
      ...g,
      texture: safeJsonParse(g.textureJson),
      foodDiversity: safeJsonParse(g.foodDiversityJson),
      responsiveFeeding: safeJsonParse(g.responsiveFeedingJson),
      safety: safeJsonParse(g.safetyJson),
      sourceRefs: safeJsonParse(g.sourceRefsJson),
    }))

    return NextResponse.json(parsed)
  } catch (error) {
    console.error('Error fetching feeding guidelines:', error)
    return NextResponse.json(
      { error: 'Failed to fetch feeding guidelines' },
      { status: 500 }
    )
  }
}
