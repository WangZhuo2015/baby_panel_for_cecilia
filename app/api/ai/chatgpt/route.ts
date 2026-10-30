import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-helpers";
import { getChatGPTPlan, planErrorMessage, ChatGPTPlanError } from "@/lib/chatgpt-plan";
import { checkRateLimit } from "@/lib/rate-limit";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function owner(request: Request) {
  // Cookie mutations require an exact same-origin browser request, including ports.
  if (request.method === "POST") {
    const origin = request.headers.get("origin");
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
    if (!origin || !host || new URL(origin).host !== host || request.headers.get("content-type")?.split(";")[0] !== "application/json")
      return { errorResponse: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  if (GROWDESK_CONFIG.enabled) {
    const session = await resolveBffSession(request);
    return session ? { user: session.user } : { errorResponse: NextResponse.json({ error: "请先登录" }, { status: 401 }) };
  }
  return requireAuth(request);
}
function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof ChatGPTPlanError ? error.code : "chatgpt_unavailable", message: planErrorMessage(error) }, { status: 400, headers: { "Cache-Control": "no-store" } });
}
export async function GET(request: Request) {
  try {
    const auth = await owner(request); if (auth.errorResponse) return auth.errorResponse;
    const plan = getChatGPTPlan(), url = new URL(request.url), profileId = url.searchParams.get("profile_id");
    return NextResponse.json(profileId ? { models: await plan.models(auth.user!.id, profileId) } : plan.status(auth.user!.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const auth = await owner(request); if (auth.errorResponse) return auth.errorResponse;
    const userId = auth.user!.id;
    if (!checkRateLimit("chatgpt-connect:" + userId, 12, 60000).success) return NextResponse.json({ error: "连接过于频繁，请稍后重试" }, { status: 429 });
    const raw = await request.text();
    if (raw.length > 2048) return NextResponse.json({ error: "请求过大" }, { status: 413 });
    const body = JSON.parse(raw);
    if (!body || !["connect", "disconnect"].includes(body.action) || body.profile_id !== undefined && (typeof body.profile_id !== "string" || body.profile_id.length > 64)) return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
    const plan = getChatGPTPlan();
    const result = body.action === "connect"
      ? await plan.start(userId, { profileId: body.profile_id })
      : await plan.disconnect(userId, body.profile_id);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
