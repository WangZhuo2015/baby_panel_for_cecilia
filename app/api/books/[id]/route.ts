import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const safeJsonParse = (str: string | null | undefined, fallback: any = []) => {
  try { return str ? JSON.parse(str) : fallback } catch { return fallback }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const updateData: any = {}
    if (typeof body.isFavorite === 'boolean') {
      updateData.isFavorite = body.isFavorite
    }
    if (typeof body.readCount === 'number') {
      updateData.readCount = body.readCount
    }
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update' },
        { status: 400 }
      )
    }

    const book = await prisma.book.update({
      where: { id },
      data: updateData
    })

    return NextResponse.json({
      ...book,
      author: safeJsonParse(book.authorJson),
      categories: safeJsonParse(book.categoriesJson),
      interactionSuggestions: safeJsonParse(book.interactionSuggestionsJson),
      sourceRefs: safeJsonParse(book.sourceRefsJson),
    })
  } catch (error) {
    console.error('Error updating book:', error)
    return NextResponse.json(
      { error: 'Failed to update book' },
      { status: 500 }
    )
  }
}
