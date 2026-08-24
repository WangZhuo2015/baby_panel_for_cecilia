import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { safeJsonParse } from '@/lib/json'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const month = searchParams.get('month')

  try {
    const where: any = {}
    if (month) {
      const m = Number(month)
      if (Number.isInteger(m) && m > 0) {
        where.ageMonths = m
      }
    }

    const warningSigns = await prisma.developmentWarningSign.findMany({
      where,
      orderBy: { ageMonths: 'asc' }
    })

    const parsed = warningSigns.map(ws => ({
      ...ws,
      sourceRefs: safeJsonParse(ws.sourceRefsJson),
    }))

    return NextResponse.json(parsed)
  } catch (error) {
    console.error('Error fetching warning signs:', error)
    return NextResponse.json(
      { error: 'Failed to fetch development warning signs' },
      { status: 500 }
    )
  }
}
