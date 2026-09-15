import { NextResponse } from "next/server";
import { GROWDESK_CONFIG } from "@/lib/config";
import { growdeskIdentityEndpoints } from "@/lib/growdesk/identity-endpoints";

export async function POST(request: Request) {
  if (!GROWDESK_CONFIG.enabled) {
    return NextResponse.json({ error: "家庭邀请功能未启用" }, { status: 404 });
  }
  return growdeskIdentityEndpoints.familyInvite(request);
}
