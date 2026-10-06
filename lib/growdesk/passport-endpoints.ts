import {
  BridgeError,
  bridgeErrorResponse,
  requireData,
  type BridgeFetch,
} from "./bridge-protocol";
import {
  isRecordLike,
  isUuid,
  parsePassportClaimInput,
  parsePassportListQuery,
  passportDeviceId,
  toPassportDeviceSummary,
} from "./passport-bridge";

const MAX_CLAIM_BODY_BYTES = 8 * 1024;
const NO_STORE = { "cache-control": "no-store" };

export interface PassportBffSession {
  accessToken: string;
  user: { id: string };
}

export interface PassportEndpointDependencies {
  isAvailable(): boolean;
  resolveSession(request: Request): Promise<PassportBffSession | null>;
  fetchApi: BridgeFetch;
  loadBaby?(fetchApi: BridgeFetch, accessToken: string, babyId: string): Promise<{ id: string; familyId?: string | null } | null>;
  verifyCsrf(request: Request, options: { enforceInTest: true }): Response | null;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function withNoStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function unavailable(): Response {
  return json({
    error: "Passport 配对管理仅在已启用的 GrowDesk Go 后端中可用。",
    code: "PASSPORT_BFF_NOT_AVAILABLE",
  }, 501);
}

function unauthorized(): Response {
  return json({ error: "请先登录后再管理 Passport 设备。", code: "UNAUTHENTICATED" }, 401);
}

function requireCsrf(request: Request, deps: PassportEndpointDependencies): Response | null {
  const response = deps.verifyCsrf(request, { enforceInTest: true });
  return response ? withNoStore(response) : null;
}

async function readClaimJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new BridgeError(400, "INVALID_JSON", "请求必须使用 application/json");
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_CLAIM_BODY_BYTES) {
      throw new BridgeError(400, "INVALID_JSON", "请求 JSON 无效或过大");
    }
  }

  const reader = request.body?.getReader();
  if (!reader) throw new BridgeError(400, "INVALID_JSON", "请求 JSON 无效");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_CLAIM_BODY_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new BridgeError(400, "INVALID_JSON", "请求 JSON 无效或过大");
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return JSON.parse(text) as unknown;
    } catch {
      throw new BridgeError(400, "INVALID_JSON", "请求 JSON 无效");
    }
  } finally {
    reader.releaseLock();
  }
}

async function requireSession(
  request: Request,
  deps: PassportEndpointDependencies,
): Promise<PassportBffSession | null> {
  const session = await deps.resolveSession(request);
  if (!session || typeof session.accessToken !== "string" || !session.accessToken ||
      typeof session.user?.id !== "string" || !session.user.id) {
    return null;
  }
  return session;
}

function responseForError(error: unknown): Response {
  return withNoStore(bridgeErrorResponse(error));
}

export function createPassportEndpoints(deps: PassportEndpointDependencies) {
  return {
    async claim(request: Request): Promise<Response> {
      try {
        if (!deps.isAvailable()) return unavailable();
        const csrfError = requireCsrf(request, deps);
        if (csrfError) return csrfError;

        const session = await requireSession(request, deps);
        if (!session) return unauthorized();
        const input = parsePassportClaimInput(await readClaimJson(request));

        // Baby scope is derived from the authenticated API read, never from the browser body.
        if (!deps.loadBaby) {
          throw new BridgeError(500, "PASSPORT_BFF_CONFIGURATION_ERROR", "Passport 宝宝授权读取未配置");
        }
        const baby = await deps.loadBaby(deps.fetchApi, session.accessToken, input.babyId);
        if (!baby || baby.id !== input.babyId || !isUuid(baby.familyId)) {
          throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", "GrowDesk 返回的宝宝授权范围无效");
        }

        const body = {
          pairCode: input.pairCode,
          familyId: baby.familyId,
          babyId: baby.id,
          ...(input.deviceLabel === undefined ? {} : { deviceLabel: input.deviceLabel }),
        };
        const data = requireData(await deps.fetchApi<unknown>("/api/v1/passport/pairings/claim", {
          method: "POST",
          accessToken: session.accessToken,
          body,
        }));
        if (!isRecordLike(data) || !isUuid(data.pairingId) || data.status !== "claimed") {
          throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", "GrowDesk 返回了无效的 Passport 配对结果");
        }
        return json({ data: { pairingId: data.pairingId, status: "claimed" } });
      } catch (error) {
        return responseForError(error);
      }
    },

    async listDevices(request: Request): Promise<Response> {
      try {
        if (!deps.isAvailable()) return unavailable();
        const session = await requireSession(request, deps);
        if (!session) return unauthorized();

        const query = parsePassportListQuery(request.url);
        const params = new URLSearchParams();
        if (query.cursor !== undefined) params.set("cursor", query.cursor);
        if (query.limit !== undefined) params.set("limit", String(query.limit));
        const suffix = params.size ? `?${params.toString()}` : "";
        const result = await deps.fetchApi<unknown[]>(`/api/v1/passport/devices${suffix}`, {
          accessToken: session.accessToken,
        });
        const records = requireData(result);
        if (!Array.isArray(records)) {
          throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", "GrowDesk 返回了无效的 Passport 设备列表");
        }
        return json({
          data: records.map(toPassportDeviceSummary),
          page: { nextCursor: result.page?.nextCursor ?? null },
        });
      } catch (error) {
        return responseForError(error);
      }
    },

    async revokeDevice(request: Request, rawId: unknown): Promise<Response> {
      try {
        if (!deps.isAvailable()) return unavailable();
        const csrfError = requireCsrf(request, deps);
        if (csrfError) return csrfError;
        const id = passportDeviceId(rawId);

        const session = await requireSession(request, deps);
        if (!session) return unauthorized();
        const result = requireData(await deps.fetchApi<unknown>(`/api/v1/passport/devices/${encodeURIComponent(id)}`, {
          method: "DELETE",
          accessToken: session.accessToken,
        }));
        if (!isRecordLike(result) || result.success !== true) {
          throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", "GrowDesk 返回了无效的设备撤销结果");
        }
        return json({ success: true });
      } catch (error) {
        return responseForError(error);
      }
    },
  };
}
