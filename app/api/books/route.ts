import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, getActiveBabyForUser } from '@/lib/auth'

const safeJsonParse = (str: string | null | undefined, fallback: any = []) => {
  try { return str ? JSON.parse(str) : fallback } catch { return fallback }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tab = searchParams.get('tab') // all, read or favorites

  try {
    const user = await getAuthSession(request)
    let familyId: string | undefined
    if (user) {
      const active = await getActiveBabyForUser(user.id)
      familyId = active?.family?.id
    }

    const books = await prisma.book.findMany({
      orderBy: { title: 'asc' }
    })

    const familyStatuses = familyId
      ? await prisma.familyBookStatus.findMany({
          where: { familyId }
        })
      : []

    const statusMap = new Map(familyStatuses.map(s => [s.bookId, s]))

    const parsed = books.map(b => {
      const customStatus = statusMap.get(b.bookId) || statusMap.get(b.id)
      return {
        ...b,
        isFavorite: customStatus?.isFavorite ?? false,
        readCount: customStatus?.readCount ?? 0,
        author: safeJsonParse(b.authorJson),
        categories: safeJsonParse(b.categoriesJson),
        interactionSuggestions: safeJsonParse(b.interactionSuggestionsJson),
        sourceRefs: safeJsonParse(b.sourceRefsJson),
      }
    })

    let filtered = parsed
    if (tab === 'favorites') {
      filtered = parsed.filter(b => b.isFavorite)
    } else if (tab === 'read') {
      filtered = parsed.filter(b => b.readCount > 0)
    }

    return NextResponse.json(filtered)
  } catch (error) {
    console.error('Error fetching books:', error)
    return NextResponse.json(
      { error: 'Failed to fetch books' },
      { status: 500 }
    )
  }
}
