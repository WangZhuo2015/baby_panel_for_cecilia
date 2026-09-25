import test from "node:test";
import assert from "node:assert/strict";

// The real BFF/transport/route modules run here; only the network is controlled.
// No SQLite, real server, provider, credentials or browser are used.
test("legacy bootstrap and logout HTTP lifecycle", async t => {
  const { resolveBffSession } = await import("../../lib/growdesk/session");
  const { growdeskIdentityEndpoints } = await import("../../lib/growdesk/identity-endpoints");
  const { POST: logout } = await import("../../app/api/auth/logout/route");
  const { GROWDESK_CONFIG } = await import("../../lib/config");
  const values = { GROWDESK_ENABLED: "true", GROWDESK_BACKEND: "go", GROWDESK_API_URL: "http://127.0.0.1:59999", GROWDESK_WEB_ORIGIN: "http://test.local" };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const calls: Array<{ path: string; method: string; body: Record<string, unknown> }> = [];
  let familiesUnavailable = false;
  let revokeUnavailable = false;
  let sessionDenied = false;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
    const method = init?.method || "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ path, method, body });
    if (path === "/api/v1/auth/bff/session") {
      if (method === "DELETE") return revokeUnavailable
        ? Response.json({ error: { code: "TEST_OUTAGE", message: "Test outage" } }, { status: 503 })
        : Response.json({ data: { success: true } });
      if (sessionDenied) return Response.json({ error: { code: "SESSION_REVOKED", message: "Test revocation" } }, { status: 401 });
      return Response.json({ data: { accessToken: "test_access_token", user: { id: "test_user", username: "test_name", displayName: "Test User" } } });
    }
    if (path === "/api/v1/families") return familiesUnavailable
      ? Response.json({ error: { code: "TEST_OUTAGE", message: "Test outage" } }, { status: 503 })
      : Response.json({ data: [] });
    throw new Error(`Unexpected upstream route: ${method} ${path}`);
  });
  const make = (path = "/api/auth/me", cookie = "auth_token=test_legacy_token", method = "GET") =>
    new Request(`http://test.local${path}`, { method, headers: { cookie, origin: "http://test.local" } });

  await t.test("ordinary business requests cannot mint unreachable sessions", async () => {
    const before = calls.length;
    for (const method of ["GET", "POST"]) assert.equal(await resolveBffSession(make("/api/records/feeding", undefined, method)), null);
    assert.equal(calls.length, before);
  });
  await t.test("one Request shares one migration exchange", async () => {
    const before = calls.length;
    const request = make();
    const [first, second] = await Promise.all([resolveBffSession(request), resolveBffSession(request)]);
    assert.equal(first, second);
    assert.equal(first?.isNewSession, true);
    assert.equal(calls.length - before, 1);
  });
  await t.test("successful bootstrap writes new cookie and expires every old alias", async () => {
    const response = await growdeskIdentityEndpoints.me(make());
    assert.equal(response.status, 200);
    const cookies = response.headers.getSetCookie();
    assert.ok(cookies.some(value => value.startsWith(`${GROWDESK_CONFIG.cookieName}=`) && value.includes("HttpOnly")));
    for (const name of ["auth_token", "baby_auth_token"]) assert.ok(cookies.some(value => value.startsWith(`${name}=`) && value.includes("Max-Age=0")));
    const body = await response.json();
    assert.equal(body.user.id, "test_user");
    assert.equal(body.accessToken, undefined);
    assert.equal(body.sessionSecret, undefined);
  });
  await t.test("failed identity hydration revokes newly created session without clearing legacy login", async () => {
    familiesUnavailable = true;
    const before = calls.length;
    const response = await growdeskIdentityEndpoints.me(make());
    familiesUnavailable = false;
    assert.equal(response.status, 503);
    assert.equal(response.headers.getSetCookie().length, 0);
    const sequence = calls.slice(before);
    assert.deepEqual(sequence.map(value => value.method), ["POST", "GET", "DELETE"]);
    assert.equal(sequence[0]!.body.sessionSecretHash, sequence[2]!.body.sessionSecretHash);
  });
  await t.test("malformed or revoked BFF cookies never fall back to the old identity", async () => {
    const before = calls.length;
    assert.equal(await resolveBffSession(make("/api/auth/me", `${GROWDESK_CONFIG.cookieName}=bad; auth_token=test_legacy_token`)), null);
    assert.equal(calls.length, before);
    sessionDenied = true;
    assert.equal(await resolveBffSession(make("/api/auth/me", `${GROWDESK_CONFIG.cookieName}=${"a".repeat(64)}; auth_token=test_legacy_token`)), null);
    sessionDenied = false;
    assert.equal(calls.length - before, 1);
    assert.equal(calls.at(-1)!.body.legacyAuthToken, undefined);
  });
  await t.test("actual NextResponse logout retains all cookie expiry headers", async () => {
    const response = await logout(make("/api/auth/logout", `${GROWDESK_CONFIG.cookieName}=${"a".repeat(64)}; auth_token=test_legacy_token`, "POST"));
    assert.equal(response.status, 200);
    const cookies = response.headers.getSetCookie();
    for (const name of [GROWDESK_CONFIG.cookieName, "baby_auth_token", "auth_token"]) assert.ok(cookies.some(value => value.startsWith(`${name}=`) && value.includes("Max-Age=0")), name);
  });
  await t.test("revocation outage does not report success or clear credentials", async () => {
    revokeUnavailable = true;
    const response = await logout(make("/api/auth/logout", `${GROWDESK_CONFIG.cookieName}=${"a".repeat(64)}`, "POST"));
    revokeUnavailable = false;
    assert.equal(response.status, 503);
    assert.equal(response.headers.getSetCookie().length, 0);
  });
});
