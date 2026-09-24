import { NextResponse } from "next/server";
import { GROWDESK_CONFIG } from "@/lib/config";
import { growdeskIdentityEndpoints } from "@/lib/growdesk/identity-endpoints";

function unsupportedForLegacy() {
  return NextResponse.json(
    { supported: false, babyId: null, members: [] },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}

function unavailableMutation() {
  return NextResponse.json(
    { error: "宝宝成员授权仅在 GrowDesk 模式可用" },
    { status: 501, headers: { "cache-control": "no-store" } },
  );
}

export async function GET(request: Request) {
  return GROWDESK_CONFIG.enabled ? growdeskIdentityEndpoints.babyMembers(request) : unsupportedForLegacy();
}

export async function POST(request: Request) {
  return GROWDESK_CONFIG.enabled ? growdeskIdentityEndpoints.babyMembers(request) : unavailableMutation();
}

export async function DELETE(request: Request) {
  return GROWDESK_CONFIG.enabled ? growdeskIdentityEndpoints.babyMembers(request) : unavailableMutation();
}
