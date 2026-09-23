import { randomUUID } from "node:crypto";

export interface GrowDeskFetchOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  headers?: Record<string, string | undefined>;
  body?: unknown;
  accessToken?: string;
  idempotencyKey?: string;
  timeoutMs?: number;
  responseType?: "json" | "stream";
  /** The browser disconnect must cancel the upstream transfer too. */
  signal?: AbortSignal;
}

export interface GrowDeskErrorPayload {
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

export interface GrowDeskResponse<T> {
  ok: boolean;
  status: number;
  data?: T;
  page?: { nextCursor: string | null };
  dataRelease?: Record<string, unknown>;
  error?: GrowDeskErrorPayload;
  response?: Response;
}

const JSON_BYTE_LIMIT = 16 * 1024 * 1024;
const ERROR_BYTE_LIMIT = 64 * 1024;
const OWNED_HEADERS = new Set([
  "authorization", "proxy-authorization", "cookie", "host", "connection",
  "content-length", "transfer-encoding", "accept-encoding", "forwarded",
  "x-request-id", "idempotency-key", "x-user-id", "x-actor-id", "x-family-id", "x-baby-id",
]);

class TransportFailure extends Error {
  constructor(readonly code: string, message: string, readonly status = 502) {
    super(message);
    this.name = "TransportFailure";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** A configured gateway prefix is supported, but the caller cannot replace it. */
export function growDeskRequestUrl(baseUrl: string, pathname: string): string {
  const invalid = () => new TransportFailure("UPSTREAM_CONFIGURATION_ERROR", "Invalid GrowDesk API address or request path", 500);
  let base: URL;
  try { base = new URL(baseUrl); } catch { throw invalid(); }
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw invalid();
  if (!pathname || /^[a-z][a-z0-9+.-]*:/i.test(pathname) || pathname.startsWith("//") || /[\\#\u0000-\u0020\u007f]/.test(pathname)) throw invalid();
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  for (const part of path.split("?", 1)[0].split("/")) {
    let decoded: string;
    try { decoded = decodeURIComponent(part); } catch { throw invalid(); }
    if (decoded === "." || decoded === ".." || /[\\\u0000-\u001f\u007f]/.test(decoded)) throw invalid();
  }
  const prefix = base.pathname.replace(/\/+$/, "");
  const url = new URL(`${base.origin}${prefix}${path}`);
  if (url.origin !== base.origin || (prefix && !url.pathname.startsWith(`${prefix}/`))) throw invalid();
  return url.href;
}

function isJson(response: Response): boolean {
  const mime = (response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  return mime === "application/json" || /^application\/[a-z0-9.+-]+\+json$/.test(mime);
}

async function readJson(response: Response, signal: AbortSignal, maximum: number): Promise<unknown> {
  if (!response.body) throw new TransportFailure("UPSTREAM_INVALID_RESPONSE", "GrowDesk returned an empty JSON body");
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel(signal.reason).catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    if (signal.aborted) throw signal.reason;
    for (;;) {
      const next = await reader.read();
      if (signal.aborted) throw signal.reason;
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximum) {
        void reader.cancel().catch(() => undefined);
        throw new TransportFailure("UPSTREAM_RESPONSE_TOO_LARGE", "GrowDesk JSON response exceeds the transfer budget");
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
    catch { throw new TransportFailure("UPSTREAM_INVALID_RESPONSE", "GrowDesk returned malformed JSON"); }
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

/** Ownership of the deadline moves to the stream, not just its response headers. */
function transferStream(response: Response, upstream: AbortController, cleanup: () => void): Response {
  if (!response.body) throw new TransportFailure("UPSTREAM_INVALID_RESPONSE", "GrowDesk returned an empty stream");
  const reader = response.body.getReader();
  let finished = false;
  let output: ReadableStreamDefaultController<Uint8Array>;
  const finish = () => {
    upstream.signal.removeEventListener("abort", abort);
    cleanup();
  };
  const abort = () => {
    if (finished) return;
    finished = true;
    output.error(upstream.signal.reason);
    finish();
    void reader.cancel(upstream.signal.reason).catch(() => undefined).finally(() => reader.releaseLock());
  };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      output = controller;
      upstream.signal.addEventListener("abort", abort, { once: true });
      if (upstream.signal.aborted) abort();
    },
    async pull(controller) {
      try {
        const next = await reader.read();
        if (finished) return;
        if (next.done) {
          finished = true;
          controller.close();
          finish();
          reader.releaseLock();
        } else controller.enqueue(next.value);
      } catch (error) {
        if (finished) return;
        finished = true;
        controller.error(error);
        finish();
        reader.releaseLock();
      }
    },
    async cancel(reason) {
      if (finished) return;
      finished = true;
      finish();
      upstream.abort(reason);
      try { await reader.cancel(reason); } finally { reader.releaseLock(); }
    },
  }, { highWaterMark: 0 });
  const headers = new Headers(response.headers);
  // Fetch may have decompressed the bytes. Never forward a compressed length
  // or encoding as if it described this newly constructed response body.
  headers.delete("content-encoding");
  headers.delete("content-length");
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

/** No retries or fallback origin: a mutation is sent at most once by this layer. */
export async function fetchGrowDeskTransport<T>(
  baseUrl: string,
  pathname: string,
  options: GrowDeskFetchOptions = {},
  defaultTimeoutMs = 10_000,
): Promise<GrowDeskResponse<T>> {
  const requestId = randomUUID();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let streamOwnsCleanup = false;
  const cancel = () => controller.abort(new TransportFailure("UPSTREAM_REQUEST_CANCELLED", "GrowDesk request was cancelled", 499));
  const cleanup = () => { if (timer !== undefined) clearTimeout(timer); options.signal?.removeEventListener("abort", cancel); };
  try {
    const url = growDeskRequestUrl(baseUrl, pathname);
    const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
      throw new TransportFailure("UPSTREAM_CONFIGURATION_ERROR", "GrowDesk timeout must be between 1 and 120000 milliseconds", 500);
    }
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) cancel();
    if (controller.signal.aborted) throw controller.signal.reason;
    timer = setTimeout(() => controller.abort(new TransportFailure("UPSTREAM_TIMEOUT", "GrowDesk response transfer timed out", 504)), timeoutMs);
    const headers = new Headers({ accept: options.responseType === "stream" ? "*/*" : "application/json", "accept-encoding": "identity", "x-request-id": requestId });
    for (const [key, value] of Object.entries(options.headers ?? {})) {
      const lower = key.toLowerCase();
      if (value === undefined || OWNED_HEADERS.has(lower) || lower.startsWith("x-forwarded-")) continue;
      headers.set(lower, value);
    }
    if (options.accessToken) headers.set("authorization", `Bearer ${options.accessToken}`);
    if (options.idempotencyKey) headers.set("idempotency-key", options.idempotencyKey);
    let body: string | undefined;
    if (options.body !== undefined && options.body !== null) {
      headers.set("content-type", "application/json");
      try { body = JSON.stringify(options.body); }
      catch { throw new TransportFailure("UPSTREAM_REQUEST_INVALID", "GrowDesk request cannot be encoded as JSON", 500); }
    }
    const response = await fetch(url, { method: options.method ?? "GET", headers, body, signal: controller.signal, cache: "no-store", redirect: "manual" });
    if (controller.signal.aborted) { void response.body?.cancel().catch(() => undefined); throw controller.signal.reason; }
    if (response.status >= 300 && response.status < 400) {
      void response.body?.cancel().catch(() => undefined);
      throw new TransportFailure("UPSTREAM_REDIRECT_REJECTED", "GrowDesk API redirects are not followed");
    }
    if (!response.ok) {
      let payload: GrowDeskErrorPayload = { code: `HTTP_${response.status}`, message: "GrowDesk upstream request failed", requestId };
      if (isJson(response)) {
        try {
          const json = await readJson(response, controller.signal, ERROR_BYTE_LIMIT);
          if (record(json) && record(json.error)) {
            const error = json.error;
            payload = {
              code: typeof error.code === "string" ? error.code : payload.code,
              message: typeof error.message === "string" ? error.message : payload.message,
              details: error.details,
              requestId: typeof error.requestId === "string" ? error.requestId : requestId,
            };
          }
        } catch (error) { if (controller.signal.aborted) throw error; }
      } else void response.body?.cancel().catch(() => undefined);
      return { ok: false, status: response.status, error: payload };
    }
    if (options.responseType === "stream") {
      const streamed = transferStream(response, controller, cleanup);
      streamOwnsCleanup = true;
      return { ok: true, status: response.status, response: streamed };
    }
    if (response.status === 204 || response.status === 205) return { ok: true, status: response.status };
    if (!isJson(response)) {
      void response.body?.cancel().catch(() => undefined);
      throw new TransportFailure("UPSTREAM_INVALID_RESPONSE", "GrowDesk returned a non-JSON success response");
    }
    const json = await readJson(response, controller.signal, JSON_BYTE_LIMIT);
    if (!record(json) && !Array.isArray(json)) throw new TransportFailure("UPSTREAM_INVALID_RESPONSE", "GrowDesk returned an invalid response envelope");
    const result: GrowDeskResponse<T> = { ok: true, status: response.status, data: (record(json) && Object.hasOwn(json, "data") ? json.data : json) as T };
    if (record(json) && json.page !== undefined) {
      if (!record(json.page) || !(json.page.nextCursor === null || typeof json.page.nextCursor === "string")) throw new TransportFailure("UPSTREAM_INVALID_RESPONSE", "GrowDesk returned an invalid pagination envelope");
      result.page = { nextCursor: json.page.nextCursor };
    }
    if (record(json) && json.dataRelease !== undefined) {
      if (!record(json.dataRelease)) throw new TransportFailure("UPSTREAM_INVALID_RESPONSE", "GrowDesk returned invalid release metadata");
      result.dataRelease = json.dataRelease;
    }
    return result;
  } catch (error) {
    const cause: unknown = controller.signal.aborted ? controller.signal.reason : error;
    const failure = cause instanceof TransportFailure ? cause : new TransportFailure("UPSTREAM_UNAVAILABLE", "Cannot connect to GrowDesk backend server");
    return { ok: false, status: failure.status, error: { code: failure.code, message: failure.message, requestId } };
  } finally { if (!streamOwnsCleanup) cleanup(); }
}
