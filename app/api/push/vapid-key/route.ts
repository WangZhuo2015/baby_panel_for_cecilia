import { NextResponse } from "next/server";
import { PUSH_CONFIG } from "@/lib/config";

export async function GET() {
  const publicKey = PUSH_CONFIG.publicKey;

  if (!publicKey) {
    return NextResponse.json(
      { error: "VAPID keys not configured" },
      { status: 500 }
    );
  }

  return NextResponse.json({ publicKey });
}
