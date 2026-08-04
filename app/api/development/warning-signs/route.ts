import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const safeJsonParse = (str: string | null | undefined, fallback: any = []) => {
  try { return str ? JSON.parse(str) : fallback } catch { return fallback }
}

export async function GET() {
  try {
    const warningSigns = await prisma.developmentWarningSign.findMany({
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
