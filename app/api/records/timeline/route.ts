import { NextResponse } from "next/server";
import { requireAuth, requireBaby } from "@/lib/api-helpers";
import * as records from "@/lib/records/service";
import { ValidationError } from "@/lib/records/service";

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get("date");
    const babyResult = await requireBaby(auth.user.id, searchParams.get("babyId"));
    if (babyResult.errorResponse) return babyResult.errorResponse;
    const ctx = { userId: auth.user.id, babyId: babyResult.baby.id, baby: babyResult.baby, familyId: babyResult.family.id };
    const data = await records.getTimeline(ctx, dateParam || undefined);
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("GET /api/records/timeline error:", e);
    return NextResponse.json({ error: "Failed to fetch timeline" }, { status: 500 });
  }
}
