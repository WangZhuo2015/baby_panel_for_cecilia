import assert from "node:assert/strict";
import test from "node:test";
import {
  createMcpGrowdeskFetch,
  validateMcpBridgeRequest,
  withMcpRequestContext,
  type BaseGrowDeskFetch,
  type McpBridgeRequest,
} from "../../lib/growdesk/mcp-client";
import type { GrowDeskFetchOptions, GrowDeskResponse } from "../../lib/growdesk/http-transport";

interface Call {
  path: string;
  options: GrowDeskFetchOptions;
}

function makeTransport(result: GrowDeskResponse<unknown> = { ok: true, status: 200, data: { data: { id: "test-record" } } }) {
  const calls: Call[] = [];
  const baseFetch: BaseGrowDeskFetch = async <T>(path: string, options: GrowDeskFetchOptions = {}) => {
    calls.push({ path, options });
    return result as GrowDeskResponse<T>;
  };
  return { calls, fetch: createMcpGrowdeskFetch(baseFetch) };
}

test("MCP domain fetches become fixed bridge POSTs and only forward contract headers", async () => {
  const { calls, fetch } = makeTransport();
  const result = await fetch("/api/v1/babies/test-baby/records/feeding?limit=10", {
    method: "GET",
    accessToken: "test_mcp_bearer",
    headers: { "If-Match": '"4"', Authorization: "Bearer test_untrusted", "X-Forwarded-Host": "attacker.invalid" },
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/v1/mcp/bridge");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.accessToken, "test_mcp_bearer");
  assert.deepEqual(calls[0].options.body, {
    method: "GET",
    path: "/api/v1/babies/test-baby/records/feeding?limit=10",
    headers: { "If-Match": '"4"' },
  } satisfies McpBridgeRequest);
  assert.equal((calls[0].options.body as any).headers.Authorization, undefined);
  assert.deepEqual(result.data, { data: { id: "test-record" } }, "the adapter must preserve the Go bridge's domain response envelope");
});

test("missing MCP bearer fails closed without making a bridge request", async () => {
  const { calls, fetch } = makeTransport();
  const result = await fetch("/api/v1/babies/test-baby", { method: "GET" });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(result.error?.code, "MCP_TOKEN_REQUIRED");
  assert.equal(calls.length, 0);
});

test("bridge request validation rejects host, traversal, control, and misplaced batch routes", () => {
  for (const path of [
    "https://attacker.invalid/api/v1/babies/test",
    "//attacker.invalid/api/v1/babies/test",
    "/api/v1/babies/../families/test",
    "/api/v1/babies/%2e%2e/families/test",
    "/api/v1/babies/test#fragment",
    "/api/v1/babies/test\nheader",
  ]) {
    assert.throws(() => validateMcpBridgeRequest("GET", path), TypeError, path);
  }
  assert.throws(() => validateMcpBridgeRequest("BATCH", "/api/v1/babies/test/records/feeding"), TypeError);
  assert.throws(() => validateMcpBridgeRequest("BATCH", "/api/v1/mcp/atomic-records?unexpected=yes"), TypeError);
  assert.doesNotThrow(() => validateMcpBridgeRequest("BATCH", "/api/v1/mcp/atomic-records"));
  assert.doesNotThrow(() => validateMcpBridgeRequest("GET", "/api/v1/books?familyId=test-family"));
});

test("batch requests receive unique stable item keys scoped to MCP client and request ID", async () => {
  const { calls, fetch } = makeTransport();
  const body = {
    requests: [
      { method: "POST", path: "/api/v1/babies/test-baby/records/feeding", body: { amountMl: 90 }, headers: { "X-Untrusted": "drop" } },
      { method: "POST", path: "/api/v1/babies/test-baby/records/food", body: { foods: ["pear"] }, headers: { "If-Match": '"2"' } },
    ],
  };

  await withMcpRequestContext({ clientId: "test-client-a", requestId: "test-request-1" }, () => fetch(
    "/api/v1/mcp/atomic-records",
    { method: "BATCH", accessToken: "test_mcp_bearer", body, headers: { "X-Outer-Untrusted": "drop" } },
  ));

  const call = calls[0];
  assert.equal(call.path, "/api/v1/mcp/bridge");
  const outer = call.options.body as McpBridgeRequest;
  assert.equal(outer.method, "BATCH");
  assert.equal(outer.path, "/api/v1/mcp/atomic-records");
  assert.equal(outer.headers, undefined);
  const requests = (outer.body as { requests: Array<{ headers?: Record<string, string> }> }).requests;
  assert.equal(requests.length, 2);
  const keys = requests.map((request) => request.headers?.["Idempotency-Key"]);
  assert.ok(keys.every((key) => typeof key === "string" && /^mcp_[a-f0-9]{64}$/.test(key)));
  assert.notEqual(keys[0], keys[1]);
  assert.deepEqual(requests[0].headers, { "Idempotency-Key": keys[0], "X-Request-ID": "test-request-1" });
  assert.deepEqual(requests[1].headers, { "If-Match": '"2"', "Idempotency-Key": keys[1], "X-Request-ID": "test-request-1" });
  await withMcpRequestContext({ clientId: "test-client-a", requestId: "test-request-1" }, () => fetch(
    "/api/v1/mcp/atomic-records",
    { method: "BATCH", accessToken: "test_mcp_bearer", body },
  ));
  const replayBody = (calls[1].options.body as McpBridgeRequest).body as { requests: Array<{ headers?: Record<string, string> }> };
  assert.equal(replayBody.requests[0].headers?.["Idempotency-Key"], keys[0]);
  assert.equal(replayBody.requests[1].headers?.["Idempotency-Key"], keys[1]);
});

test("batch idempotency keys change across MCP clients and request IDs", async () => {
  const { calls, fetch } = makeTransport();
  const request = () => fetch("/api/v1/mcp/atomic-records", {
    method: "BATCH",
    accessToken: "test_mcp_bearer",
    body: { requests: [{ method: "POST", path: "/api/v1/babies/test-baby/records/feeding", body: {} }] },
  });
  await withMcpRequestContext({ clientId: "test-client-a", requestId: "request-1" }, request);
  await withMcpRequestContext({ clientId: "test-client-a", requestId: "request-2" }, request);
  await withMcpRequestContext({ clientId: "test-client-b", requestId: "request-1" }, request);
  const keys = calls.map((call) => ((call.options.body as McpBridgeRequest).body as any).requests[0].headers["Idempotency-Key"]);
  assert.equal(new Set(keys).size, 3);
});

test("single writes use a stable canonical idempotency header for the same MCP request", async () => {
  const { calls, fetch } = makeTransport();
  const write = () => fetch("/api/v1/babies/test-baby/records/feeding", {
    method: "POST",
    accessToken: "test_mcp_bearer",
    body: { amountMl: 90 },
    headers: { "Idempotency-Key": "untrusted-explicit-key", "X-Request-ID": "untrusted-request-id" },
  });
  await withMcpRequestContext({ clientId: "test-client-a", requestId: "test-request-1" }, write);
  await withMcpRequestContext({ clientId: "test-client-a", requestId: "test-request-1" }, write);
  const headers = calls.map((call) => (call.options.body as McpBridgeRequest).headers!);
  assert.deepEqual(headers[0], headers[1]);
  assert.match(headers[0]["Idempotency-Key"], /^mcp_[a-f0-9]{64}$/);
  assert.equal(headers[0]["X-Request-ID"], "test-request-1");
});
