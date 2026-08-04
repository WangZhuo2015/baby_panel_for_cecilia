import { NextResponse } from "next/server";
import { getAiTips } from "@/lib/ai-tips";

export async function GET() {
  const tips = await getAiTips();
  return NextResponse.json(tips);
}
