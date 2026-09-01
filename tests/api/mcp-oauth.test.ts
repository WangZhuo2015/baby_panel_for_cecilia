import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import dotenv from "dotenv";
dotenv.config();

import { prisma } from "@/lib/prisma";
import { hashPassword, signAuthToken } from "@/lib/auth";
import { getBaseUrl, STATIC_OAUTH_CLIENTS } from "@/lib/oauth/config";
import {
  registerClient,
  findClient,
  createAuthorizationCode,
  exchangeAuthorizationCode,
  refreshAccessToken,
  revokeToken,
  verifyMcpAccessToken,
  OAuthError,
} from "@/lib/oauth/service";
import { GET as getProtectedResourceMetadata } from "@/app/.well-known/oauth-protected-resource/mcp/route";
import { GET as getAsMetadata } from "@/app/.well-known/oauth-authorization-server/route";
import { POST as registerRoute } from "@/app/oauth/register/route";
import { POST as tokenRoute } from "@/app/oauth/token/route";
import { POST as revokeRoute } from "@/app/oauth/revoke/route";
import { POST as authorizeApiRoute } from "@/app/api/oauth/authorize/route";
import { GET as mcpGet, POST as mcpPost } from "@/app/mcp/route";

function generatePkce() {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

test("Gemini Spark MCP & OAuth 2.1 Test Matrix", async (t) => {
  // Setup Test Users, Families, Babies
  const prefix = `test_${Date.now()}_`;
  const passwordHash = await hashPassword("password123");

  const userA = await prisma.user.create({
    data: {
      username: `${prefix}user_a`,
      displayName: "Parent A",
      passwordHash,
    },
  });

  const userB = await prisma.user.create({
    data: {
      username: `${prefix}user_b`,
      displayName: "Parent B",
      passwordHash,
    },
  });

  const familyA = await prisma.family.create({
    data: {
      name: "Family A",
      inviteCode: `FA${Date.now().toString().slice(-4)}`,
      members: { create: [{ userId: userA.id, role: "admin", relation: "mother" }] },
      babies: {
        create: [
          {
            nickname: "Baby A",
            gender: "female",
            birthDate: "2025-01-01",
          },
        ],
      },
    },
    include: { babies: true },
  });
  const babyA = familyA.babies[0];

  const familyB = await prisma.family.create({
    data: {
      name: "Family B",
      inviteCode: `FB${Date.now().toString().slice(-4)}`,
      members: { create: [{ userId: userB.id, role: "admin", relation: "father" }] },
      babies: {
        create: [
          {
            nickname: "Baby B",
            gender: "male",
            birthDate: "2025-06-01",
          },
        ],
      },
    },
    include: { babies: true },
  });
  const babyB = familyB.babies[0];

  const baseUrl = "http://localhost:3000";

  await t.test("Test 1 — Unauthenticated discovery on /mcp returns 401 with WWW-Authenticate", async () => {
    const req = new Request("http://localhost:3000/mcp", { method: "GET" });
    const res = await mcpGet(req);

    assert.equal(res.status, 401);
    const wwwAuth = res.headers.get("www-authenticate");
    assert.ok(wwwAuth);
    assert.ok(wwwAuth.includes('Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/mcp"'));
    const body = await res.json();
    assert.equal(body.error, "unauthorized");
  });

  await t.test("Test 2 — RFC 9728 Protected Resource Metadata endpoint", async () => {
    const req = new Request("http://localhost:3000/.well-known/oauth-protected-resource/mcp");
    const res = await getProtectedResourceMetadata(req);

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.resource, "http://localhost:3000/mcp");
    assert.deepEqual(body.authorization_servers, ["http://localhost:3000"]);
    assert.ok(body.scopes_supported.includes("baby:read"));
    assert.ok(body.scopes_supported.includes("baby:write"));
  });

  await t.test("Test 3 — RFC 8414 OAuth Authorization Server Discovery endpoint", async () => {
    const req = new Request("http://localhost:3000/.well-known/oauth-authorization-server");
    const res = await getAsMetadata(req);

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.issuer, "http://localhost:3000");
    assert.equal(body.authorization_endpoint, "http://localhost:3000/oauth/authorize");
    assert.equal(body.token_endpoint, "http://localhost:3000/oauth/token");
    assert.equal(body.registration_endpoint, "http://localhost:3000/oauth/register");
    assert.deepEqual(body.code_challenge_methods_supported, ["S256"]);
    assert.ok(body.grant_types_supported.includes("authorization_code"));
    assert.ok(body.grant_types_supported.includes("refresh_token"));
  });

  let dcrClient: any;
  await t.test("Test 4 — RFC 7591 Dynamic Client Registration (DCR)", async () => {
    const regReq = new Request("http://localhost:3000/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Gemini Spark Test Client",
        redirect_uris: ["https://gemini.google.com/oauth/callback"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    });

    const regRes = await registerRoute(regReq);
    assert.equal(regRes.status, 201);
    dcrClient = await regRes.json();
    assert.ok(dcrClient.client_id.startsWith("dcr_"));
    assert.deepEqual(dcrClient.redirect_uris, ["https://gemini.google.com/oauth/callback"]);

    // Test rejection of wildcard redirect URI
    const badReq = new Request("http://localhost:3000/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["https://*.google.com/callback"],
      }),
    });
    const badRes = await registerRoute(badReq);
    assert.equal(badRes.status, 400);
  });

  let tokenA: string;
  let refreshTokenA: string;
  await t.test("Test 5 — Authorization Code + PKCE S256 Flow for User A", async () => {
    const { codeVerifier, codeChallenge } = generatePkce();

    // 1. User A authorizes via Authorize API
    const authReq = new Request("http://localhost:3000/api/oauth/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: dcrClient.client_id,
        redirectUri: "https://gemini.google.com/oauth/callback",
        scope: "baby:read baby:write",
        codeChallenge,
        codeChallengeMethod: "S256",
        resource: "http://localhost:3000/mcp",
        babyId: babyA.id,
        decision: "allow",
        username: userA.username,
        password: "password123",
      }),
    });

    const authRes = await authorizeApiRoute(authReq);
    assert.equal(authRes.status, 200);
    const authBody = await authRes.json();
    assert.ok(authBody.redirect_url);

    const redirectUrl = new URL(authBody.redirect_url);
    const code = redirectUrl.searchParams.get("code");
    assert.ok(code);

    // 2. Token Exchange via POST /oauth/token
    const tokenReq = new Request("http://localhost:3000/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code!,
        redirect_uri: "https://gemini.google.com/oauth/callback",
        client_id: dcrClient.client_id,
        code_verifier: codeVerifier,
        resource: "http://localhost:3000/mcp",
      }).toString(),
    });

    const tokenRes = await tokenRoute(tokenReq);
    assert.equal(tokenRes.status, 200);
    const tokenBody = await tokenRes.json();
    assert.ok(tokenBody.access_token);
    assert.ok(tokenBody.refresh_token);
    assert.equal(tokenBody.token_type, "Bearer");
    assert.equal(tokenBody.scope, "baby:read baby:write");

    tokenA = tokenBody.access_token;
    refreshTokenA = tokenBody.refresh_token;

    // Verify code replay is rejected
    const replayReq = new Request("http://localhost:3000/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code!,
        redirect_uri: "https://gemini.google.com/oauth/callback",
        client_id: dcrClient.client_id,
        code_verifier: codeVerifier,
        resource: "http://localhost:3000/mcp",
      }).toString(),
    });
    const replayRes = await tokenRoute(replayReq);
    assert.equal(replayRes.status, 400);
  });

  await t.test("Test 6 — Bearer MCP Request execution with Token A", async () => {
    // 1. tools/list call
    const listReq = new Request("http://localhost:3000/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "req-list-1",
        method: "tools/list",
        params: {},
      }),
    });

    const listRes = await mcpPost(listReq);
    assert.equal(listRes.status, 200);
    const listBody = await listRes.json();
    assert.ok(listBody.result?.tools);
    const toolNames = listBody.result.tools.map((t: any) => t.name);
    assert.ok(toolNames.includes("get_baby_overview"));
    assert.ok(toolNames.includes("record_baby_events"));
    assert.ok(toolNames.includes("record_health_measurement"));
    assert.ok(toolNames.includes("query_parenting_knowledge"));
    assert.ok(toolNames.includes("web_search"));

    // 2. tools/call: get_baby_overview (Composite Read)
    const callReq = new Request("http://localhost:3000/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "req-call-1",
        method: "tools/call",
        params: {
          name: "get_baby_overview",
          arguments: {},
        },
      }),
    });

    const callRes = await mcpPost(callReq);
    assert.equal(callRes.status, 200);
    const callBody = await callRes.json();
    assert.ok(callBody.result?.content?.[0]?.text);
    const overview = JSON.parse(callBody.result.content[0].text);
    assert.equal(overview.profile.nickname, "Baby A");
    assert.ok(overview.dailySummary !== undefined);

    // 3. tools/call: record_baby_events (Composite Multi-event Write)
    const feedReq = new Request("http://localhost:3000/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "req-call-2",
        method: "tools/call",
        params: {
          name: "record_baby_events",
          arguments: {
            feeding: {
              type: "formula",
              amountMl: 120,
              notes: "MCP remote test feed",
            },
            diaper: {
              type: "pee",
              notes: "MCP remote diaper change",
            },
          },
        },
      }),
    });

    const feedRes = await mcpPost(feedReq);
    assert.equal(feedRes.status, 200);
    const feedBody = await feedRes.json();
    assert.ok(feedBody.result?.content?.[0]?.text.includes("复合作息事件已成功保存"));

    // Verify records were written to DB with babyA ID
    const dbFeeding = await prisma.feedingRecord.findFirst({
      where: { babyId: babyA.id, notes: "MCP remote test feed" },
    });
    assert.ok(dbFeeding);
    assert.equal(dbFeeding.amountMl, 120);
    assert.equal(dbFeeding.recordedById, userA.id);

    const dbDiaper = await prisma.diaperRecord.findFirst({
      where: { babyId: babyA.id, notes: "MCP remote diaper change" },
    });
    assert.ok(dbDiaper);
  });

  await t.test("Test 7 — User Isolation & IDOR prevention", async () => {
    // Attempt to tamper with arguments to access Baby B using Token A
    const feedTamperReq = new Request("http://localhost:3000/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "req-idor-1",
        method: "tools/call",
        params: {
          name: "record_baby_events",
          arguments: {
            babyId: babyB.id, // Attacker tries to inject Baby B's ID
            userId: userB.id, // Attacker tries to inject User B's ID
            feeding: {
              type: "formula",
              amountMl: 999,
              notes: "Hacked feed",
            },
          },
        },
      }),
    });

    const feedTamperRes = await mcpPost(feedTamperReq);
    assert.equal(feedTamperRes.status, 200);

    // Verify that the record was NEVER created for Baby B!
    const babyBRecord = await prisma.feedingRecord.findFirst({
      where: { babyId: babyB.id, notes: "Hacked feed" },
    });
    assert.equal(babyBRecord, null, "Record must NOT be saved to Baby B!");

    // Verify that the record was saved to Baby A (the authenticated principal's baby)
    const babyARecord = await prisma.feedingRecord.findFirst({
      where: { babyId: babyA.id, notes: "Hacked feed" },
    });
    assert.ok(babyARecord, "Record is strictly scoped to Baby A");
    assert.equal(babyARecord.recordedById, userA.id);
  });

  await t.test("Test 8 — Permission / Scope Isolation", async () => {
    // Issue read-only token (scope: "baby:read")
    const { codeVerifier, codeChallenge } = generatePkce();

    const authReq = new Request("http://localhost:3000/api/oauth/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: dcrClient.client_id,
        redirectUri: "https://gemini.google.com/oauth/callback",
        scope: "baby:read", // Read-only scope!
        codeChallenge,
        codeChallengeMethod: "S256",
        resource: "http://localhost:3000/mcp",
        babyId: babyA.id,
        decision: "allow",
        username: userA.username,
        password: "password123",
      }),
    });

    const authRes = await authorizeApiRoute(authReq);
    const code = new URL((await authRes.json()).redirect_url).searchParams.get("code")!;

    const tokenReq = new Request("http://localhost:3000/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: "https://gemini.google.com/oauth/callback",
        client_id: dcrClient.client_id,
        code_verifier: codeVerifier,
      }).toString(),
    });

    const tokenRes = await tokenRoute(tokenReq);
    const readOnlyToken = (await tokenRes.json()).access_token;

    // 1. Read tool call should succeed
    const readReq = new Request("http://localhost:3000/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${readOnlyToken}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "req-read-1",
        method: "tools/call",
        params: { name: "get_baby_overview", arguments: {} },
      }),
    });
    const readRes = await mcpPost(readReq);
    assert.equal(readRes.status, 200);

    // 2. Write tool call must fail with permission error
    const writeReq = new Request("http://localhost:3000/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${readOnlyToken}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "req-write-fail-1",
        method: "tools/call",
        params: {
          name: "record_baby_events",
          arguments: { feeding: { type: "formula", amountMl: 50 } },
        },
      }),
    });
    const writeRes = await mcpPost(writeReq);
    const writeBody = await writeRes.json();
    assert.ok(writeBody.error || writeBody.result?.isError, "Write action must be rejected for read-only token");
  });

  await t.test("Test 9 — Token Revocation", async () => {
    // Revoke refresh token
    const revokeReq = new Request("http://localhost:3000/oauth/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: refreshTokenA,
        client_id: dcrClient.client_id,
      }).toString(),
    });

    const revokeRes = await revokeRoute(revokeReq);
    assert.equal(revokeRes.status, 200);

    // Attempt to use revoked refresh token -> must fail
    const refreshReq = new Request("http://localhost:3000/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshTokenA,
        client_id: dcrClient.client_id,
      }).toString(),
    });

    const refreshRes = await tokenRoute(refreshReq);
    assert.equal(refreshRes.status, 400);
  });

  await t.test("Test 10 — Wrong Audience is strictly rejected", async () => {
    // Issue token with audience = "https://api.other.com"
    const { codeVerifier, codeChallenge } = generatePkce();

    const authReq = new Request("http://localhost:3000/api/oauth/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: dcrClient.client_id,
        redirectUri: "https://gemini.google.com/oauth/callback",
        scope: "baby:read",
        codeChallenge,
        codeChallengeMethod: "S256",
        resource: "https://api.other.com", // WRONG AUDIENCE!
        babyId: babyA.id,
        decision: "allow",
        username: userA.username,
        password: "password123",
      }),
    });

    const authRes = await authorizeApiRoute(authReq);
    const code = new URL((await authRes.json()).redirect_url).searchParams.get("code")!;

    const tokenReq = new Request("http://localhost:3000/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: "https://gemini.google.com/oauth/callback",
        client_id: dcrClient.client_id,
        code_verifier: codeVerifier,
        resource: "https://api.other.com",
      }).toString(),
    });

    const wrongAudToken = (await (await tokenRoute(tokenReq)).json()).access_token;

    // Call /mcp with wrong-audience token -> must return 401
    const mcpReq = new Request("http://localhost:3000/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${wrongAudToken}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "req-wrong-aud",
        method: "tools/list",
        params: {},
      }),
    });

    const mcpRes = await mcpPost(mcpReq);
    assert.equal(mcpRes.status, 401);
    const wwwAuth = mcpRes.headers.get("www-authenticate");
    assert.ok(wwwAuth?.includes("invalid_token"));
  });

  await t.test("Test 11 — Static OAuth Client Fallback", async () => {
    const staticClient = STATIC_OAUTH_CLIENTS[0]; // gemini-spark-client
    assert.equal(staticClient.clientId, "gemini-spark-client");

    const { codeVerifier, codeChallenge } = generatePkce();

    const authReq = new Request("http://localhost:3000/api/oauth/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: staticClient.clientId,
        redirectUri: "https://gemini.google.com/oauth/callback",
        scope: "baby:read baby:write",
        codeChallenge,
        codeChallengeMethod: "S256",
        resource: "http://localhost:3000/mcp",
        babyId: babyA.id,
        decision: "allow",
        username: userA.username,
        password: "password123",
      }),
    });

    const authRes = await authorizeApiRoute(authReq);
    assert.equal(authRes.status, 200);
    const code = new URL((await authRes.json()).redirect_url).searchParams.get("code")!;

    // Exchange with static client secret
    const tokenReq = new Request("http://localhost:3000/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: "https://gemini.google.com/oauth/callback",
        client_id: staticClient.clientId,
        client_secret: staticClient.clientSecret,
        code_verifier: codeVerifier,
      }).toString(),
    });

    const tokenRes = await tokenRoute(tokenReq);
    assert.equal(tokenRes.status, 200);
    const tokenData = await tokenRes.json();
    assert.ok(tokenData.access_token);
    assert.ok(tokenData.refresh_token);
  });

  await t.test("Test 12 — Confused Deputy / Attacker /mcp Audience Spoofing is Rejected", async () => {
    // Generate a token minted for attacker.com/mcp
    const { codeVerifier, codeChallenge } = generatePkce();

    const authReq = new Request("http://localhost:3000/api/oauth/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: dcrClient.client_id,
        redirectUri: "https://gemini.google.com/oauth/callback",
        scope: "baby:read",
        codeChallenge,
        codeChallengeMethod: "S256",
        resource: "https://attacker.com/mcp", // Spoofed audience!
        babyId: babyA.id,
        decision: "allow",
        username: userA.username,
        password: "password123",
      }),
    });

    const authRes = await authorizeApiRoute(authReq);
    const code = new URL((await authRes.json()).redirect_url).searchParams.get("code")!;

    const tokenReq = new Request("http://localhost:3000/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: "https://gemini.google.com/oauth/callback",
        client_id: dcrClient.client_id,
        code_verifier: codeVerifier,
        resource: "https://attacker.com/mcp",
      }).toString(),
    });

    const tokenData = await (await tokenRoute(tokenReq)).json();
    const spoofedToken = tokenData.access_token;

    // Call local /mcp server with spoofed token -> must be rejected!
    const mcpReq = new Request("http://localhost:3000/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${spoofedToken}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "req-spoof-check",
        method: "tools/list",
        params: {},
      }),
    });

    const mcpRes = await mcpPost(mcpReq);
    assert.equal(mcpRes.status, 401, "Token for attacker.com/mcp MUST be rejected with 401 on local /mcp");
  });

  await t.test("Test 13 — Race Condition: Concurrent Auth Code Exchange", async () => {
    const { codeVerifier, codeChallenge } = generatePkce();

    const authReq = new Request("http://localhost:3000/api/oauth/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: dcrClient.client_id,
        redirectUri: "https://gemini.google.com/oauth/callback",
        scope: "baby:read",
        codeChallenge,
        codeChallengeMethod: "S256",
        resource: "http://localhost:3000/mcp",
        babyId: babyA.id,
        decision: "allow",
        username: userA.username,
        password: "password123",
      }),
    });

    const authRes = await authorizeApiRoute(authReq);
    const code = new URL((await authRes.json()).redirect_url).searchParams.get("code")!;

    // Send 2 concurrent requests with the exact same code
    const makeReq = () =>
      new Request("http://localhost:3000/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: "https://gemini.google.com/oauth/callback",
          client_id: dcrClient.client_id,
          code_verifier: codeVerifier,
        }).toString(),
      });

    const [res1, res2] = await Promise.all([tokenRoute(makeReq()), tokenRoute(makeReq())]);

    const statuses = [res1.status, res2.status].sort();
    assert.deepEqual(statuses, [200, 400], "Exactly one concurrent exchange must succeed and one must fail with 400");
  });

  await t.test("Test 14 — Race Condition: Concurrent Refresh Token Rotation", async () => {
    const { codeVerifier, codeChallenge } = generatePkce();

    const authReq = new Request("http://localhost:3000/api/oauth/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: dcrClient.client_id,
        redirectUri: "https://gemini.google.com/oauth/callback",
        scope: "baby:read",
        codeChallenge,
        codeChallengeMethod: "S256",
        resource: "http://localhost:3000/mcp",
        babyId: babyA.id,
        decision: "allow",
        username: userA.username,
        password: "password123",
      }),
    });

    const authRes = await authorizeApiRoute(authReq);
    const code = new URL((await authRes.json()).redirect_url).searchParams.get("code")!;

    const tokenReq = new Request("http://localhost:3000/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: "https://gemini.google.com/oauth/callback",
        client_id: dcrClient.client_id,
        code_verifier: codeVerifier,
      }).toString(),
    });

    const rt = (await (await tokenRoute(tokenReq)).json()).refresh_token;

    // Send 2 concurrent refresh requests with the same refresh token
    const makeRefreshReq = () =>
      new Request("http://localhost:3000/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: rt,
          client_id: dcrClient.client_id,
        }).toString(),
      });

    const [ref1, ref2] = await Promise.all([tokenRoute(makeRefreshReq()), tokenRoute(makeRefreshReq())]);

    const statuses = [ref1.status, ref2.status].sort();
    assert.deepEqual(statuses, [200, 400], "Exactly one concurrent refresh must succeed and one must fail with 400");
  });

  await t.test("Test 15 — Pre-deletion Snapshot & Undo / Rollback Restoration", async () => {
    // 1. Create a medical report
    const createReq = new Request("http://localhost:3000/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "req-create-med",
        method: "tools/call",
        params: {
          name: "record_health_measurement",
          arguments: {
            medicalReport: {
              title: "测试微量元素化验单",
              category: "trace_element",
              hospital: "儿童医院",
              items: [{ name: "锌", value: "76.5", unit: "umol/L" }],
            },
          },
        },
      }),
    });

    const createRes = await mcpPost(createReq);
    assert.equal(createRes.status, 200);

    const savedReport = await prisma.medicalReport.findFirst({
      where: { babyId: babyA.id, title: "测试微量元素化验单" },
    });
    assert.ok(savedReport);

    // 2. Delete the medical report
    const delReq = new Request("http://localhost:3000/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "req-del-med",
        method: "tools/call",
        params: {
          name: "record_health_measurement",
          arguments: {
            deleteAction: {
              type: "medical_report",
              id: savedReport.id,
            },
          },
        },
      }),
    });

    const delRes = await mcpPost(delReq);
    assert.equal(delRes.status, 200);

    // Verify it was deleted from medicalReport table
    const afterDel = await prisma.medicalReport.findUnique({ where: { id: savedReport.id } });
    assert.equal(afterDel, null);

    // Verify safety snapshot was captured in RecordSnapshot
    const snapshot = await prisma.recordSnapshot.findFirst({
      where: { babyId: babyA.id, entityType: "medical_report", entityId: savedReport.id },
    });
    assert.ok(snapshot);
    assert.equal(snapshot.restored, false);

    // 3. Trigger Undo / Rollback via MCP
    const undoReq = new Request("http://localhost:3000/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "req-undo-med",
        method: "tools/call",
        params: {
          name: "record_health_measurement",
          arguments: {
            undoAction: {
              entityType: "medical_report",
            },
          },
        },
      }),
    });

    const undoRes = await mcpPost(undoReq);
    assert.equal(undoRes.status, 200);
    const undoBody = await undoRes.json();
    assert.ok(undoBody.result?.content?.[0]?.text.includes("已成功撤销并恢复"));

    // Verify the record is restored in database
    const restoredReport = await prisma.medicalReport.findFirst({
      where: { babyId: babyA.id, title: "测试微量元素化验单" },
    });
    assert.ok(restoredReport);
    assert.equal(restoredReport.hospital, "儿童医院");

    // Verify snapshot is marked as restored
    const updatedSnap = await prisma.recordSnapshot.findUnique({ where: { id: snapshot.id } });
    assert.equal(updatedSnap?.restored, true);
  });
});
