import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { selectAiSettingsBackend } from "../../lib/growdesk/ai-settings-backend";
import { fetchGrowDeskTransport } from "../../lib/growdesk/http-transport";

test("the optional runtime only receives preferences and explicit message claims", () => {
  const main = "http://127.0.0.1:1";
  const env = { GROWDESK_AI_SETTINGS_API_URL: "http://127.0.0.1:2/" };
  const selected = [
    { path: "/api/v1/web/ai/preferences", options: {} },
    { path: "/api/v1/web/ai/preferences", options: { method: "PUT" } },
    { path: "/api/v1/web/ai/sessions/test_123/messages", options: { method: "POST", body: { claim: true } } },
  ];
  for (const {path, options} of selected) {
    assert.equal(selectAiSettingsBackend(path, main, options, env), "http://127.0.0.1:2");
    assert.equal(selectAiSettingsBackend(path, main, options, {}), main);
  }
  for (const path of ["/api/v1/users/me", "/api/v1/web/auth/login", "/api/v1/mcp/bridge",
    "/api/v1/web/ai/preferences/other", "/api/v1/web/ai/sessions", "/api/v1/web/ai/sessions/batch",
    "/api/v1/web/ai/sessions/test_123", "/api/v1/web/ai/sessions/test_123/../other",
    "//evil.invalid", "/api/v1/web/ai/sessions/%2e%2e/messages"]) {
    assert.equal(selectAiSettingsBackend(path, main, {method: "POST", body: {claim: true}}, env), main);
  }
  for (const options of [{}, {method: "GET"}, {method: "POST"}, {method: "POST", body: {claim: false}}]) {
    assert.equal(selectAiSettingsBackend("/api/v1/web/ai/sessions/test_123/messages", main, options, env), main);
  }
  assert.equal(selectAiSettingsBackend("/api/v1/web/ai/preferences", main, {method: "DELETE"}, env), main);
  for (const value of ["file:///tmp/test", "http://test:secret@127.0.0.1", "http://127.0.0.1/path",
    "http://127.0.0.1?query=test", "http://127.0.0.1#hash", "https://example.invalid"]) {
    assert.throws(() => selectAiSettingsBackend("/api/v1/web/ai/preferences", main, {},
      { GROWDESK_AI_SETTINGS_API_URL: value }));
  }
});

test("a failed settings mutation is sent once and never reaches the main runtime", async () => {
  let mainCalls = 0, selectedCalls = 0;
  const main = http.createServer((_req, res) => { mainCalls++; res.end("{}"); });
  const selected = http.createServer((req, res) => {
    selectedCalls++;
    assert.equal(req.method, "PUT");
    assert.equal(req.headers.authorization, "Bearer test_token");
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "test_unavailable", message: "test" } }));
  });
  main.listen(0, "127.0.0.1"); selected.listen(0, "127.0.0.1");
  await Promise.all([once(main, "listening"), once(selected, "listening")]);
  try {
    const mainUrl = "http://127.0.0.1:" + (main.address() as import("node:net").AddressInfo).port;
    const selectedUrl = "http://127.0.0.1:" + (selected.address() as import("node:net").AddressInfo).port;
    const route = "/api/v1/web/ai/preferences";
    const response = await fetchGrowDeskTransport(selectAiSettingsBackend(route, mainUrl, {method: "PUT"}, {
      GROWDESK_AI_SETTINGS_API_URL: selectedUrl,
    }), route, { method: "PUT", accessToken: "test_token", body: { feature: "chat" } }, 1000);
    assert.equal(response.status, 503);
    assert.equal(selectedCalls, 1);
    assert.equal(mainCalls, 0);
  } finally {
    main.closeAllConnections(); selected.closeAllConnections();
    await Promise.all([new Promise<void>((resolve) => main.close(() => resolve())),
      new Promise<void>((resolve) => selected.close(() => resolve()))]);
  }
});
