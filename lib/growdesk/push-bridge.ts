import { createHash, ECDH } from "node:crypto";
import { BridgeError, bridgeErrorResponse, requireData } from "./bridge-protocol";
import type { EndpointDependencies } from "./bridge-endpoints";

interface WebPushSubscription {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
}

type Dependencies = Pick<EndpointDependencies, "fetchApi" | "resolveSession" | "verifyCsrf">;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function invalid(message: string): never {
  throw new BridgeError(400, "INVALID_PUSH_SUBSCRIPTION", message);
}

function endpointOf(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096) invalid("推送地址无效");
  const endpoint = value.trim();
  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password || parsed.hash) {
      invalid("推送地址必须为不含凭证的 HTTPS URL");
    }
  } catch {
    invalid("推送地址必须为有效的 HTTPS URL");
  }
  return endpoint;
}

function keyOf(value: unknown, size: number): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+={0,2}$/.test(value) || value.length > 128) {
    invalid("推送加密密钥格式错误");
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== size || bytes.toString("base64url") !== value.replace(/=+$/, "")) {
    invalid("推送加密密钥长度或编码错误");
  }
  if (size === 65) {
    if (bytes[0] !== 4) invalid("推送公钥格式错误");
    try { ECDH.convertKey(bytes, "prime256v1"); }
    catch { invalid("推送公钥不是有效的 P-256 公钥"); }
  }
  return bytes.toString("base64url");
}

export function nativePushSubscription(value: unknown): WebPushSubscription {
  const body = object(value);
  const keys = object(body?.keys);
  if (!body || !keys) invalid("必须提供 endpoint 和 keys");
  const expiration = body.expirationTime;
  if (expiration !== undefined && expiration !== null && (
    typeof expiration !== "number" || !Number.isFinite(expiration) || expiration < 0
  )) invalid("推送订阅过期时间无效");
  return {
    endpoint: endpointOf(body.endpoint),
    expirationTime: typeof expiration === "number" ? expiration : null,
    keys: { p256dh: keyOf(keys.p256dh, 65), auth: keyOf(keys.auth, 16) },
  };
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) invalid("请求正文必须是 JSON 对象");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > 8192) {
        await reader.cancel();
        throw new BridgeError(413, "PUSH_SUBSCRIPTION_TOO_LARGE", "推送订阅不能超过 8 KB");
      }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  try {
    const result = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))));
    if (!result) invalid("请求正文必须是 JSON 对象");
    return result;
  } catch { invalid("请求正文必须是有效的 JSON 对象"); }
}

/** Preserve the browser subscription, not just its URL: WebPush needs both keys. */
export function createNativePushEndpoints(deps: Dependencies) {
  async function handle(request: Request): Promise<Response> {
    try {
      const csrf = deps.verifyCsrf(request);
      if (csrf) return csrf;
      const session = await deps.resolveSession(request);
      if (!session) throw new BridgeError(401, "UNAUTHORIZED", "请先登录");
      const body = await readBody(request);
      const subscription = request.method === "POST" ? nativePushSubscription(body) : null;
      const endpoint = subscription?.endpoint ?? endpointOf(body.endpoint);
      // Stable across key rotation, and compatible with previously registered devices.
      const installationId = createHash("sha256").update(endpoint).digest("hex").slice(0, 32);
      const response = requireData(await deps.fetchApi<{ success: boolean }>(
        `/api/v1/devices/${installationId}/push`, {
          method: subscription ? "PUT" : "DELETE",
          accessToken: session.accessToken,
          ...(subscription ? { body: {
            platform: "web", environment: "production", deviceLabel: "Baby Panel Web",
            token: JSON.stringify(subscription),
          } } : {}),
        },
      ));
      if (response?.success !== true) throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", "服务端未确认推送订阅操作");
      return Response.json({ success: true, ...(subscription ? { id: installationId } : {}) }, {
        headers: { "cache-control": "no-store" },
      });
    } catch (error) { return bridgeErrorResponse(error); }
  }
  return { POST: handle, DELETE: handle };
}
