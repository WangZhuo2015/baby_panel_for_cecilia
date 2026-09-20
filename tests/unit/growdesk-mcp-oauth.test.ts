import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { GROWDESK_CONFIG } from "../../lib/config";
import { prisma } from "../../lib/prisma";
import {
  ensureStaticClients,
  findClient,
  registerClient,
  createAuthorizationCode,
  exchangeAuthorizationCode,
  refreshAccessToken,
  revokeToken,
  verifyMcpAccessToken,
  OAuthError,
  resolveSourceAgent,
} from "../../lib/oauth/service";
import {
  createPersonalAccessToken,
  verifyPersonalAccessToken,
  listPersonalAccessTokens,
  revokePersonalAccessToken,
} from "../../lib/tokens";
import { createMcpServer, checkScope } from "../../lib/mcp/server";
import type { UserPrincipal } from "../../lib/oauth/types";

function generatePkce() {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

function getToolText(res: unknown): string {
  return String(((res as any)?.content?.[0] as any)?.text || "");
}

function parseToolJson<T = any>(res: unknown): T {
  return JSON.parse(getToolText(res));
}

test("Issue #5: GrowDesk MCP, OAuth 2.1 & Personal Access Tokens Matrix", async (t) => {
  const prevEnv = process.env.GROWDESK_ENABLED;
  process.env.GROWDESK_ENABLED = "true";

  t.after(() => {
    process.env.GROWDESK_ENABLED = prevEnv;
  });

  const baseUrl = "http://127.0.0.1:3089";

  // ═════════════════════════════════════════════════════════════════════
  // Section 1: OAuth 2.1 Full Protocol & Memory Persistence (Zero DB)
  // ═════════════════════════════════════════════════════════════════════
  await t.test("OAuth 2.1: Static Clients initialization in BFF mode", async () => {
    await ensureStaticClients();
    const staticClient = await findClient("gemini-spark-client");
    assert.ok(staticClient, "Static gemini-spark-client should be available in memory");
    assert.equal(staticClient.clientName, "Gemini Spark Connected App (Static Fallback)");
  });

  await t.test("OAuth 2.1: Dynamic Client Registration (RFC 7591)", async () => {
    const regPayload = {
      client_name: "Test External Agent",
      redirect_uris: ["https://agent.example.com/oauth/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_uri: "https://agent.example.com",
      token_endpoint_auth_method: "client_secret_post" as const,
    };
    const registered = await registerClient(regPayload, "127.0.0.1");
    assert.ok(registered.client_id, "Should return client_id");
    assert.ok(registered.client_secret, "Should return client_secret");
    assert.equal(registered.client_name, "Test External Agent");

    const found = await findClient(registered.client_id);
    assert.ok(found, "Registered client should be queryable via findClient");
    assert.equal(found.clientId, registered.client_id);
    assert.equal(found.clientName, "Test External Agent");

    // Reject non-HTTPS redirect URI
    await assert.rejects(
      async () => {
        await registerClient({
          client_name: "Insecure Agent",
          redirect_uris: ["http://insecure.example.com/cb"],
        });
      },
      (err: any) => err instanceof OAuthError && err.error === "invalid_redirect_uri"
    );
  });

  await t.test("OAuth 2.1: PKCE S256, Code Exchange & Replay Protection", async () => {
    const pkce = generatePkce();

    // 1. Exchange with wrong codeVerifier fails
    const authCode1 = await createAuthorizationCode({
      clientId: "gemini-spark-client",
      userId: "test-user-oauth-1",
      babyId: "test-baby-oauth-1",
      redirectUri: "https://gemini.google.com/oauth/callback",
      scope: "baby:read baby:write",
      codeChallenge: pkce.codeChallenge,
      codeChallengeMethod: "S256",
    });
    assert.ok(authCode1.startsWith("code_"), "Auth code should start with code_");

    await assert.rejects(
      async () => {
        await exchangeAuthorizationCode({
          clientId: "gemini-spark-client",
          clientSecret: "gemini-spark-secret-fallback-2026",
          code: authCode1,
          redirectUri: "https://gemini.google.com/oauth/callback",
          codeVerifier: "invalid_verifier_that_does_not_match_pkce_challenge",
          baseUrl,
        });
      },
      (err: any) => err instanceof OAuthError && err.error === "invalid_grant" && Boolean(err.errorDescription?.includes("PKCE"))
    );

    // 2. Exchange with wrong redirect_uri fails
    const authCode2 = await createAuthorizationCode({
      clientId: "gemini-spark-client",
      userId: "test-user-oauth-1",
      babyId: "test-baby-oauth-1",
      redirectUri: "https://gemini.google.com/oauth/callback",
      scope: "baby:read baby:write",
      codeChallenge: pkce.codeChallenge,
      codeChallengeMethod: "S256",
    });

    await assert.rejects(
      async () => {
        await exchangeAuthorizationCode({
          clientId: "gemini-spark-client",
          clientSecret: "gemini-spark-secret-fallback-2026",
          code: authCode2,
          redirectUri: "https://attacker.example.com/callback",
          codeVerifier: pkce.codeVerifier,
          baseUrl,
        });
      },
      (err: any) => err instanceof OAuthError && err.error === "invalid_grant" && Boolean(err.errorDescription?.includes("redirect_uri"))
    );

    // 3. Successful exchange consumes code and returns tokens
    const authCode3 = await createAuthorizationCode({
      clientId: "gemini-spark-client",
      userId: "test-user-oauth-1",
      babyId: "test-baby-oauth-1",
      redirectUri: "https://gemini.google.com/oauth/callback",
      scope: "baby:read baby:write",
      codeChallenge: pkce.codeChallenge,
      codeChallengeMethod: "S256",
    });

    const tokens = await exchangeAuthorizationCode({
      clientId: "gemini-spark-client",
      clientSecret: "gemini-spark-secret-fallback-2026",
      code: authCode3,
      redirectUri: "https://gemini.google.com/oauth/callback",
      codeVerifier: pkce.codeVerifier,
      baseUrl,
    });
    assert.ok(tokens.access_token, "Must return access_token");
    assert.ok(tokens.refresh_token, "Must return refresh_token");
    assert.equal(tokens.token_type, "Bearer");

    // Replay attack: reusing the same code must fail immediately
    await assert.rejects(
      async () => {
        await exchangeAuthorizationCode({
          clientId: "gemini-spark-client",
          clientSecret: "gemini-spark-secret-fallback-2026",
          code: authCode3,
          redirectUri: "https://gemini.google.com/oauth/callback",
          codeVerifier: pkce.codeVerifier,
          baseUrl,
        });
      },
      (err: any) => err instanceof OAuthError && err.error === "invalid_grant" && Boolean(err.errorDescription?.includes("replay detected"))
    );
  });

  await t.test("OAuth 2.1: Refresh Token Rotation and Revocation", async () => {
    const pkce = generatePkce();
    const authCode = await createAuthorizationCode({
      clientId: "gemini-spark-client",
      userId: "test-user-oauth-rot",
      babyId: "test-baby-oauth-rot",
      redirectUri: "https://gemini.google.com/oauth/callback",
      scope: "baby:read baby:write",
      codeChallenge: pkce.codeChallenge,
      codeChallengeMethod: "S256",
    });

    const tokens = await exchangeAuthorizationCode({
      clientId: "gemini-spark-client",
      clientSecret: "gemini-spark-secret-fallback-2026",
      code: authCode,
      redirectUri: "https://gemini.google.com/oauth/callback",
      codeVerifier: pkce.codeVerifier,
      baseUrl,
    });

    // 1. Refresh token exchange
    const refreshed = await refreshAccessToken({
      clientId: "gemini-spark-client",
      clientSecret: "gemini-spark-secret-fallback-2026",
      refreshToken: tokens.refresh_token!,
      baseUrl,
    });
    assert.ok(refreshed.access_token, "Should issue new access_token");
    assert.ok(refreshed.refresh_token, "Should issue new refresh_token");
    assert.notEqual(refreshed.refresh_token, tokens.refresh_token, "Refresh token must rotate");

    // 2. Old refresh token is revoked upon rotation
    await assert.rejects(
      async () => {
        await refreshAccessToken({
          clientId: "gemini-spark-client",
          clientSecret: "gemini-spark-secret-fallback-2026",
          refreshToken: tokens.refresh_token!,
          baseUrl,
        });
      },
      (err: any) => err instanceof OAuthError && err.error === "invalid_grant"
    );

    // 3. RFC 7009 Revoke Token
    await revokeToken({
      token: refreshed.refresh_token!,
      clientId: "gemini-spark-client",
      clientSecret: "gemini-spark-secret-fallback-2026",
    });

    // 4. Revoked token can no longer be refreshed
    await assert.rejects(
      async () => {
        await refreshAccessToken({
          clientId: "gemini-spark-client",
          clientSecret: "gemini-spark-secret-fallback-2026",
          refreshToken: refreshed.refresh_token!,
          baseUrl,
        });
      },
      (err: any) => err instanceof OAuthError && err.error === "invalid_grant"
    );
  });

  await t.test("OAuth 2.1: Audience & Resource Validation", async () => {
    const pkce = generatePkce();
    const authCode = await createAuthorizationCode({
      clientId: "gemini-spark-client",
      userId: "test-user-oauth-aud",
      babyId: "test-baby-oauth-aud",
      redirectUri: "https://gemini.google.com/oauth/callback",
      scope: "baby:read",
      codeChallenge: pkce.codeChallenge,
      codeChallengeMethod: "S256",
      resource: "https://attacker-resource.com/api",
    });

    const tokens = await exchangeAuthorizationCode({
      clientId: "gemini-spark-client",
      clientSecret: "gemini-spark-secret-fallback-2026",
      code: authCode,
      redirectUri: "https://gemini.google.com/oauth/callback",
      codeVerifier: pkce.codeVerifier,
      baseUrl,
      resource: "https://attacker-resource.com/api",
    });

    // Verification against local /mcp must reject token bound to attacker-resource
    await assert.rejects(
      async () => {
        await verifyMcpAccessToken(tokens.access_token);
      },
      (err: any) => err instanceof OAuthError && err.error === "invalid_token" && Boolean(err.errorDescription?.includes("audience mismatch"))
    );
  });

  // ═════════════════════════════════════════════════════════════════════
  // Section 2: Personal Access Tokens (PAT) Full Lifecycle in BFF Mode
  // ═════════════════════════════════════════════════════════════════════
  await t.test("PAT: Full Lifecycle & verifyMcpAccessToken compatibility", async () => {
    const userId = "pat-user-123";
    const pat = await createPersonalAccessToken(userId, "iOS Shortcut Agent");
    assert.ok(pat.token.startsWith("bp_pat_"), "Token must start with bp_pat_");
    assert.equal(pat.name, "iOS Shortcut Agent");

    // List PATs
    const list = await listPersonalAccessTokens(userId);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, pat.id);

    // Verify raw PAT
    const verified = await verifyPersonalAccessToken(pat.token);
    assert.ok(verified, "PAT must verify");
    assert.equal(verified.user.id, userId);

    // Verify through verifyMcpAccessToken
    const principal = await verifyMcpAccessToken(pat.token);
    assert.equal(principal.userId, userId);
    assert.equal(principal.clientId, "pat-client");
    assert.ok(principal.scopes.has("baby:read"), "Must include baby:read");
    assert.ok(principal.scopes.has("baby:write"), "Must include baby:write");

    // Revoke PAT
    const revokedOk = await revokePersonalAccessToken(userId, pat.id);
    assert.equal(revokedOk, true);

    // Verification after revocation must fail
    const verifyAfterRevoke = await verifyPersonalAccessToken(pat.token);
    assert.equal(verifyAfterRevoke, null);

    await assert.rejects(
      async () => {
        await verifyMcpAccessToken(pat.token);
      },
      (err: any) => err instanceof OAuthError && err.error === "invalid_token"
    );
  });

  // ═════════════════════════════════════════════════════════════════════
  // Section 3: Remote MCP Server Dual-Mode Tools Matrix & Isolation
  // ═════════════════════════════════════════════════════════════════════
  await t.test("Remote MCP Server: Scope Permissions Enforcement", async () => {
    const readOnlyPrincipal: UserPrincipal = {
      userId: "usr-ro",
      username: "parent_ro",
      displayName: "Read Only Parent",
      babyId: "baby-ro",
      scopes: new Set(["baby:read"]),
      clientId: "client-ro",
      sourceAgent: "Test Read Agent",
      baby: {
        id: "baby-ro",
        nickname: "Baby Read",
        gender: "female",
        birthDate: "2026-01-01",
        familyId: "fam-ro",
      },
    };

    const server = createMcpServer(readOnlyPrincipal, { accessToken: "token-ro" });
    const [cT, sT] = InMemoryTransport.createLinkedPair();
    await server.connect(sT);
    const client = new Client({ name: "test-ro-client", version: "1.0.0" }, { capabilities: {} });
    await client.connect(cT);

    // Read tool passes
    const userRes = await client.callTool({ name: "get_current_user", arguments: {} });
    const userData = parseToolJson(userRes);
    assert.equal(userData.user.id, "usr-ro");
    assert.equal(userData.activeBaby.id, "baby-ro");

    // Write tools must be rejected due to missing baby:write scope
    await assert.rejects(
      async () => {
        await client.callTool({
          name: "record_feeding",
          arguments: { type: "formula", amountMl: 100 },
        });
      },
      (err: any) => String(err).includes("Forbidden: Missing baby:write scope")
    );

    await assert.rejects(
      async () => {
        await client.callTool({
          name: "delete_record",
          arguments: { type: "feeding", recordId: "feed-1" },
        });
      },
      (err: any) => String(err).includes("Forbidden: Missing baby:write scope")
    );
  });

  await t.test("Remote MCP Server: Fine-Grained Upstream GrowDesk Operations", async () => {
    const originalFetch = globalThis.fetch;
    const interceptedRequests: Array<{ url: string; method: string; body: any; headers: any }> = [];

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      interceptedRequests.push({ url, method, body, headers: init?.headers });

      // Feeding write
      if (url.includes("/records/feeding") && method === "POST") {
        return new Response(
          JSON.stringify({
            data: {
              id: "growdesk-feed-1",
              babyId: "baby-rw",
              familyId: "fam-rw",
              feedingType: body.feedingType,
              occurredAt: body.occurredAt,
              amountMl: body.amountMl,
              notes: body.notes,
              source: "mcp",
              sourceAgent: "Gemini Spark",
              version: "1",
              createdAt: "2026-09-15T03:00:00.000Z",
              updatedAt: "2026-09-15T03:00:00.000Z",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      // Sleep write
      if (url.includes("/records/sleep") && method === "POST") {
        return new Response(
          JSON.stringify({
            data: {
              id: "growdesk-sleep-1",
              babyId: "baby-rw",
              familyId: "fam-rw",
              sleepType: body.sleepType,
              startedAt: body.startedAt,
              endedAt: body.endedAt,
              notes: body.notes,
              source: "mcp",
              sourceAgent: "Gemini Spark",
              version: "1",
              createdAt: "2026-09-15T03:00:00.000Z",
              updatedAt: "2026-09-15T03:00:00.000Z",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      // Diaper write
      if (url.includes("/records/diaper") && method === "POST") {
        return new Response(
          JSON.stringify({
            data: {
              id: "growdesk-diaper-1",
              babyId: "baby-rw",
              familyId: "fam-rw",
              diaperType: body.diaperType,
              poopColor: body.poopColor,
              occurredAt: body.occurredAt,
              notes: body.notes,
              source: "mcp",
              sourceAgent: "Gemini Spark",
              version: "1",
              createdAt: "2026-09-15T03:00:00.000Z",
              updatedAt: "2026-09-15T03:00:00.000Z",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      // Growth write
      if (url.includes("/growth-measurements") && method === "POST") {
        return new Response(
          JSON.stringify({
            data: {
              id: "growdesk-growth-1",
              babyId: "baby-rw",
              familyId: "fam-rw",
              weightKg: body.weightKg,
              heightCm: body.heightCm,
              headCircumferenceCm: body.headCircumferenceCm,
              measuredAt: body.measuredAt,
              notes: body.notes,
              version: "1",
              createdAt: "2026-09-15T03:00:00.000Z",
              updatedAt: "2026-09-15T03:00:00.000Z",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      // Supplement write
      if (url.includes("/records/supplement") && method === "POST") {
        return new Response(
          JSON.stringify({
            data: {
              id: "growdesk-supp-1",
              babyId: "baby-rw",
              familyId: "fam-rw",
              supplementName: body.supplementName,
              occurredAt: body.occurredAt,
              amount: body.amount,
              notes: body.notes,
              version: "1",
              createdAt: "2026-09-15T03:00:00.000Z",
              updatedAt: "2026-09-15T03:00:00.000Z",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      // Durable delete/restore snapshot endpoints
      if (url.includes("/record-snapshots/feeding/growdesk-feed-1") && method === "DELETE") {
        return new Response(
          JSON.stringify({
            data: {
              snapshotId: "test_snapshot_feed_1",
              deletedId: "growdesk-feed-1",
              entityType: "feeding",
              version: "2",
              replayed: false,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      if (url.endsWith("/record-snapshots/restore") && method === "POST") {
        return new Response(
          JSON.stringify({
            data: {
              snapshotId: "test_snapshot_feed_1",
              restoredId: "growdesk-feed-1",
              entityType: "feeding",
              version: "3",
              replayed: false,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      // Delete endpoint
      if (method === "DELETE") {
        return new Response(
          JSON.stringify({ success: true }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      // Record lists / timeline
      if (method === "GET") {
        return new Response(
          JSON.stringify({
            data: [],
            items: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ success: true }), { status: 200 });
    };

    try {
      const rwPrincipal: UserPrincipal = {
        userId: "usr-rw",
        username: "parent_rw",
        displayName: "Read Write Parent",
        babyId: "baby-rw",
        scopes: new Set(["baby:read", "baby:write", "knowledge:read"]),
        clientId: "gemini-spark-client",
        sourceAgent: "Gemini Spark",
        baby: {
          id: "baby-rw",
          nickname: "Baby RW",
          gender: "boy",
          birthDate: "2025-06-01",
          familyId: "fam-rw",
        },
      };

      const server = createMcpServer(rwPrincipal, { accessToken: "token-rw" });
      const [cT, sT] = InMemoryTransport.createLinkedPair();
      await server.connect(sT);
      const client = new Client({ name: "test-rw-client", version: "1.0.0" }, { capabilities: {} });
      await client.connect(cT);

      // 1. record_feeding
      const feedRes = await client.callTool({
        name: "record_feeding",
        arguments: { type: "formula", amountMl: 150, notes: "晚安奶" },
      });
      const feedData = parseToolJson(feedRes);
      assert.equal(feedData.success, true);
      assert.equal(feedData.record.id, "growdesk-feed-1");
      assert.equal(feedData.record.amountMl, 150);

      // 2. record_sleep
      const sleepRes = await client.callTool({
        name: "record_sleep",
        arguments: { type: "nap", startTime: "13:00", endTime: "14:30" },
      });
      const sleepData = parseToolJson(sleepRes);
      assert.equal(sleepData.success, true);
      assert.equal(sleepData.record.id, "growdesk-sleep-1");

      // 3. record_diaper
      const diaperRes = await client.callTool({
        name: "record_diaper",
        arguments: { type: "dirty", poopColor: "yellow", notes: "正常" },
      });
      const diaperData = parseToolJson(diaperRes);
      assert.equal(diaperData.success, true);
      assert.equal(diaperData.record.id, "growdesk-diaper-1");

      // 4. record_growth
      const growthRes = await client.callTool({
        name: "record_growth",
        arguments: { weightKg: 10.5, heightCm: 76.0 },
      });
      const growthData = parseToolJson(growthRes);
      assert.equal(growthData.success, true);
      assert.equal(growthData.record.id, "growdesk-growth-1");

      // 5. record_supplement
      const suppRes = await client.callTool({
        name: "record_supplement",
        arguments: { name: "维生素D3", dose: 1, unitName: "滴" },
      });
      const suppData = parseToolJson(suppRes);
      assert.equal(suppData.success, true);
      assert.equal(suppData.record.id, "growdesk-supp-1");

      // 6. delete_record & restore_record snapshot
      const delRes = await client.callTool({
        name: "delete_record",
        arguments: { type: "feeding", recordId: "growdesk-feed-1" },
      });
      const delData = parseToolJson(delRes);
      assert.equal(delData.success, true);
      assert.equal(delData.deletedId, "growdesk-feed-1");

      const restoreRes = await client.callTool({
        name: "restore_record",
        arguments: { entityType: "feeding" },
      });
      const restoreData = parseToolJson(restoreRes);
      assert.equal(restoreData.success, true);
      assert.equal(restoreData.restoredId, "growdesk-feed-1");

      // 7. Offline static knowledge query
      const foodItemRes = await client.callTool({
        name: "query_food_item",
        arguments: { name: "苹果" },
      });
      const foodItemData = parseToolJson(foodItemRes);
      assert.ok(Array.isArray(foodItemData), "Should return food items array");
      assert.ok(foodItemData.length > 0, "Should match at least one food item");

      // Assert all upstream requests used the authenticated baby ID or family ID in the path
      for (const req of interceptedRequests) {
        assert.ok(
          req.url.includes("/api/v1/babies/baby-rw/") || req.url.includes("/api/v1/families/fam-rw/"),
          `Expected request to be scoped to baby-rw or fam-rw, got: ${req.url}`
        );
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test("Remote MCP Server: Multi-Tenant Session Isolation & IDOR Defense", async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];

    globalThis.fetch = async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input));
      return new Response(JSON.stringify({ data: { id: "res-id", version: "1" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    try {
      // Principal A: Alice, Baby Alpha
      const principalA: UserPrincipal = {
        userId: "usr-alice",
        username: "alice",
        displayName: "Alice",
        babyId: "baby-alpha",
        scopes: new Set(["baby:write", "baby:read"]),
        clientId: "client-a",
        sourceAgent: "Alice Agent",
        baby: { id: "baby-alpha", nickname: "Alpha", gender: "girl", birthDate: "2026-01-01", familyId: "fam-alpha" },
      };

      // Principal B: Bob, Baby Beta
      const principalB: UserPrincipal = {
        userId: "usr-bob",
        username: "bob",
        displayName: "Bob",
        babyId: "baby-beta",
        scopes: new Set(["baby:write", "baby:read"]),
        clientId: "client-b",
        sourceAgent: "Bob Agent",
        baby: { id: "baby-beta", nickname: "Beta", gender: "boy", birthDate: "2026-02-01", familyId: "fam-beta" },
      };

      const serverA = createMcpServer(principalA, { accessToken: "token-alice" });
      const [cTA, sTA] = InMemoryTransport.createLinkedPair();
      await serverA.connect(sTA);
      const clientA = new Client({ name: "client-a", version: "1.0" }, { capabilities: {} });
      await clientA.connect(cTA);

      const serverB = createMcpServer(principalB, { accessToken: "token-bob" });
      const [cTB, sTB] = InMemoryTransport.createLinkedPair();
      await serverB.connect(sTB);
      const clientB = new Client({ name: "client-b", version: "1.0" }, { capabilities: {} });
      await clientB.connect(cTB);

      // Alice tries an IDOR attack by passing babyId: 'baby-beta' in args
      await clientA.callTool({
        name: "record_feeding",
        arguments: {
          type: "formula",
          amountMl: 120,
          babyId: "baby-beta", // Malicious injection
          familyId: "fam-beta",
          userId: "usr-bob",
        } as any,
      });

      // Bob makes a normal call
      await clientB.callTool({
        name: "record_feeding",
        arguments: { type: "breast", amountMl: 90 },
      });

      // Assert that Alice's requests strictly went to baby-alpha / fam-alpha despite argument injection
      const aliceFeedUrl = requestedUrls.find((u) => u.includes("/babies/baby-alpha/records/feeding"));
      assert.ok(aliceFeedUrl, "Alice's feeding request must be scoped to baby-alpha");
      assert.ok(
        !requestedUrls.some((u) => u.includes("fam-beta") || (u.includes("baby-beta") && u.includes("usr-alice"))),
        "No parameters from Alice should leak to Bob's tenant"
      );

      // Assert that Bob's call went strictly to baby-beta
      const bobFeedUrl = requestedUrls.find((u) => u.includes("/babies/baby-beta/records/feeding"));
      assert.ok(bobFeedUrl, "Bob's feeding request must be scoped to baby-beta");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test("Remote MCP Server: Composite Alias Tools Matrix", async () => {
    const originalFetch = globalThis.fetch;
    const requestedPaths: string[] = [];

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || "GET";
      requestedPaths.push(`${method} ${url}`);

      if (url.endsWith("/babies/baby-comp")) {
        return new Response(JSON.stringify({ data: { id: "baby-comp", familyId: "fam-comp", name: "Baby Comp" } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/families/fam-comp")) {
        return new Response(JSON.stringify({ data: { id: "fam-comp", timeZone: "Asia/Shanghai" } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/timeline")) {
        return new Response(JSON.stringify({ data: { items: [] }, page: { nextCursor: null } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/records/feeding") && method === "POST") {
        return new Response(JSON.stringify({ data: { id: "feed-comp-1", feedingType: "formula", occurredAt: new Date().toISOString(), version: "1" } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/records/sleep") && method === "POST") {
        return new Response(JSON.stringify({ data: { id: "sleep-comp-1", sleepType: "nap", startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), version: "1" } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/records/diaper") && method === "POST") {
        return new Response(JSON.stringify({ data: { id: "diaper-comp-1", diaperType: "pee", occurredAt: new Date().toISOString(), version: "1" } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/growth-measurements") && method === "POST") {
        return new Response(JSON.stringify({ data: { id: "growth-comp-1", weightKg: "8.5", heightCm: "70.0", measuredAt: new Date().toISOString(), version: "1" } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/medical-reports") && method === "POST") {
        return new Response(JSON.stringify({ data: { id: "med-comp-1", title: "体检", reportDate: "2026-09-15", version: "1" } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/records/supplement") && method === "POST") {
        return new Response(JSON.stringify({ data: { id: "supp-comp-1", supplementName: "D3", occurredAt: new Date().toISOString(), version: "1" } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (method === "GET") {
        return new Response(JSON.stringify({ data: [], items: [], page: { nextCursor: null } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "content-type": "application/json" } });
    };

    try {
      const compPrincipal: UserPrincipal = {
        userId: "usr-comp",
        username: "comp_parent",
        displayName: "Composite Parent",
        babyId: "baby-comp",
        scopes: new Set(["baby:read", "baby:write", "knowledge:read"]),
        clientId: "gemini-spark-client",
        sourceAgent: "Gemini Spark",
        baby: {
          id: "baby-comp",
          nickname: "Baby Comp",
          gender: "girl",
          birthDate: "2026-01-01",
          familyId: "fam-comp",
        },
      };

      const server = createMcpServer(compPrincipal, { accessToken: "token-comp" });
      const [cT, sT] = InMemoryTransport.createLinkedPair();
      await server.connect(sT);
      const client = new Client({ name: "test-comp-client", version: "1.0.0" }, { capabilities: {} });
      await client.connect(cT);

      // 1. get_baby_overview
      const overviewRes = await client.callTool({
        name: "get_baby_overview",
        arguments: { date: "2026-09-15" },
      });
      const overviewData = parseToolJson(overviewRes);
      assert.equal(overviewData.profile.id, "baby-comp");
      assert.ok(overviewData.dailySummary, "Should return dailySummary");

      // 2. record_baby_events (feeding + sleep + diaper)
      const eventsRes = await client.callTool({
        name: "record_baby_events",
        arguments: {
          feeding: { type: "formula", amountMl: 120 },
          sleep: { type: "nap", startTime: "12:00", endTime: "13:30" },
          diaper: { type: "pee" },
        },
      });
      const eventsText = getToolText(eventsRes);
      assert.ok(eventsText.includes("复合作息事件已成功保存"), "Should confirm saved events");
      assert.ok(eventsText.includes("喂养记录"), "Should include feeding");
      assert.ok(eventsText.includes("睡眠记录"), "Should include sleep");
      assert.ok(eventsText.includes("换尿布"), "Should include diaper");

      // 3. record_health_measurement (growth + medical report)
      const healthRes = await client.callTool({
        name: "record_health_measurement",
        arguments: {
          growth: { weightKg: 8.5, heightCm: 70.0 },
          medicalReport: { title: "六月龄体检", date: "2026-09-15" },
        },
      });
      const healthText = getToolText(healthRes);
      assert.ok(healthText.includes("健康档案更新成功"), "Should confirm health update");
      assert.ok(healthText.includes("生长测量"), "Should include growth");
      assert.ok(healthText.includes("化验单/体检档案"), "Should include medical report");

      // 4. query_parenting_knowledge (knowledge composite)
      const knowRes = await client.callTool({
        name: "query_parenting_knowledge",
        arguments: { category: "food", query: "米粉" },
      });
      const knowData = parseToolJson(knowRes);
      assert.ok(Array.isArray(knowData.foods), "Should return foods array");
      assert.ok(knowData.foods.length > 0, "Should contain matching food items");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ═════════════════════════════════════════════════════════════════════
  // Section 4: Final Verification of Zero SQLite Leakage
  // ═════════════════════════════════════════════════════════════════════
  await t.test("Zero Direct SQLite Leak Guarantee: Legacy DB is completely disabled in BFF mode", () => {
    assert.throws(
      () => {
        // Attempting to touch any legacy database model throws immediately
        (prisma as any).feedingRecord.findMany();
      },
      (err: any) => String(err).includes("GROWDESK_LEGACY_DB_DISABLED")
    );
  });
});
