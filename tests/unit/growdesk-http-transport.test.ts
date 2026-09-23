import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { fetchGrowDeskTransport, growDeskRequestUrl } from "../../lib/growdesk/http-transport";

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

test("fixed origin preserves a gateway prefix and rejects ambiguous paths", () => {
  assert.equal(growDeskRequestUrl("http://127.0.0.1:4000/gateway/", "/api/v1/books?familyId=test_family"), "http://127.0.0.1:4000/gateway/api/v1/books?familyId=test_family");
  assert.equal(growDeskRequestUrl("http://127.0.0.1:4000", "health/live"), "http://127.0.0.1:4000/health/live");
  for (const pathname of ["https://test.invalid/", "//test.invalid/", "/../private", "/%2e%2e/private", "/x\\private", "/x#fragment", "/x\n", "/%00", "/%zz"]) {
    assert.throws(() => growDeskRequestUrl("http://127.0.0.1:4000/gateway", pathname));
  }
  for (const base of ["file:///tmp/test", "http://user:pass@127.0.0.1:4000", "http://127.0.0.1:4000?x=1", "http://127.0.0.1:4000#x"]) {
    assert.throws(() => growDeskRequestUrl(base, "/health/live"));
  }
});

test("real HTTP transport preserves contracts and bounds all response phases", { timeout: 20_000 }, async t => {
  const requests: string[] = [];
  const closed = new Set<string>();
  const server = createServer((request, response) => {
    const path = request.url ?? "/";
    requests.push(path);
    response.once("close", () => closed.add(path));
    if (path === "/echo") {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", chunk => { body += String(chunk); });
      request.once("end", () => json(response, 200, {
        data: { body: body ? JSON.parse(body) : null, headers: request.headers },
        page: { nextCursor: null }, dataRelease: { version: "test_release" },
      }));
    } else if (path === "/redirect") {
      response.writeHead(307, { location: "/echo" }); response.end();
    } else if (path === "/denied") {
      json(response, 403, { error: { code: "BABY_ACCESS_DENIED", message: "test denial", details: { babyId: "test_baby" } } });
    } else if (path === "/unimplemented") {
      json(response, 503, { error: { code: "GO_OPERATION_NOT_IMPLEMENTED", message: "test unavailable" } });
    } else if (path === "/invalid-page") {
      json(response, 200, { data: [], page: { nextCursor: 7 } });
    } else if (path === "/null-data") {
      json(response, 200, { data: null });
    } else if (path === "/bare") {
      json(response, 201, { id: "test_item", tried: false, count: 0 });
    } else if (path === "/html") {
      response.writeHead(200, { "content-type": "text/html" }); response.end("test upstream login page");
    } else if (path === "/malformed") {
      response.writeHead(200, { "content-type": "application/json" }); response.end("{broken");
    } else if (path === "/slow-json") {
      response.writeHead(200, { "content-type": "application/json" }); response.write('{"data":');
    } else if (path.startsWith("/stream")) {
      response.writeHead(200, { "content-type": "image/png", "content-length": "1000000" });
      response.write(Buffer.from([0, 1, 2, 3]));
    } else if (path === "/complete-stream") {
      response.writeHead(200, { "content-type": "image/png", "content-length": "4" });
      response.end(Buffer.from([0, 1, 2, 3]));
    } else if (path === "/oversized") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"data":"' + "x".repeat(16 * 1024 * 1024 + 1) + '"}');
    } else {
      json(response, 404, { error: { code: "NOT_FOUND", message: "test missing" } });
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    const done = new Promise<void>(resolve => server.close(() => resolve()));
    server.closeAllConnections();
    await done;
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;

  await t.test("trusted credentials cannot be replaced by forwarded browser headers", async () => {
    const body = { zero: 0, flag: false, empty: [], explicitNull: null, decimal: "120.00", version: "9007199254740993" };
    const response = await fetchGrowDeskTransport<{ body: typeof body; headers: Record<string, string> }>(base, "/echo", {
      method: "POST", accessToken: "test_trusted_token", idempotencyKey: "test_command", body,
      headers: { authorization: "Bearer test_forged", cookie: "test_cookie=1", "x-user-id": "test_other", "idempotency-key": "test_forged", "x-request-id": "test_forged", "x-forwarded-host": "test.invalid", "x-test-extra": "retained" },
    });
    assert.equal(response.ok, true);
    assert.deepEqual(response.data?.body, body);
    assert.equal(response.data?.headers.authorization, "Bearer test_trusted_token");
    assert.equal(response.data?.headers["idempotency-key"], "test_command");
    assert.equal(response.data?.headers.cookie, undefined);
    assert.equal(response.data?.headers["x-user-id"], undefined);
    assert.equal(response.data?.headers["x-forwarded-host"], undefined);
    assert.notEqual(response.data?.headers["x-request-id"], "test_forged");
    assert.equal(response.data?.headers["x-test-extra"], "retained");
    assert.deepEqual(response.page, { nextCursor: null });
    assert.deepEqual(response.dataRelease, { version: "test_release" });
  });

  await t.test("upstream redirects are rejected without replaying the mutation", async () => {
    const before = requests.length;
    const result = await fetchGrowDeskTransport(base, "/redirect", { method: "POST", accessToken: "test_token", body: { value: 1 } });
    assert.equal(result.status, 502);
    assert.equal(result.error?.code, "UPSTREAM_REDIRECT_REJECTED");
    assert.deepEqual(requests.slice(before), ["/redirect"]);
  });

  await t.test("permission and missing-native-operation errors are never successful empty data", async () => {
    const denied = await fetchGrowDeskTransport(base, "/denied");
    assert.equal(denied.ok, false);
    assert.equal(denied.status, 403);
    assert.equal(denied.error?.code, "BABY_ACCESS_DENIED");
    assert.deepEqual(denied.error?.details, { babyId: "test_baby" });
    const missing = await fetchGrowDeskTransport(base, "/unimplemented");
    assert.equal(missing.status, 503);
    assert.equal(missing.error?.code, "GO_OPERATION_NOT_IMPLEMENTED");
    assert.equal(missing.data, undefined);
  });

  await t.test("bare legacy DTOs and explicit null remain distinct", async () => {
    const bare = await fetchGrowDeskTransport(base, "/bare");
    assert.deepEqual(bare.data, { id: "test_item", tried: false, count: 0 });
    const nullable = await fetchGrowDeskTransport(base, "/null-data");
    assert.equal(nullable.ok, true);
    assert.equal(nullable.data, null);
  });

  await t.test("HTML, malformed JSON and invalid pagination fail closed", async () => {
    for (const path of ["/html", "/malformed", "/invalid-page"]) {
      const result = await fetchGrowDeskTransport(base, path);
      assert.equal(result.ok, false, path);
      assert.equal(result.status, 502, path);
      assert.equal(result.error?.code, "UPSTREAM_INVALID_RESPONSE", path);
    }
  });

  await t.test("JSON deadline includes body consumption", async () => {
    const result = await fetchGrowDeskTransport(base, "/slow-json", { timeoutMs: 300 });
    assert.equal(result.status, 504);
    assert.equal(result.error?.code, "UPSTREAM_TIMEOUT");
  });

  await t.test("stream deadline remains active after receiving headers and first bytes", async () => {
    const result = await fetchGrowDeskTransport(base, "/stream-timeout", { responseType: "stream", timeoutMs: 500 });
    assert.equal(result.ok, true);
    assert.equal(result.response?.headers.get("content-length"), null);
    const reader = result.response!.body!.getReader();
    assert.deepEqual(Array.from((await reader.read()).value!), [0, 1, 2, 3]);
    await assert.rejects(reader.read(), /timed out/);
    reader.releaseLock();
  });

  await t.test("browser abort cancels a live upstream stream", async () => {
    const abort = new AbortController();
    const result = await fetchGrowDeskTransport(base, "/stream-abort", { responseType: "stream", signal: abort.signal });
    assert.equal(result.ok, true);
    const reader = result.response!.body!.getReader();
    await reader.read();
    abort.abort();
    await assert.rejects(reader.read(), /cancelled/);
    reader.releaseLock();
  });

  await t.test("consumer cancellation releases the stream", async () => {
    const result = await fetchGrowDeskTransport(base, "/stream-cancel", { responseType: "stream" });
    assert.equal(result.ok, true);
    const reader = result.response!.body!.getReader();
    await reader.read();
    await reader.cancel("test consumer stopped");
    reader.releaseLock();
  });

  await t.test("completed streams retain every byte and close normally", async () => {
    const result = await fetchGrowDeskTransport(base, "/complete-stream", { responseType: "stream" });
    assert.equal(result.ok, true);
    assert.deepEqual(Array.from(new Uint8Array(await result.response!.arrayBuffer())), [0, 1, 2, 3]);
  });

  await t.test("pre-aborted and invalid configuration requests do not contact upstream", async () => {
    const before = requests.length;
    const signal = AbortSignal.abort();
    assert.equal((await fetchGrowDeskTransport(base, "/echo", { signal })).status, 499);
    assert.equal((await fetchGrowDeskTransport(base, "/echo", { timeoutMs: Infinity })).status, 500);
    assert.equal((await fetchGrowDeskTransport(base, "//test.invalid/")).status, 500);
    assert.equal(requests.length, before);
  });

  await t.test("oversized JSON is rejected with an explicit budget error", async () => {
    const result = await fetchGrowDeskTransport(base, "/oversized");
    assert.equal(result.status, 502);
    assert.equal(result.error?.code, "UPSTREAM_RESPONSE_TOO_LARGE");
  });

  await t.test("cancelled and timed-out upstream sockets are released", async () => {
    const expected = ["/slow-json", "/stream-timeout", "/stream-abort", "/stream-cancel"];
    for (let i = 0; i < 100 && expected.some(path => !closed.has(path)); i++) await sleep(10);
    for (const path of expected) assert.ok(closed.has(path), `upstream was not closed: ${path}`);
  });
});
