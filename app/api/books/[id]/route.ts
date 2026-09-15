import { GROWDESK_CONFIG } from "@/lib/config";
import { bookBridge } from "@/lib/growdesk/book-bridge";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, getActiveBaby } from "@/lib/api-helpers";
import { safeJsonParse } from "@/lib/json";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (GROWDESK_CONFIG.enabled) return bookBridge(request, (await params).id);
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const active = await getActiveBaby(user.id);
    const familyId = active.family?.id;

    if (!familyId) {
      return NextResponse.json(
        { error: "未找到家庭档案，请先初始化宝宝及家庭信息" },
        { status: 400 }
      );
    }

    const book = await prisma.book.findFirst({
      where: {
        OR: [{ id }, { bookId: id }],
      },
    });

    if (!book) {
      return NextResponse.json({ error: "Book not found" }, { status: 404 });
    }

    const existingStatus = await prisma.familyBookStatus.findUnique({
      where: {
        familyId_bookId: {
          familyId,
          bookId: book.bookId,
        },
      },
    });

    const isFavorite = typeof body.isFavorite === "boolean"
      ? body.isFavorite
      : existingStatus?.isFavorite ?? false;

    const readCount = typeof body.readCount === "number"
      ? body.readCount
      : existingStatus?.readCount ?? 0;

    await prisma.familyBookStatus.upsert({
      where: {
        familyId_bookId: {
          familyId,
          bookId: book.bookId,
        },
      },
      update: { isFavorite, readCount },
      create: {
        familyId,
        bookId: book.bookId,
        isFavorite,
        readCount,
      },
    });

    return NextResponse.json({
      ...book,
      isFavorite,
      readCount,
      author: safeJsonParse(book.authorJson, []),
      categories: safeJsonParse(book.categoriesJson, []),
      interactionSuggestions: safeJsonParse(book.interactionSuggestionsJson, []),
      sourceRefs: safeJsonParse(book.sourceRefsJson, []),
    });
  } catch (error) {
    console.error("Error updating book:", error);
    return NextResponse.json(
      { error: "Failed to update book" },
      { status: 500 }
    );
  }
}
