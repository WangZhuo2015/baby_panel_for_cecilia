import test from "node:test";
import assert from "node:assert/strict";
import { clearLegacyAuthCookies, legacyTokenFromRequest, mayBootstrapLegacySession } from "../../lib/growdesk/legacy-session-policy";

const request = (path = "/api/auth/me", cookie = "auth_token=test.token", method = "GET") =>
  new Request(`http://test.local${path}`, { method, headers: { cookie } });

test("legacy migration belongs only to explicit Go identity bootstrap", () => {
  assert.equal(mayBootstrapLegacySession(request(), "bff", true), true);
  for (const value of [undefined, request("/api/records/feeding"), request("/api/auth/me", "auth_token=x", "POST"), request("/api/auth/me", "bff=malformed; auth_token=x")]) {
    assert.equal(mayBootstrapLegacySession(value, "bff", true), false);
  }
  assert.equal(mayBootstrapLegacySession(request(), "bff", false), false);
  assert.equal(mayBootstrapLegacySession(new Request("http://test.local/api/auth/me", { headers: { "sec-fetch-site": "cross-site" } }), "bff", true), false);
});

test("cookie extraction rejects duplicates and mixed identities", () => {
  assert.equal(legacyTokenFromRequest(request()), "test.token");
  assert.equal(legacyTokenFromRequest(request("/api/auth/me", "baby_auth_token=test.token")), "test.token");
  assert.equal(legacyTokenFromRequest(request("/api/auth/me", "baby_auth_token=same; auth_token=same")), "same");
  for (const cookie of ["", "other=x", "auth_token=", "auth_token=%", "auth_token=one; auth_token=two", "baby_auth_token=one; auth_token=two"]) {
    assert.equal(legacyTokenFromRequest(request("/api/auth/me", cookie)), null);
  }
});

test("an explicit malformed authorization header never falls back to a cookie", () => {
  assert.equal(legacyTokenFromRequest(new Request("http://test.local", { headers: { authorization: "Basic value", cookie: "auth_token=other" } })), null);
  assert.equal(legacyTokenFromRequest(new Request("http://test.local", { headers: { authorization: "Bearer test.token" } })), "test.token");
});

test("retirement covers both legacy aliases without exposing tokens", () => {
  const response = new Response(null);
  clearLegacyAuthCookies(response, true);
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  for (const name of ["baby_auth_token", "auth_token"]) {
    const value = cookies.find(cookie => cookie.startsWith(`${name}=`));
    assert.ok(value);
    assert.match(value, /Max-Age=0/);
    assert.match(value, /HttpOnly/);
    assert.match(value, /Secure/);
    assert.match(value, /Path=\//);
  }
});
