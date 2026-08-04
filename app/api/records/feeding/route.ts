import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");

    const where = date
      ? {
          timestamp: {
            startsWith: date,
          },
        }
      : {};

    const records = await prisma.feedingRecord.findMany({
      where,
      orderBy: { timestamp: "desc" },
    });

    return NextResponse.json(records);
  } catch (error) {
    console.error("GET /api/records/feeding error:", error);
    return NextResponse.json(
      { error: "Failed to fetch feeding records" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { timestamp, type, amountMl, leftMinutes, rightMinutes, spitUp, notes } = body;

    const record = await prisma.feedingRecord.create({
      data: {
        timestamp,
        type,
        amountMl: amountMl ?? null,
        leftMinutes: leftMinutes ?? null,
        rightMinutes: rightMinutes ?? null,
        spitUp: spitUp ?? false,
        notes: notes ?? null,
      },
    });

    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    console.error("POST /api/records/feeding error:", error);
    return NextResponse.json(
      { error: "Failed to create feeding record" },
      { status: 500 }
    );
  }
}
