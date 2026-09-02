import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import dotenv from "dotenv";
dotenv.config();

import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { getBaseUrl } from "@/lib/oauth/config";
import {
  createAuthorizationCode,
  exchangeAuthorizationCode,
  registerClient,
  resolveSourceAgent,
  verifyMcpAccessToken,
} from "@/lib/oauth/service";
import { POST as mcpPost } from "@/app/mcp/route";
import * as records from "@/lib/records/service";

function generatePkce() {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

test("MCP Source Attribution (Gemini Spark, ChatGPT, Claude, Custom Agents)", async (t) => {
  const prefix = `test_${Date.now()}_`;
  const passwordHash = await hashPassword("password123");

  const testUser = await prisma.user.create({
    data: {
      username: `${prefix}mcp_agent_user`,
      displayName: "Agent Parent",
      passwordHash,
    },
  });

  const testFamily = await prisma.family.create({
    data: {
      name: "Agent Family",
      inviteCode: `AF${Date.now().toString().slice(-4)}`,
      members: { create: [{ userId: testUser.id, role: "admin", relation: "mother" }] },
      babies: {
        create: [
          {
            nickname: "Agent Baby",
            gender: "female",
            birthDate: "2025-01-01",
          },
        ],
      },
    },
    include: { babies: true },
  });
  const testBaby = testFamily.babies[0];
  const baseUrl = getBaseUrl();

  await t.test("resolveSourceAgent correctly identifies agent names from clientId, clientName, and userAgent", () => {
    assert.equal(resolveSourceAgent("gemini-spark-client", "Gemini Spark Connected App"), "Gemini Spark");
    assert.equal(resolveSourceAgent("chatgpt-dcr-client-123", "ChatGPT Baby Assistant"), "ChatGPT");
    assert.equal(resolveSourceAgent(undefined, "OpenAI ChatGPT Custom GPT"), "ChatGPT");
    assert.equal(resolveSourceAgent("claude-desktop-client", "Claude Desktop"), "Claude");
    assert.equal(resolveSourceAgent(undefined, undefined, "Mozilla/5.0 Anthropic/Claude-3.5"), "Claude");
    assert.equal(resolveSourceAgent("cursor-client", "Cursor IDE"), "Cursor");
    assert.equal(resolveSourceAgent("custom-client-id", "Custom Medical AI"), "Custom Medical AI");
  });

  // 1. Gemini Spark Token & Operation
  const pkceGemini = generatePkce();
  const codeGemini = await createAuthorizationCode({
    clientId: "gemini-spark-client",
    userId: testUser.id,
    babyId: testBaby.id,
    redirectUri: "https://gemini.google.com/oauth/callback",
    scope: "baby:read baby:write",
    codeChallenge: pkceGemini.codeChallenge,
    codeChallengeMethod: "S256",
  });

  const tokensGemini = await exchangeAuthorizationCode({
    clientId: "gemini-spark-client",
    clientSecret: "gemini-spark-secret-fallback-2026",
    code: codeGemini,
    redirectUri: "https://gemini.google.com/oauth/callback",
    codeVerifier: pkceGemini.codeVerifier,
    baseUrl,
  });

  // Verify principal contains sourceAgent = "Gemini Spark"
  const principalGemini = await verifyMcpAccessToken(tokensGemini.access_token);
  assert.equal(principalGemini.sourceAgent, "Gemini Spark");

  await t.test("Gemini Spark records feeding and diaper via MCP with source attribution", async () => {
    const postReq = new Request(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokensGemini.access_token}`,
        "User-Agent": "Google-Gemini-Spark/1.0",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "req-gemini-1",
        method: "tools/call",
        params: {
          name: "record_baby_events",
          arguments: {
            feeding: {
              type: "formula",
              amountMl: 150,
              notes: "上午喂配方奶",
            },
            diaper: {
              type: "both",
              poopColor: "yellow",
              notes: "黄色软便",
            },
          },
        },
      }),
    });

    const res = await mcpPost(postReq);
    assert.equal(res.status, 200);

    const feeding = await prisma.feedingRecord.findFirst({
      where: { babyId: testBaby.id, amountMl: 150 },
    });
    assert.ok(feeding);
    assert.equal(feeding.source, "mcp");
    assert.equal(feeding.sourceAgent, "Gemini Spark");

    const diaper = await prisma.diaperRecord.findFirst({
      where: { babyId: testBaby.id, poopColor: "yellow" },
    });
    assert.ok(diaper);
    assert.equal(diaper.source, "mcp");
    assert.equal(diaper.sourceAgent, "Gemini Spark");
  });

  // 2. ChatGPT DCR Client Registration & Operation
  const dcrClient = await registerClient({
    client_name: "ChatGPT",
    redirect_uris: ["https://chatgpt.com/api/aip/mcp/callback"],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: "baby:read baby:write",
    token_endpoint_auth_method: "none",
  });

  const pkceGpt = generatePkce();
  const codeGpt = await createAuthorizationCode({
    clientId: dcrClient.client_id,
    userId: testUser.id,
    babyId: testBaby.id,
    redirectUri: "https://chatgpt.com/api/aip/mcp/callback",
    scope: "baby:read baby:write",
    codeChallenge: pkceGpt.codeChallenge,
    codeChallengeMethod: "S256",
  });

  const tokensGpt = await exchangeAuthorizationCode({
    clientId: dcrClient.client_id,
    code: codeGpt,
    redirectUri: "https://chatgpt.com/api/aip/mcp/callback",
    codeVerifier: pkceGpt.codeVerifier,
    baseUrl,
  });

  const principalGpt = await verifyMcpAccessToken(tokensGpt.access_token);
  assert.equal(principalGpt.sourceAgent, "ChatGPT");

  await t.test("ChatGPT records sleep and growth via MCP with source attribution", async () => {
    const postReq = new Request(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokensGpt.access_token}`,
        "User-Agent": "ChatGPT-User/2.0",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "req-gpt-1",
        method: "tools/call",
        params: {
          name: "record_baby_events",
          arguments: {
            sleep: {
              startTime: "13:00",
              endTime: "14:30",
              type: "day",
              notes: "午睡1.5小时",
            },
          },
        },
      }),
    });

    const res = await mcpPost(postReq);
    assert.equal(res.status, 200);

    const sleep = await prisma.sleepRecord.findFirst({
      where: { babyId: testBaby.id, notes: "午睡1.5小时" },
    });
    assert.ok(sleep);
    assert.equal(sleep.source, "mcp");
    assert.equal(sleep.sourceAgent, "ChatGPT");

    // Growth record via record_health_measurement
    const growthReq = new Request(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokensGpt.access_token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "req-gpt-2",
        method: "tools/call",
        params: {
          name: "record_health_measurement",
          arguments: {
            growth: {
              date: "2025-06-01",
              weightKg: 8.6,
              heightCm: 70.2,
            },
          },
        },
      }),
    });

    const growthRes = await mcpPost(growthReq);
    assert.equal(growthRes.status, 200);

    const growth = await prisma.growthMeasurement.findFirst({
      where: { babyId: testBaby.id, date: "2025-06-01" },
    });
    assert.ok(growth);
    assert.equal(growth.source, "mcp");
    assert.equal(growth.sourceAgent, "ChatGPT");
  });

  await t.test("Timeline query returns correct sourceAgent for all entries", async () => {
    const timeline = await records.getTimeline({
      userId: testUser.id,
      babyId: testBaby.id,
      familyId: testFamily.id,
    });

    assert.ok(timeline.length >= 2);
    const feedingEntry = timeline.find((e: any) => e.type === "feeding");
    assert.ok(feedingEntry);
    assert.equal(feedingEntry.source, "mcp");
    assert.equal(feedingEntry.sourceAgent, "Gemini Spark");

    const diaperEntry = timeline.find((e: any) => e.type === "diaper");
    assert.ok(diaperEntry);
    assert.equal(diaperEntry.source, "mcp");
    assert.equal(diaperEntry.sourceAgent, "Gemini Spark");
  });
});
