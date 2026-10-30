import { NextResponse } from "next/server";
import { GROWDESK_CONFIG } from "@/lib/config";
import { verifyBffCsrf } from "@/lib/growdesk/csrf";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireAuth } from "@/lib/api-helpers";
import { resolveBffSession } from "@/lib/growdesk/session";
import { withLlmFeature, type LlmFeature } from "@/lib/llm-context";
import { actualLlmModel, withLlmProvenance } from "@/lib/llm-provenance";

/** Resolve trusted ownership before selecting a feature's stored configuration. */
export function llmRoute(feature: LlmFeature, handler: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    try {
      let owner: string;
      let accessToken: string | undefined;
      if (GROWDESK_CONFIG.enabled) {
        if (request.headers.get("sec-fetch-site") === "cross-site") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        if (!["GET", "HEAD"].includes(request.method)) {
          const denied = verifyBffCsrf(request, { enforceInTest: true });
          if (denied) return denied;
        }
        const session = await resolveBffSession(request);
        if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 });
        owner = session.user.id; accessToken = session.accessToken;
      } else {
        const auth = await requireAuth(request);
        if (auth.errorResponse) return auth.errorResponse;
        owner = auth.user.id;
      }
      const rate = checkRateLimit(`llm-feature:${owner}:${feature}`, 30, 60_000);
      if (!rate.success) return NextResponse.json({ error: "请求过于频繁，请稍后重试" }, { status: 429, headers: { "Retry-After": String(rate.resetSeconds) } });
      const work = () => withLlmProvenance(async () => {
        const response = await handler(request);
        const info = actualLlmModel();
        const headers = new Headers(response.headers);
        headers.set("Cache-Control", "no-store");
        // Header values are ASCII; JSON retains the original model spelling.
        headers.set("X-LLM-Model", info ? encodeURIComponent(info.model) : "none");
        if (info) headers.set("X-LLM-Provider", encodeURIComponent(info.provider));
        if (!response.headers.get("content-type")?.includes("application/json")) {
          return new Response(response.body, { status: response.status, headers });
        }
        const payload: unknown = await response.json();
        if (payload && typeof payload === "object" && !Array.isArray(payload)) {
          // Cached artifacts carry their original provenance, never today's selection.
          const value = payload as Record<string, unknown>;
          const summary = value.summary;
          const cachedInfo = summary && typeof summary === "object" && "llm" in summary ? summary.llm : undefined;
          const label = cachedInfo === undefined ? info : cachedInfo;
          if (label && typeof label === "object" && "model" in label && typeof label.model === "string") {
            headers.set("X-LLM-Model", encodeURIComponent(label.model));
            if ("provider" in label && typeof label.provider === "string") headers.set("X-LLM-Provider", encodeURIComponent(label.provider));
          }
          return new Response(JSON.stringify({ ...value, llm: cachedInfo === undefined ? info : cachedInfo }), { status: response.status, headers });
        }
        return new Response(JSON.stringify(payload), { status: response.status, headers });
      });
      let started = false;
      try {
        return await withLlmFeature(owner, feature, accessToken, () => { started = true; return work(); });
      } catch (error) {
        // This GET only reads cached summaries or computes deterministic statistics.
        // A removed AI profile must not prevent access to those ordinary records.
        if (!started && feature === "daily_summary" && request.method === "GET") return work();
        throw error;
      }
    } catch (error) {
      console.error("[LLM feature] Configuration or execution unavailable", error instanceof Error ? error.name : "Error");
      return NextResponse.json({ error: "此功能的模型配置不可用，请检查并重新保存配置" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  };
}
