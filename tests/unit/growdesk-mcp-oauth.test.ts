import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

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
} from "../../lib/oauth/service";
import {
  createPersonalAccessToken,
  verifyPersonalAccessToken,
  listPersonalAccessTokens,
  revokePersonalAccessToken,
} from "../../lib/tokens";
import { createMcpServer } from "../../lib/mcp/server";
import type { UserPrincipal } from "../../lib/oauth/types";
import type { McpBridgeRequest } from "../../lib/growdesk/mcp-client";

const upstream = "https://growdesk.test";

function reply(data: unknown): Response {
  return Response.json({ data });
}

function oauthError(status: number, code: string): Response {
  return Response.json({ error: { code, message: code } }, { status });
}

function isOAuthError(code: string, status: number) {
  return (error: unknown) => error instanceof OAuthError && error.error === code && error.statusCode === status;
}

function tokenResponse(accessToken: string, refreshToken: string) {
  return { access_token: accessToken, refresh_token: refreshToken, token_type: "Bearer", expires_in: 900, scope: "baby:read" };
}

type OAuthRequest = { path: string; body?: object; accessToken?: string; response: Response };

function mockOAuthRequests(t: TestContext, expectations: OAuthRequest[]) {
  const pending = [...expectations];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const expected = pending.shift();
    assert.ok(expected, "Unexpected OAuth request to " + String(input));
    assert.equal(String(input), upstream + expected.path);
    assert.equal(init?.method, expected.body === undefined ? "GET" : "POST");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), expected.accessToken ? "Bearer " + expected.accessToken : null);
    assert.equal(headers.has("x-user-id"), false);
    assert.deepEqual(init?.body === undefined ? undefined : JSON.parse(String(init.body)), expected.body);
    return expected.response;
  });
  t.after(() => assert.deepEqual(pending.map(({ path }) => path), [], "Missing OAuth requests"));
}

