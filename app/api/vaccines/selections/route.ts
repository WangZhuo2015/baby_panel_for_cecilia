import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, getActiveBabyForUser } from '@/lib/auth'

export async function GET(request: Request) {
  try {
    const user = await getAuthSession(request)
    let babyId: string | undefined
    if (user) {
      const active = await getActiveBabyForUser(user.id)
      babyId = active?.baby?.id
    }

    const { searchParams } = new URL(request.url)
    const targetBabyId = searchParams.get('babyId') || babyId

    const where: any = {}
    if (targetBabyId) where.babyId = targetBabyId

    const selections = await prisma.vaccineSelection.findMany({
      where,
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
    const user = await getAuthSession(request)
    let babyId: string | undefined
    if (user) {
      const active = await getActiveBabyForUser(user.id)
      babyId = active?.baby?.id
    }

    const body = await request.json()
    const { babyId: reqBabyId, vaccineId, doseNumber, selected, completed } = body

    const finalBabyId = reqBabyId || babyId || (await prisma.baby.findFirst())?.id
    if (!finalBabyId) {
      return NextResponse.json({ error: '未找到宝宝档案，请先创建宝宝信息' }, { status: 400 })
    }

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

    const result = await prisma.vaccineSelection.upsert({
      where: {
        babyId_vaccineId_doseNumber: {
          babyId: finalBabyId,
          vaccineId,
          doseNumber: dose,
        }
      },
      update: {
        selected: selected !== undefined ? selected : undefined,
        completed: completed !== undefined ? completed : undefined,
      },
      create: {
        babyId: finalBabyId,
        vaccineId,
        doseNumber: dose,
        selected: selected ?? true,
        completed: completed ?? false,
      }
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('PUT /api/vaccines/selections error:', error)
    return NextResponse.json(
      { error: 'Failed to save vaccine selection' },
      { status: 500 }
    )
  }
}
