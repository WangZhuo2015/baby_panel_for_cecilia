import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-helpers";
import { listLlmBackends, resolveLlmBackendId } from "@/lib/agent";

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth.errorResponse) return auth.errorResponse;

  return NextResponse.json({
    default: resolveLlmBackendId(undefined),
    backends: listLlmBackends(),
  });
}
