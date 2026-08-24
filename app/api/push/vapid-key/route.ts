import { NextResponse } from "next/server";
import { PUSH_CONFIG } from "@/lib/config";
import { requireAuth } from "@/lib/api-helpers";

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth.errorResponse) return auth.errorResponse;

  const publicKey = PUSH_CONFIG.publicKey;
  if (!publicKey) {
    return NextResponse.json(
      { error: "VAPID keys not configured" },
      { status: 500 }
    );
  }

  return NextResponse.json({ publicKey });
}

