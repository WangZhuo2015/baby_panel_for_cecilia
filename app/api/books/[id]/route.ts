import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, getActiveBabyForUser } from '@/lib/auth'

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

    const user = await getAuthSession(request)
    let familyId: string | undefined
    if (user) {
      const active = await getActiveBabyForUser(user.id)
      familyId = active?.family?.id
    }

    if (!familyId) {
      const defaultFamily = await prisma.family.findFirst()
      familyId = defaultFamily?.id
    }

    const book = await prisma.book.findFirst({
      where: {
        OR: [{ id }, { bookId: id }]
      }
    })

    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 })
    }

    let isFavorite = false
    let readCount = 0

    if (familyId) {
      const existingStatus = await prisma.familyBookStatus.findUnique({
        where: {
          familyId_bookId: {
            familyId,
            bookId: book.bookId,
          }
        }
      })

      isFavorite = typeof body.isFavorite === 'boolean'
        ? body.isFavorite
        : existingStatus?.isFavorite ?? false

      readCount = typeof body.readCount === 'number'
        ? body.readCount
        : existingStatus?.readCount ?? 0

      await prisma.familyBookStatus.upsert({
        where: {
          familyId_bookId: {
            familyId,
            bookId: book.bookId,
          }
        },
        update: { isFavorite, readCount },
        create: {
          familyId,
          bookId: book.bookId,
          isFavorite,
          readCount,
        }
      })
    }

    return NextResponse.json({
      ...book,
      isFavorite,
      readCount,
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
