import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tab = searchParams.get("tab");

    let where: Record<string, unknown> | undefined;

    if (tab === "read") {
      where = { readCount: { gt: 0 } };
    } else if (tab === "favorites") {
      where = { isFavorite: true };
    }
    // tab === "all" or no tab → no filter

    const books = await prisma.book.findMany({
      where,
      orderBy: { title: "asc" },
    });

    return NextResponse.json(books);
  } catch (error) {
    console.error("GET /api/books error:", error);
    return NextResponse.json(
      { error: "Failed to fetch books" },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { id, isFavorite, readCount } = body;

    if (!id) {
      return NextResponse.json(
        { error: "id is required" },
        { status: 400 }
      );
    }

    const data: Record<string, unknown> = {};
    if (isFavorite !== undefined) data.isFavorite = isFavorite;
    if (readCount !== undefined) data.readCount = readCount;

    const book = await prisma.book.update({
      where: { id },
      data,
    });

    return NextResponse.json(book);
  } catch (error) {
    console.error("PUT /api/books error:", error);
    return NextResponse.json(
      { error: "Failed to update book" },
      { status: 500 }
    );
  }
}
