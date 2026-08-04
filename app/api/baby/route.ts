import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const baby = await prisma.baby.findFirst();
    return NextResponse.json(baby);
  } catch (error) {
    console.error("GET /api/baby error:", error);
    return NextResponse.json(
      { error: "Failed to fetch baby record" },
      { status: 500 }
    );
  }
}
