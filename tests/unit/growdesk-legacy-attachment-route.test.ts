import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { createLegacyAttachmentEndpoint, legacyAttachmentPath } from "../../lib/growdesk/legacy-attachment-bridge";
import { proxy } from "../../proxy";
import { isBridgedMethod } from "../../lib/growdesk/bridge-policy";
import type { BridgeFetch } from "../../lib/growdesk/bridge-protocol";

const id = "550e8400-e29b-41d4-a716-446655440000";
const session = async () => ({ accessToken: "test_access", user: { id: "test_user", username: "test_user", displayName: "test_user" } });
const request = () => new Request("https://test.invalid/uploads/medical/test.png", {
  headers: { "x-forwarded-host": "test-attacker.invalid", "x-user-id": "test_attacker" },
});

test("legacy image redirects only to the mapped same-origin authorized attachment", async () => {
  const calls: string[] = [];
  const fetchApi: BridgeFetch = async <T>(path: string, options: Parameters<BridgeFetch>[1]) => {
    assert.equal(options?.accessToken, "test_access");
    const url = new URL(path, "https://test-api.invalid");
    assert.equal(url.pathname, "/api/v1/web/attachments/resolve-legacy");
    assert.equal(url.searchParams.get("path"), "/uploads/medical/test 头像.png");
    calls.push(path);
    return { ok: true, status: 200, data: { id, url: "https://test-attacker.invalid/steal" } as T };
  };
  const response = await createLegacyAttachmentEndpoint({ fetchApi, resolveSession: session })(request(), ["medical", "test 头像.png"]);
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), `/api/attachments/${id}`);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.has("access-control-allow-origin"), false);
  assert.equal(calls.length, 1);
});

test("missing mapping, revoked scope and upstream outage never fall back to local files", async () => {
  for (const status of [401, 403, 404, 503]) {
    const fetchApi: BridgeFetch = async () => ({ ok: false, status, error: { code: "TEST_DENIED", message: "test unavailable" } });
    const result = await createLegacyAttachmentEndpoint({ fetchApi, resolveSession: session })(request(), ["medical", "test.png"]);
    assert.equal(result.status, status);
    assert.equal(result.headers.get("location"), null);
    assert.equal((await result.json()).code, "TEST_DENIED");
  }
});

test("legacy image rejects malformed mapped IDs instead of redirecting to arbitrary content", async () => {
  for (const data of [null, {}, { id: "../../test" }, { id: "https://test-attacker.invalid" }]) {
    const fetchApi: BridgeFetch = async <T>() => ({ ok: true, status: 200, data: data as T });
    const result = await createLegacyAttachmentEndpoint({ fetchApi, resolveSession: session })(request(), ["test.png"]);
    assert.equal(result.status, 502);
    assert.equal(result.headers.get("location"), null);
  }
});

test("legacy image requires BFF identity before accessing any mapping", async () => {
  const result = await createLegacyAttachmentEndpoint({
    fetchApi: async () => assert.fail("anonymous mapping request"), resolveSession: async () => null,
  })(request(), ["test.png"]);
  assert.equal(result.status, 401);
});

test("legacy path never normalizes traversal, encoded separators, empty components or oversized UTF-8", () => {
  for (const parts of [[], ["..", "test.png"], ["."], [""], ["a/b"], ["a\\b"], ["%2e%2e"], ["a?b"], ["a#b"], ["a\u0000b"], ["中".repeat(400)]]) {
    assert.throws(() => legacyAttachmentPath(parts));
  }
  assert.equal(legacyAttachmentPath(["medical", "test.png"]), "/uploads/medical/test.png");
});

test("uploads rewrite precedes public-file routing and preserves method restrictions", () => {
  const previous = process.env.GROWDESK_ENABLED;
  process.env.GROWDESK_ENABLED = "1";
  try {
    const response = proxy(new NextRequest("https://test.invalid/uploads/medical/test.png"));
    assert.equal(response.headers.get("x-middleware-rewrite"), "https://test.invalid/api/legacy-attachments/medical/test.png");
    assert.equal(proxy(new NextRequest("https://test.invalid/uploads/test.png", { method: "POST" })).status, 405);
    assert.equal(isBridgedMethod("/api/legacy-attachments/medical/test.png", "GET", "go"), true);
    assert.equal(isBridgedMethod("/api/legacy-attachments/medical/test.png", "POST", "go"), false);
    assert.equal(isBridgedMethod(`/api/attachments/${id}`, "HEAD", "go"), true);
    assert.equal(isBridgedMethod(`/api/attachments/${id}`, "POST", "go"), false);
  } finally {
    if (previous === undefined) delete process.env.GROWDESK_ENABLED;
    else process.env.GROWDESK_ENABLED = previous;
  }
});
