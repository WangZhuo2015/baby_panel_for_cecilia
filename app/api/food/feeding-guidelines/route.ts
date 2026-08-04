import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const safeJsonParse = (str: string | null | undefined, fallback: any = []) => {
  try { return str ? JSON.parse(str) : fallback } catch { return fallback }
}

export async function GET() {
  try {
    const guidelines = await prisma.feedingGuideline.findMany({
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
