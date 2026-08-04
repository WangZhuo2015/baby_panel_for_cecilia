import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const records = await prisma.diaperRecord.findMany({
      orderBy: { timestamp: "desc" },
    });

    return NextResponse.json(records);
  } catch (error) {
    console.error("GET /api/records/diaper error:", error);
    return NextResponse.json(
      { error: "Failed to fetch diaper records" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { timestamp, type, poopColor, poopConsistency, notes } = body;

    const record = await prisma.diaperRecord.create({
      data: {
        timestamp,
        type,
        poopColor: poopColor ?? null,
        poopConsistency: poopConsistency ?? null,
        notes: notes ?? null,
      },
    });

    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    console.error("POST /api/records/diaper error:", error);
    return NextResponse.json(
      { error: "Failed to create diaper record" },
      { status: 500 }
    );
  }
}
