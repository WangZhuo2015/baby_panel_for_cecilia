import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const vaccines = await prisma.vaccineRecord.findMany({
      orderBy: { scheduledDate: "asc" },
    });

    return NextResponse.json(vaccines);
  } catch (error) {
    console.error("GET /api/vaccines error:", error);
    return NextResponse.json(
      { error: "Failed to fetch vaccine records" },
      { status: 500 }
    );
  }
}
