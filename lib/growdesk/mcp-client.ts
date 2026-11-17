import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type { GrowDeskFetchOptions, GrowDeskResponse } from "./http-transport";

export type McpBridgeMethod = GrowDeskFetchOptions["method"] | "BATCH";
export interface McpGrowdeskFetchOptions extends Omit<GrowDeskFetchOptions, "method"> {
  method?: McpBridgeMethod;
}

export interface McpBridgeRequest {
  method: McpBridgeMethod;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface McpRequestContext {
  clientId: string;
  requestId: string;
}

const requestContext = new AsyncLocalStorage<McpRequestContext>();
const FORWARDED_HEADERS = new Map([
  ["if-match", "If-Match"],
  ["idempotency-key", "Idempotency-Key"],
  ["x-request-id", "X-Request-ID"],
]);
const WRITABLE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE", "BATCH"]);

function invalidBridgeRequest(): never {
  throw new TypeError("Invalid MCP bridge request path or method");
}

export function validateMcpBridgeRequest(method: string, pathname: string): void {
  if (!(["GET", "POST", "PUT", "PATCH", "DELETE", "BATCH"] as string[]).includes(method)) {
    invalidBridgeRequest();
  }
  if (
    !pathname.startsWith("/api/v1/") ||
    pathname.startsWith("//") ||
    /[\\#\u0000-\u0020\u007f]/.test(pathname) ||
    /^[a-z][a-z0-9+.-]*:/i.test(pathname)
  ) {
    invalidBridgeRequest();
  }
  let pathOnly: string;
  try { pathOnly = decodeURIComponent(pathname.split("?", 1)[0]!); }
  catch { invalidBridgeRequest(); }
  if (
    /[\\\u0000-\u0020\u007f]/.test(pathOnly!) ||
    /%(?:2f|5c)/i.test(pathname.split("?", 1)[0]!) ||
    pathOnly!.split("/").some((part, index) => part === "." || part === ".." || (index > 0 && part === ""))
  ) invalidBridgeRequest();
  if (method === "BATCH" && pathname !== "/api/v1/mcp/atomic-records") invalidBridgeRequest();
}

function requestIdPart(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  try { return JSON.stringify(value) ?? "unknown"; } catch { return "unknown"; }
}

export function withMcpRequestContext<T>(context: { clientId: string; requestId: unknown }, work: () => T): T {
  const clientId = context.clientId.trim();
  if (!clientId || clientId.length > 200) throw new TypeError("Invalid MCP client context");
  const requestId = requestIdPart(context.requestId);
  return requestContext.run({ clientId, requestId }, work);
}

function stableIdempotencyKey(context: McpRequestContext | undefined, explicit: string | undefined): string | undefined {
  if (!context) return explicit;
  const digest = createHash("sha256")
    .update(context.clientId)
    .update("\0")
    .update(context.requestId)
    .update("\0")
    .update(explicit ?? "")
    .digest("hex");
  return `mcp_${digest}`;
}

function allowedHeaders(options: Pick<GrowDeskFetchOptions, "headers">, idempotencyKey: string | undefined): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    const canonicalName = FORWARDED_HEADERS.get(name.toLowerCase());
    if (value === undefined || !canonicalName) continue;
    if (Object.hasOwn(result, canonicalName)) invalidBridgeRequest();
    result[canonicalName] = value;
  }
  const requestContextValue = requestContext.getStore();
  const requestId = requestContextValue?.requestId;
  if (requestId && requestId.length <= 200) result["X-Request-ID"] = requestId;
  if (idempotencyKey) result["Idempotency-Key"] = idempotencyKey;
  return Object.keys(result).length ? result : undefined;
}

function batchBodyWithStableKeys(body: unknown, context: McpRequestContext | undefined): unknown {
  if (!context || !body || typeof body !== "object" || Array.isArray(body)) return body;
  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.requests)) return body;
  return {
    ...record,
    requests: record.requests.map((rawRequest, index) => {
      if (!rawRequest || typeof rawRequest !== "object" || Array.isArray(rawRequest)) return rawRequest;
      const request = rawRequest as Record<string, unknown>;
      const path = typeof request.path === "string" ? request.path : "invalid";
      const method = typeof request.method === "string" ? request.method : "invalid";
      const itemKey = stableIdempotencyKey(context, `${index}:${method}:${path}`)!;
      const rawHeaders = request.headers && typeof request.headers === "object" && !Array.isArray(request.headers)
        ? request.headers as Record<string, unknown>
        : {};
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(rawHeaders)) {
        const canonicalName = FORWARDED_HEADERS.get(name.toLowerCase());
        if (typeof value === "string" && canonicalName) {
          if (Object.hasOwn(headers, canonicalName)) invalidBridgeRequest();
          headers[canonicalName] = value;
        }
      }
      headers["Idempotency-Key"] = itemKey;
      if (context.requestId.length <= 200) headers["X-Request-ID"] = context.requestId;
      return { ...request, headers };
    }),
  };
}

export type BaseGrowDeskFetch = <T>(path: string, options?: GrowDeskFetchOptions) => Promise<GrowDeskResponse<T>>;

/** Build the MCP-only adapter so its transport can be exercised without a live Go service. */
export function createMcpGrowdeskFetch(baseFetch?: BaseGrowDeskFetch) {
  return async function mcpGrowdeskFetch<T>(
    pathname: string,
    options: McpGrowdeskFetchOptions = {},
  ): Promise<GrowDeskResponse<T>> {
    const method = options.method ?? "GET";
    validateMcpBridgeRequest(method, pathname);
    if (!options.accessToken) {
      return {
        ok: false,
        status: 401,
        error: { code: "MCP_TOKEN_REQUIRED", message: "MCP access token is required" },
      };
    }
    const context = requestContext.getStore();
    const idempotencyKey = WRITABLE_METHODS.has(method)
      ? stableIdempotencyKey(context, options.idempotencyKey)
      : undefined;
    const bridgeBody = method === "BATCH" ? batchBodyWithStableKeys(options.body, context) : options.body;
    const topHeaders = method === "BATCH" ? undefined : allowedHeaders(options, idempotencyKey);
    const transport = baseFetch ?? (await import("./client")).growdeskFetch;
    const bridged = await transport<T>("/api/v1/mcp/bridge", {
      method: "POST",
      accessToken: options.accessToken,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      body: {
        method,
        path: pathname,
        ...(bridgeBody === undefined ? {} : { body: bridgeBody }),
        ...(topHeaders ? { headers: topHeaders } : {}),
      } satisfies McpBridgeRequest,
    });
    return bridged;
  };
}

export const mcpGrowdeskFetch = createMcpGrowdeskFetch();

