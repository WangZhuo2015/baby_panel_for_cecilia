import { createHash } from "node:crypto";
import type { EndpointDependencies, WebSession } from "./bridge-endpoints";
import { BridgeError, bridgeErrorResponse, pathId, requireData, type BridgeFetch } from "./bridge-protocol";
import { getGrowDeskVoiceLog } from "./voice-log-api";

interface CompanionDependencies extends Pick<EndpointDependencies, "fetchApi" | "resolveSession" | "verifyCsrf"> {
  publicPushKey: () => string;
}

function json(value: unknown): Response {
  return Response.json(value, { headers: { "cache-control": "no-store" } });
}

async function objectBody(request: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  try { value = await request.json(); } catch {
    throw new BridgeError(400, "INVALID_JSON", "请求正文必须是 JSON 对象");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BridgeError(400, "INVALID_JSON", "请求正文必须是 JSON 对象");
  }
  return value as Record<string, unknown>;
}

function pushEndpoint(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4096) {
    throw new BridgeError(400, "INVALID_PUSH_SUBSCRIPTION", "必须提供有效的推送 endpoint");
  }
  const endpoint = value.trim();
  let url: URL;
  try { url = new URL(endpoint); } catch {
    throw new BridgeError(400, "INVALID_PUSH_SUBSCRIPTION", "推送 endpoint 格式不合法");
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.hash) {
    throw new BridgeError(400, "INVALID_PUSH_SUBSCRIPTION", "推送 endpoint 必须为 HTTPS 地址");
  }
  // The opaque endpoint is stored, never fetched by this BFF.
  return endpoint;
}

function pushKey(value: unknown, length: number): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+={0,2}$/.test(value) || value.length > 100) {
    throw new BridgeError(400, "INVALID_PUSH_SUBSCRIPTION", "推送加密密钥格式不合法");
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== length || bytes.toString("base64url") !== value.replace(/=+$/, "") ||
    (length === 65 && bytes[0] !== 4)) {
    throw new BridgeError(400, "INVALID_PUSH_SUBSCRIPTION", "推送加密密钥长度不合法");
  }
  return bytes.toString("base64url");
}

function installationId(endpoint: string): string {
  // Keep the existing ID derivation so old endpoint-only registrations can be
  // upgraded/revoked, rather than leaving an unreachable second device row.
  return createHash("sha256").update(endpoint).digest("hex").slice(0, 32);
}

function success(value: unknown): void {
  if (!value || typeof value !== "object" || (value as { success?: unknown }).success !== true) {
    throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", "GrowDesk 未确认操作成功");
  }
}

export function createCompanionEndpoints(deps: CompanionDependencies) {
  async function handle(
    request: Request,
    mutate: boolean,
    action: (session: WebSession, fetchApi: BridgeFetch) => Promise<Response>,
  ): Promise<Response> {
    try {
      if (mutate) {
        const rejected = deps.verifyCsrf(request);
        if (rejected) return rejected;
      }
      const session = await deps.resolveSession(request);
      if (!session) throw new BridgeError(401, "UNAUTHORIZED", "会话无效或已过期");
      // Preserve request cancellation without forwarding untrusted browser headers.
      const fetchApi: BridgeFetch = (path, options) =>
        deps.fetchApi(path, { ...options, signal: request.signal });
      return await action(session, fetchApi);
    } catch (error) { return bridgeErrorResponse(error); }
  }

  return {
    pushPublicKey(request: Request) {
      return handle(request, false, async () => {
        const publicKey = deps.publicPushKey();
        if (!publicKey) throw new BridgeError(503, "PUSH_NOT_CONFIGURED", "未配置推送公钥");
        return json({ publicKey });
      });
    },
    subscribe(request: Request) {
      return handle(request, true, async (session, fetchApi) => {
        const body = await objectBody(request);
        const endpoint = pushEndpoint(body.endpoint);
        if (!body.keys || typeof body.keys !== "object" || Array.isArray(body.keys)) {
          throw new BridgeError(400, "INVALID_PUSH_SUBSCRIPTION", "必须提供推送加密密钥");
        }
        const keys = body.keys as Record<string, unknown>;
        const subscription = {
          endpoint,
          keys: { p256dh: pushKey(keys.p256dh, 65), auth: pushKey(keys.auth, 16) },
        };
        const id = installationId(endpoint);
        success(requireData(await fetchApi(`/api/v1/devices/${id}/push`, {
          method: "PUT", accessToken: session.accessToken,
          // Canonical token is a string. Store the complete Web Push subscription,
          // not just the endpoint: delivery needs both encryption keys.
          body: { token: JSON.stringify(subscription), platform: "web", environment: "production" },
        })));
        return json({ success: true, id });
      });
    },
    unsubscribe(request: Request) {
      return handle(request, true, async (session, fetchApi) => {
        const body = await objectBody(request);
        const id = installationId(pushEndpoint(body.endpoint));
        success(requireData(await fetchApi(`/api/v1/devices/${id}/push`, {
          method: "DELETE", accessToken: session.accessToken,
        })));
        return json({ success: true });
      });
    },
    readNotification(request: Request, id: string) {
      return handle(request, true, async (session, fetchApi) => {
        success(requireData(await fetchApi(`/api/v1/notifications/${pathId(id)}/read`, {
          method: "POST", accessToken: session.accessToken,
        })));
        return json({ success: true });
      });
    },
    getVoiceLog(request: Request, id: string) {
      return handle(request, false, async (session, fetchApi) => {
        const log = await getGrowDeskVoiceLog(fetchApi, session.accessToken, id);
        if (log.userId !== session.user.id || log.id !== id ||
            (log.baby && log.baby.id !== log.babyId)) {
          throw new BridgeError(502, "UPSTREAM_SCOPE_MISMATCH", "语音记录归属不一致");
        }
        return json({ success: true, log });
      });
    },
    acknowledgeVoiceLog(request: Request, id: string) {
      return handle(request, true, async (session, fetchApi) => {
        const body = await objectBody(request);
        const raw = body.acknowledged;
        if (raw !== true && raw !== false && raw !== "true" && raw !== "false") {
          throw new BridgeError(400, "INVALID_ACKNOWLEDGEMENT", "acknowledged 必须是布尔值");
        }
        success(requireData(await fetchApi(`/api/v1/voice/logs/${pathId(id)}`, {
          method: "PATCH", accessToken: session.accessToken,
          body: { acknowledged: raw === true || raw === "true" },
        })));
        return json({ success: true });
      });
    },
  };
}
