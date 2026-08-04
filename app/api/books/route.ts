import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const safeJsonParse = (str: string | null | undefined, fallback: any = []) => {
  try { return str ? JSON.parse(str) : fallback } catch { return fallback }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tab = searchParams.get('tab') // all, read or favorites

  try {
    const where: any = {}
    if (tab === 'favorites') {
      where.isFavorite = true
    }
    if (tab === 'read') {
      where.readCount = { gt: 0 }
    }

    const books = await prisma.book.findMany({
      where,
      orderBy: { title: 'asc' }
    })

    const parsed = books.map(b => ({
      ...b,
      author: safeJsonParse(b.authorJson),
      categories: safeJsonParse(b.categoriesJson),
      interactionSuggestions: safeJsonParse(b.interactionSuggestionsJson),
      sourceRefs: safeJsonParse(b.sourceRefsJson),
    }))

    return NextResponse.json(parsed)
  } catch (error) {
    console.error('Error fetching books:', error)
    return NextResponse.json(
      { error: 'Failed to fetch books' },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json()

    const updateData: any = {}
    if (body.readCount !== undefined) {
      updateData.readCount = body.readCount
    }
    if (body.isFavorite !== undefined) {
      updateData.isFavorite = body.isFavorite
    }

    // Support both id and bookId for lookup
    const book = await prisma.book.update({
      where: body.bookId ? { bookId: body.bookId } : { id: body.id },
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
