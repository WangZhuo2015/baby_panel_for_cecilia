import test from "node:test";
import assert from "node:assert/strict";
import { resolveLegacyUploadPath } from "../../lib/growdesk/legacy-upload";
import { BridgeError, type BridgeFetch } from "../../lib/growdesk/bridge-protocol";

const id = "a0000000-0000-4000-8000-000000000001";
function stub(value: unknown, status = 200) {
  const calls: Array<{ pathname: string; token?: string }> = [];
  const fetchApi: BridgeFetch = async <T>(pathname: string, options?: Parameters<BridgeFetch>[1]) => {
    calls.push({ pathname, token: options?.accessToken });
    return status === 200
      ? { ok: true, status, data: value as T }
      : { ok: false, status, error: { code: `TEST_${status}`, message: "test unavailable" } };
  };
  return { fetchApi, calls };
}

test("only a validated backend ID becomes a same-origin protected URL", async () => {
  const h = stub({ id });
  assert.equal(await resolveLegacyUploadPath(h.fetchApi, "test_token", ["old", "test.png"]), `/api/attachments/${id}`);
  assert.deepEqual(h.calls, [{ pathname: "/api/v1/web/attachments/resolve-legacy?path=%2Fuploads%2Fold%2Ftest.png", token: "test_token" }]);
});

test("missing auth and unsafe paths do not contact any upstream", async () => {
  const h = stub({ id });
  await assert.rejects(resolveLegacyUploadPath(h.fetchApi, "", ["test.png"]));
  for (const segments of [[], ["..", "test.png"], ["a/b"], ["a\\b"], ["%2e%2e"], ["a?x"], ["a#x"], ["a\u0000b"]]) {
    await assert.rejects(resolveLegacyUploadPath(h.fetchApi, "test_token", segments));
  }
  assert.equal(h.calls.length, 0);
});

test("upstream denial and outage remain errors instead of reading a local file", async () => {
  for (const status of [401, 403, 404, 429, 502, 503, 504]) {
    await assert.rejects(resolveLegacyUploadPath(stub(null, status).fetchApi, "test_token", ["test.png"]),
      (error: unknown) => error instanceof BridgeError && error.status === status);
  }
});

test("invalid IDs cannot redirect to another origin or path", async () => {
  for (const value of [null, [], {}, { id: "https://test.invalid" }, { id: "../private" }, { id: 1 }]) {
    await assert.rejects(resolveLegacyUploadPath(stub(value).fetchApi, "test_token", ["test.png"]),
      (error: unknown) => error instanceof BridgeError && error.status === 502);
  }
});
