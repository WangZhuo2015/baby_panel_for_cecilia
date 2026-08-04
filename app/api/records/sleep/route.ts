import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const records = await prisma.sleepRecord.findMany({
      orderBy: { startTime: "desc" },
    });

    return NextResponse.json(records);
  } catch (error) {
    console.error("GET /api/records/sleep error:", error);
    return NextResponse.json(
      { error: "Failed to fetch sleep records" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { startTime, endTime, type, nightWakingCount, notes } = body;

    const record = await prisma.sleepRecord.create({
      data: {
        startTime,
        endTime,
        type,
        nightWakingCount: nightWakingCount ?? 0,
        notes: notes ?? null,
      },
    });

    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    console.error("POST /api/records/sleep error:", error);
    return NextResponse.json(
      { error: "Failed to create sleep record" },
      { status: 500 }
    );
  }
}
