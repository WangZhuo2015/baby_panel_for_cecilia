import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const safeJsonParse = (str: string | null | undefined, fallback: any = []) => {
  try { return str ? JSON.parse(str) : fallback } catch { return fallback }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status') // tried, to_try, or all

  try {
    const where: any = {}
    if (status === 'tried') {
      where.status = 'tried'
    } else if (status === 'to_try') {
      where.status = 'to_try'
    }

    const foodItems = await prisma.foodItem.findMany({
      where,
      orderBy: { recommendedFromMonth: 'asc' }
    })

    const parsed = foodItems.map(f => ({
      ...f,
      preparation: safeJsonParse(f.preparationJson),
      nutrition: safeJsonParse(f.nutritionJson),
      textureByAge: safeJsonParse(f.textureByAgeJson),
      sourceRefs: safeJsonParse(f.sourceRefsJson),
    }))

    return NextResponse.json(parsed)
  } catch (error) {
    console.error('Error fetching food items:', error)
    return NextResponse.json(
      { error: 'Failed to fetch food items' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()

    if (typeof body.name !== 'string' || body.name.trim() === '') {
      return NextResponse.json(
        { error: 'name 必填且不能为空' },
        { status: 400 }
      )
    }

    const foodItem = await prisma.foodItem.create({
      data: {
        foodId: body.foodId || `user_${Date.now()}`,
        name: body.name,
        icon: body.icon || '🍽️',
        category: body.category || 'other',
        foodGroup: body.foodGroup ?? null,
        status: body.status === 'tried' ? 'tried' : 'to_try',
        firstAddedDate: body.firstAddedDate ?? null,
        recommendedFromMonth: body.recommendedFromMonth ?? null,
        recommendedToMonth: body.recommendedToMonth ?? null,
        exactMonthEvidence: body.exactMonthEvidence ?? false,
        guidance: body.guidance ?? null,
        isCommonAllergen: body.isCommonAllergen ?? null,
        allergenIntroductionGuidance: body.allergenIntroductionGuidance ?? null,
        highRiskInfantNeedsMedicalAdvice: body.highRiskInfantNeedsMedicalAdvice ?? null,
        chokingRisk: body.chokingRisk ?? false,
        chokingNotes: body.chokingNotes ?? null,
        preparationJson: body.preparation ? JSON.stringify(body.preparation) : '[]',
        avoidBeforeMonths: body.avoidBeforeMonths ?? null,
        nutritionJson: body.nutrition ? JSON.stringify(body.nutrition) : '[]',
        textureByAgeJson: body.textureByAge ? JSON.stringify(body.textureByAge) : '[]',
        notes: body.notes ?? null,
        sourceRefsJson: body.sourceRefs ? JSON.stringify(body.sourceRefs) : '[]',
      }
    })

    return NextResponse.json({
      ...foodItem,
      preparation: safeJsonParse(foodItem.preparationJson),
      nutrition: safeJsonParse(foodItem.nutritionJson),
      textureByAge: safeJsonParse(foodItem.textureByAgeJson),
      sourceRefs: safeJsonParse(foodItem.sourceRefsJson),
    }, { status: 201 })
  } catch (error) {
    console.error('Error creating food item:', error)
    return NextResponse.json(
      { error: 'Failed to create food item' },
      { status: 500 }
    )
  }
}
