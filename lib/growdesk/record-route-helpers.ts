import crypto from "node:crypto";
import { BridgeError, pathId, requireData, type BridgeFetch, type BridgeResult } from "./bridge-protocol";
import type { LegacyRecordKind } from "./record-list";

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => ({}));
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new BridgeError(400, "INVALID_JSON_BODY", "请求体必须为 JSON 对象");
  }
  return body as Record<string, unknown>;
}

export function idempotencyKey(body: Record<string, unknown>, request: Request): string {
  const supplied = body.clientId ?? request.headers.get("idempotency-key");
  if (supplied === undefined || supplied === null || supplied === "") return crypto.randomUUID();
  if (typeof supplied !== "string" || supplied.length > 200) {
    throw new BridgeError(400, "INVALID_IDEMPOTENCY_KEY", "幂等键格式错误");
  }
  return supplied;
}

export function recordPath(kind: LegacyRecordKind, babyId: string, id?: string): string {
  const base = kind === "timeline"
    ? `/api/v1/babies/${pathId(babyId)}/timeline`
    : `/api/v1/babies/${pathId(babyId)}/records/${kind}`;
  return id === undefined ? base : `${base}/${pathId(id)}`;
}

export async function fetchRecordDetail<T extends { id?: unknown; babyId?: unknown }>(
  fetchApi: BridgeFetch,
  token: string,
  babyId: string,
  id: string,
  kind: Exclude<LegacyRecordKind, "timeline">,
): Promise<T> {
  const response = await fetchApi<T>(recordPath(kind, babyId, id), { accessToken: token });
  const data = requireData(response);
  if (data.id !== id || data.babyId !== babyId) {
    throw new BridgeError(502, "UPSTREAM_SCOPE_MISMATCH", "GrowDesk 返回的记录不属于当前宝宝");
  }
  return data;
}

export function requireWriteData<T>(response: BridgeResult<T>, message: string): T {
  if (!response.ok || response.data === undefined) {
    throw new BridgeError(response.ok ? 502 : response.status, response.error?.code || "UPSTREAM_WRITE_FAILED", response.error?.message || message, response.error?.details);
  }
  if (response.data === null) throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", message);
  return response.data;
}