function readBridgeRequest(input: RequestInfo | URL, init?: RequestInit) {
  assert.equal(String(input), upstream + "/api/v1/mcp/bridge");
  assert.equal(init?.method, "POST");
  const request = JSON.parse(String(init?.body)) as McpBridgeRequest;
  const headers = new Headers(init?.headers);
  for (const name of ["x-user-id", "x-family-id", "x-baby-id"]) assert.equal(headers.has(name), false);
  return { ...request, authorization: headers.get("authorization") };
}

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
  const env = {
    GROWDESK_ENABLED: "true",
    GROWDESK_BACKEND: "go",
    GROWDESK_API_URL: upstream,
  };
  for (const [key, value] of Object.entries(env)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    throw new Error(`Unexpected GrowDesk request: ${String(input)}`);
  });

  const baseUrl = "http://127.0.0.1:3089";

  const clientId = "test_oauth_client";
  const clientSecret = "test_oauth_secret";
  const redirectUri = "https://client.test/callback";
  const babyId = "test_baby_oauth";
  const session = "test_bff_session";
  const resource = baseUrl + "/mcp";
  const scope = "baby:read";
  const credentials = { clientId, clientSecret };
  const clientAuthentication = {
    client_id: clientId,
    client_secret: clientSecret,
    client_auth_method: "client_secret_post",
  };
  const authorizePath = "/api/v1/mcp/oauth/authorize";
  const tokenPath = "/api/v1/mcp/oauth/token";

  await t.test("OAuth client registration delegates to GrowDesk and lookup omits secrets", async (t) => {
    const client = {
      client_id: clientId,
      client_name: "Test External Agent",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "client_secret_post" as const,
      scope,
    };
    const registration = {
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      token_endpoint_auth_method: client.token_endpoint_auth_method,
      scope,
    };
    mockOAuthRequests(t, [
      { path: "/api/v1/mcp/oauth/register", body: registration, response: reply({ ...client, client_secret: clientSecret }) },
      { path: "/api/v1/mcp/oauth/clients/" + clientId, response: reply(client) },
      { path: "/api/v1/mcp/oauth/clients/test_missing", response: oauthError(404, "NOT_FOUND") },
    ]);

    await ensureStaticClients();
    const registered = await registerClient(registration);
    assert.equal(registered.client_id, clientId);
    assert.equal(registered.client_secret, clientSecret);

    const found = await findClient(clientId);
    assert.equal(found?.clientId, clientId);
    assert.equal(found?.clientName, client.client_name);
    assert.equal(found?.clientSecret, null);
    assert.equal(await findClient("test_missing"), null);
    await assert.rejects(
      registerClient({ redirect_uris: ["http://client.test/callback"] }),
      isOAuthError("invalid_redirect_uri", 400),
    );
  });

  await t.test("OAuth forwards the authenticated baby, S256 exchange, and single-use rejection", async (t) => {
    const { codeVerifier, codeChallenge } = generatePkce();
    const authorization = {
      clientId,
      babyId,
      redirectUri,
      scope,
      resource,
      codeChallenge,
      codeChallengeMethod: "S256",
    };
    const code = "code_test";
    const exchangeParams = { ...credentials, code, redirectUri, codeVerifier, resource, baseUrl };
    const exchangeBody = {
      ...clientAuthentication,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
      resource,
    };
    const invalidVerifier = generatePkce().codeVerifier;
    const otherRedirect = "https://client.test/other";
    const tokens = tokenResponse("test_access", "test_refresh");
    mockOAuthRequests(t, [
      { path: authorizePath, body: authorization, accessToken: session, response: reply({ code }) },
      { path: tokenPath, body: { ...exchangeBody, code_verifier: invalidVerifier }, response: oauthError(400, "invalid_grant") },
      { path: tokenPath, body: { ...exchangeBody, redirect_uri: otherRedirect }, response: oauthError(400, "invalid_grant") },
      { path: tokenPath, body: exchangeBody, response: reply(tokens) },
      { path: tokenPath, body: exchangeBody, response: oauthError(400, "invalid_grant") },
    ]);

    const params = { ...authorization, userId: "test_user_oauth" };
    await assert.rejects(createAuthorizationCode(params), isOAuthError("unauthorized", 401));
    await assert.rejects(
      createAuthorizationCode({ ...params, babyId: undefined, accessToken: session }),
      isOAuthError("unauthorized", 401),
    );
    assert.equal(await createAuthorizationCode({ ...params, accessToken: session }), code);
    await assert.rejects(
      exchangeAuthorizationCode({ ...exchangeParams, codeVerifier: invalidVerifier }),
      isOAuthError("invalid_grant", 400),
    );
    await assert.rejects(
      exchangeAuthorizationCode({ ...exchangeParams, redirectUri: otherRedirect }),
      isOAuthError("invalid_grant", 400),
    );
    assert.deepEqual(await exchangeAuthorizationCode(exchangeParams), tokens);
    await assert.rejects(exchangeAuthorizationCode(exchangeParams), isOAuthError("invalid_grant", 400));
  });

  await t.test("OAuth preserves refresh rotation, revocation, and Go rejection status", async (t) => {
    const refreshBody = {
      ...clientAuthentication,
      grant_type: "refresh_token",
      refresh_token: "test_refresh_original",
      resource,
    };
    const tokens = tokenResponse("test_access_rotated", "test_refresh_rotated");
    mockOAuthRequests(t, [
      { path: tokenPath, body: refreshBody, response: reply(tokens) },
      { path: tokenPath, body: refreshBody, response: oauthError(400, "invalid_grant") },
      {
        path: "/api/v1/mcp/oauth/revoke",
        body: { ...clientAuthentication, token: tokens.refresh_token },
        response: reply({ success: true }),
      },
      {
        path: tokenPath,
        body: { ...refreshBody, refresh_token: tokens.refresh_token },
        response: oauthError(400, "invalid_grant"),
      },
    ]);
    const params = { ...credentials, baseUrl, resource, refreshToken: refreshBody.refresh_token };
    assert.deepEqual(await refreshAccessToken(params), tokens);
    assert.notEqual(tokens.refresh_token, params.refreshToken);
    await assert.rejects(refreshAccessToken(params), isOAuthError("invalid_grant", 400));
    await revokeToken({ ...credentials, token: tokens.refresh_token });
    await assert.rejects(
      refreshAccessToken({ ...params, refreshToken: tokens.refresh_token }),
      isOAuthError("invalid_grant", 400),
    );
  });

  await t.test("OAuth honors GrowDesk resource and principal validation", async (t) => {
    const { codeChallenge, codeVerifier } = generatePkce();
    const foreignResource = "https://other.test/mcp";
    const userId = "test_user_oauth";
    const familyId = "test_family_oauth";
    const authorization = {
      clientId,
      babyId,
      redirectUri,
      scope,
      codeChallenge,
      codeChallengeMethod: "S256",
      resource: foreignResource,
    };
    const principalPath = "/api/v1/mcp/principal";
    const principal = {
      userId,
      username: userId,
      displayName: "Test caregiver",
      clientId,
      sourceAgent: "Test External Agent",
      scopes: [scope],
      babyId,
      baby: { id: babyId, familyId, nickname: babyId, gender: "unknown", birthDate: "2026-01-01" },
      member: { babyId, familyId, relation: "caregiver" },
    };
    mockOAuthRequests(t, [
      { path: authorizePath, body: authorization, accessToken: session, response: oauthError(400, "INVALID_RESOURCE") },
      {
        path: tokenPath,
        body: {
          ...clientAuthentication,
          grant_type: "authorization_code",
          code: "code_test_resource",
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
          resource: foreignResource,
        },
        response: oauthError(400, "invalid_target"),
      },
      { path: principalPath, accessToken: "test_wrong_audience", response: oauthError(401, "UNAUTHORIZED") },
      { path: principalPath, accessToken: "test_bound_audience", response: reply(principal) },
      {
        path: principalPath,
        accessToken: "test_inconsistent_principal",
        response: reply({ ...principal, member: { ...principal.member, familyId: "test_family_other" } }),
      },
    ]);
    await assert.rejects(
      createAuthorizationCode({ ...authorization, userId, accessToken: session }),
      isOAuthError("INVALID_RESOURCE", 400),
    );
    await assert.rejects(
      exchangeAuthorizationCode({
        ...credentials, baseUrl, code: "code_test_resource", redirectUri, codeVerifier, resource: foreignResource,
      }),
      isOAuthError("invalid_target", 400),
    );
    await assert.rejects(verifyMcpAccessToken("test_wrong_audience"), isOAuthError("invalid_token", 401));
    const verified = await verifyMcpAccessToken("test_bound_audience");
    assert.equal(verified.userId, userId);
    assert.equal(verified.babyId, babyId);
    assert.ok(verified.baby);
    assert.equal(verified.baby.familyId, familyId);
    assert.deepEqual(verified.scopes, new Set([scope]));
    await assert.rejects(verifyMcpAccessToken("test_inconsistent_principal"), isOAuthError("invalid_token", 401));
  });

  await t.test("Shared mode rejects PATs as MCP grants and Go rejects PAT storage", async () => {
    const userId = "test_user_pat";
    await assert.rejects(createPersonalAccessToken(userId), /not yet persisted by the Go backend/);
    await assert.rejects(listPersonalAccessTokens(userId), /not yet persisted by the Go backend/);
    await assert.rejects(revokePersonalAccessToken(userId, "test_pat"), /not yet persisted by the Go backend/);
    assert.equal(await verifyPersonalAccessToken("bp_pat_test"), null);
    await assert.rejects(verifyMcpAccessToken("bp_pat_test"), isOAuthError("invalid_token", 401));
  });

  await t.test("TypeScript PAT storage remains isolated by owner", async (t) => {
    process.env.GROWDESK_BACKEND = "typescript";
    const userId = "test_user_pat";
    const otherUserId = "test_user_pat_other";
    let tokenId: string | undefined;
    t.after(async () => {
      try {
        if (tokenId) await revokePersonalAccessToken(userId, tokenId);
      } finally {
        process.env.GROWDESK_BACKEND = "go";
      }
    });
    const pat = await createPersonalAccessToken(userId, "Test Shortcut Agent");
    tokenId = pat.id;

    assert.ok(pat.token.startsWith("bp_pat_"));
    assert.equal((await listPersonalAccessTokens(userId))[0]?.id, pat.id);
    assert.deepEqual(await listPersonalAccessTokens(otherUserId), []);
    assert.equal(await revokePersonalAccessToken(otherUserId, pat.id), false);
    assert.equal((await verifyPersonalAccessToken(pat.token))?.user.id, userId);
    await assert.rejects(verifyMcpAccessToken(pat.token), isOAuthError("invalid_token", 401));
    assert.equal(await revokePersonalAccessToken(userId, pat.id), true);
    assert.equal(await verifyPersonalAccessToken(pat.token), null);
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
    const interceptedPaths: string[] = [];

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const { path: url, method, body: payload, authorization } = readBridgeRequest(input, init);
      assert.equal(authorization, "Bearer token-rw");
      const body = payload as Record<string, unknown>;
      interceptedPaths.push(url);

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

      if (url.includes("/nutrition/supplement-products") && method === "POST") {
        return new Response(
          JSON.stringify({
            data: {
              id: "growdesk-supp-product-1",
              familyId: "fam-rw",
              name: body.name,
              brand: body.brand,
              dosageForm: body.dosageForm,
              unitName: body.unitName,
              defaultDose: body.defaultDose,
              nutrientsJson: body.nutrientsJson,
              notes: body.notes,
              isActive: true,
              isArchived: false,
              version: 1,
              createdAt: "2026-09-15T03:00:00.000Z",
              updatedAt: "2026-09-15T03:00:00.000Z",
            },
          }),
          { status: 201, headers: { "content-type": "application/json" } },
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

      if (method === "GET" && url === "/api/v1/families/fam-rw/nutrition/products") return reply([]);
      if (method === "GET" && url === "/api/v1/food/items?familyId=fam-rw") {
        return reply([{ id: "test_food_apple", name: "苹果" }]);
      }
      assert.fail(`Unexpected bridge request: ${method} ${url}`);
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

      const productRes = await client.callTool({
        name: "create_supplement_product",
        arguments: {
          name: "test_mcp_DHA",
          brand: "test_brand",
          dosageForm: "capsule",
          unitName: "粒",
          defaultDose: 1,
          nutrients: { dha: 100, vitamind: { amount: 400.126 } },
        },
      });
      const productData = parseToolJson(productRes);
      assert.equal(productData.success, true);
      assert.equal(productData.product.id, "growdesk-supp-product-1");
      assert.deepEqual(productData.product.nutrients, {
        dha: { amount: 100, unit: "mg" },
        vitamin_d: { amount: 400.13, unit: "IU" },
      });

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

      // 7. Family-scoped knowledge query
      const foodItemRes = await client.callTool({
        name: "query_food_item",
        arguments: { name: "苹果" },
      });
      const foodItemData = parseToolJson(foodItemRes);
      assert.ok(Array.isArray(foodItemData), "Should return food items array");
      assert.ok(foodItemData.length > 0, "Should match at least one food item");

      // Assert all upstream requests used the authenticated baby ID or family ID in the path
      for (const path of interceptedPaths) {
        assert.ok(
          path.startsWith("/api/v1/babies/baby-rw/") || path.startsWith("/api/v1/families/fam-rw/") ||
            path === "/api/v1/food/items?familyId=fam-rw",
          `Expected request to be scoped to baby-rw or fam-rw, got: ${path}`
        );
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test("Remote MCP Server: Multi-Tenant Session Isolation & IDOR Defense", async () => {
    const originalFetch = globalThis.fetch;
    const requests: ReturnType<typeof readBridgeRequest>[] = [];

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = readBridgeRequest(input, init);
      requests.push(request);
      if (request.method === "GET" && request.path === "/api/v1/families/fam-alpha/nutrition/products") return reply([]);
      if (request.method === "POST" && request.path.endsWith("/records/feeding")) {
        const body = request.body as Record<string, unknown>;
        return reply({ id: "test_feeding", version: "1", ...body });
      }
      assert.fail(`Unexpected bridge request: ${request.method} ${request.path}`);
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

      // Tenant identifiers in tool arguments cannot replace the verified principal.
      const aliceResponse = await clientA.callTool({
        name: "record_feeding",
        arguments: {
          type: "formula",
          amountMl: 120,
          babyId: "baby-beta",
          familyId: "fam-beta",
          userId: "usr-bob",
        } as any,
      });

      const bobResponse = await clientB.callTool({
        name: "record_feeding",
        arguments: { type: "breast", amountMl: 90 },
      });

      assert.equal(parseToolJson(aliceResponse).success, true);
      assert.equal(parseToolJson(bobResponse).success, true);
      assert.deepEqual(requests.map(({ method, path, authorization }) => [method, path, authorization]), [
        ["GET", "/api/v1/families/fam-alpha/nutrition/products", "Bearer token-alice"],
        ["POST", "/api/v1/babies/baby-alpha/records/feeding", "Bearer token-alice"],
        ["POST", "/api/v1/babies/baby-beta/records/feeding", "Bearer token-bob"],
      ]);
      for (const { body } of requests.filter(({ method }) => method === "POST")) {
        assert.ok(body && typeof body === "object");
        for (const field of ["userId", "familyId", "babyId"]) assert.equal(Object.hasOwn(body, field), false);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test("Remote MCP Server: Composite Alias Tools Matrix", async () => {
    const originalFetch = globalThis.fetch;
    const requestedPaths: string[] = [];

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const { method, path: url, body, authorization } = readBridgeRequest(input, init);
      assert.equal(authorization, "Bearer token-comp");
      requestedPaths.push(`${method} ${url}`);

      if (method === "GET" && url === "/api/v1/babies/baby-comp") return reply({ id: "baby-comp", familyId: "fam-comp" });
      if (method === "GET" && url === "/api/v1/families/fam-comp") return reply({ id: "fam-comp", timeZone: "Asia/Shanghai" });
      if (method === "GET" && url === "/api/v1/families/fam-comp/nutrition/products") return reply([]);
      if (method === "GET" && /^\/api\/v1\/babies\/baby-comp\/(?:timeline|records\/(?:feeding|sleep|diaper|food))\?limit=\d+$/.test(url)) {
        return Response.json({ data: [], page: { nextCursor: null } });
      }
      if (method === "BATCH" && url === "/api/v1/mcp/atomic-records") {
        const { requests } = body as { requests: McpBridgeRequest[] };
        assert.deepEqual(requests.map((request) => [request.method, request.path]), [
          ["POST", "/api/v1/babies/baby-comp/records/feeding"],
          ["POST", "/api/v1/babies/baby-comp/records/sleep"],
          ["POST", "/api/v1/babies/baby-comp/records/diaper"],
        ]);
        return reply({ results: requests.map(({ path }, index) => ({ path, status: "applied", result: { id: `test_record_${index}` } })) });
      }
      if (method === "POST" && url === "/api/v1/babies/baby-comp/growth-measurements") {
        return reply({ id: "test_growth", weightKg: "8.5", heightCm: "70.0", version: "1" });
      }
      if (method === "POST" && url === "/api/v1/babies/baby-comp/medical-reports") {
        return reply({ id: "test_medical_report", title: "体检", reportDate: "2026-09-15", version: "1" });
      }
      if (method === "GET" && url === "/api/v1/food/items?familyId=fam-comp") {
        return reply([{ id: "test_food_rice_cereal", name: "米粉" }]);
      }
      assert.fail(`Unexpected bridge request: ${method} ${url}`);
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

      // Each shared health request can perform only one write.
      const growth = { weightKg: 8.5, heightCm: 70.0 };
      const medicalReport = { title: "六月龄体检", date: "2026-09-15" };
      const requestCount = requestedPaths.length;
      await assert.rejects(
        client.callTool({ name: "record_health_measurement", arguments: { growth, medicalReport } }),
        /one write action per request/,
      );
      assert.equal(requestedPaths.length, requestCount);
      const growthRes = await client.callTool({ name: "record_health_measurement", arguments: { growth } });
      assert.match(getToolText(growthRes), /健康档案更新成功[\s\S]*生长测量/);
      const reportRes = await client.callTool({ name: "record_health_measurement", arguments: { medicalReport } });
      assert.match(getToolText(reportRes), /健康档案更新成功[\s\S]*化验单\/体检档案/);

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
