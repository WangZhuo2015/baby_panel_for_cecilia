import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const selections = await prisma.vaccineSelection.findMany({
      orderBy: [{ vaccineId: 'asc' }, { doseNumber: 'asc' }]
    })
    return NextResponse.json(selections)
  } catch (error) {
    console.error('GET /api/vaccines/selections error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch vaccine selections' },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json()
    const { vaccineId, doseNumber, selected, completed } = body

    if (typeof vaccineId !== 'string' || vaccineId.trim() === '') {
      return NextResponse.json(
        { error: 'vaccineId 必填' },
        { status: 400 }
      )
    }
    const dose = typeof doseNumber === 'number' ? doseNumber : 1
    if (typeof selected !== 'boolean' && typeof completed !== 'boolean') {
      return NextResponse.json(
        { error: 'selected 或 completed 必须为布尔值' },
        { status: 400 }
      )
    }

    const existing = await prisma.vaccineSelection.findUnique({
      where: { vaccineId_doseNumber: { vaccineId, doseNumber: dose } }
    })

    let result
    if (existing) {
      result = await prisma.vaccineSelection.update({
        where: { id: existing.id },
        data: {
          selected: selected ?? existing.selected,
          completed: completed ?? existing.completed
        }
      })
    } else {
      result = await prisma.vaccineSelection.create({
        data: {
          vaccineId,
          doseNumber: dose,
          selected: selected ?? true,
          completed: completed ?? false
        }
      })
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('PUT /api/vaccines/selections error:', error)
    return NextResponse.json(
      { error: 'Failed to save vaccine selection' },
      { status: 500 }
    )
  }
}
