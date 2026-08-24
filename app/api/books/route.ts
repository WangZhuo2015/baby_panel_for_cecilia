import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, getActiveBaby } from "@/lib/api-helpers";
import { safeJsonParse } from "@/lib/json";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tab = searchParams.get("tab"); // all, read or favorites

  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const active = await getActiveBaby(user.id);
    const familyId = active.family?.id;

    const books = await prisma.book.findMany({
      orderBy: { title: "asc" },
    });

    const familyStatuses = familyId
      ? await prisma.familyBookStatus.findMany({
          where: { familyId },
        })
      : [];

    const statusMap = new Map(familyStatuses.map((s) => [s.bookId, s]));

    const parsed = books.map((b) => {
      const customStatus = statusMap.get(b.bookId) || statusMap.get(b.id);
      return {
        ...b,
        isFavorite: customStatus?.isFavorite ?? false,
        readCount: customStatus?.readCount ?? 0,
        author: safeJsonParse(b.authorJson, []),
        categories: safeJsonParse(b.categoriesJson, []),
        interactionSuggestions: safeJsonParse(b.interactionSuggestionsJson, []),
        sourceRefs: safeJsonParse(b.sourceRefsJson, []),
      };
    });

    let filtered = parsed;
    if (tab === "favorites") {
      filtered = parsed.filter((b) => b.isFavorite);
    } else if (tab === "read") {
      filtered = parsed.filter((b) => b.readCount > 0);
    }

    return NextResponse.json(filtered);
  } catch (error) {
    console.error("Error fetching books:", error);
    return NextResponse.json(
      { error: "Failed to fetch books" },
      { status: 500 }
    );
  }
}
