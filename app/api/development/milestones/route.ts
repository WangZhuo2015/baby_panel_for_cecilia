import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { safeJsonParse } from '@/lib/json'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const category = searchParams.get('category')
  const month = searchParams.get('month')

  try {
    const where: any = {}
    if (category) {
      where.category = category
    }
    if (month) {
      const m = Number(month)
      if (Number.isInteger(m) && m > 0) {
        where.assessmentAgeMonths = m
      }
    }

    const milestones = await prisma.developmentMilestone.findMany({
      where,
      orderBy: { assessmentAgeMonths: 'asc' }
    })

    const parsed = milestones.map(m => ({
      ...m,
      sourceRefs: safeJsonParse(m.sourceRefsJson),
    }))

    // Get data release info
    const dataRelease = await prisma.dataRelease.findFirst({
      include: { sources: true }
    })

    return NextResponse.json({
      milestones: parsed,
      dataRelease
    })
  } catch (error) {
    console.error('Error fetching milestones:', error)
    return NextResponse.json(
      { error: 'Failed to fetch development milestones' },
      { status: 500 }
    )
  }
}
