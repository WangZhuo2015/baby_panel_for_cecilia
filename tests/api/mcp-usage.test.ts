import assert from "node:assert/strict";
import test from "node:test";
import dotenv from "dotenv";
dotenv.config();

import { prisma } from "@/lib/prisma";
import { getMcpUsageStatistics } from "@/lib/mcp/usage-service";
import { GET as usageGet } from "@/app/api/mcp/usage/route";
import { hashPassword, signAuthToken, AUTH_COOKIE_NAME } from "@/lib/auth";

test("MCP AI Usage & Audit Statistics (Aggregator & Tenant Isolation)", async (t) => {
  const prefix = `test_${Date.now()}_`;
  const passwordHash = await hashPassword("password123");

  // 跑完清理测试租户（AGENTS.md 规范）
  t.after(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: prefix } } }).catch(() => {});
    await prisma.family
      .deleteMany({ where: { name: { startsWith: prefix }, members: { none: {} } } })
      .catch(() => {});
    await prisma.oAuthClient
      .deleteMany({ where: { clientId: { startsWith: prefix } } })
      .catch(() => {});
  });

  // 租户 1
  const user1 = await prisma.user.create({
    data: {
      username: `${prefix}user_1`,
      displayName: "妈妈王卓",
      passwordHash,
    },
  });

  const family1 = await prisma.family.create({
    data: {
      name: `${prefix}family_1`,
      inviteCode: `F1${Date.now().toString().slice(-4)}`,
      members: { create: [{ userId: user1.id, role: "admin", relation: "mother" }] },
      babies: {
        create: [
          {
            nickname: `${prefix}baby_cecilia`,
            gender: "female",
            birthDate: "2025-01-01",
          },
        ],
      },
    },
    include: { babies: true },
  });
  const baby1 = family1.babies[0];

  // 租户 2 (用于测试多租户隔离与防串号)
  const user2 = await prisma.user.create({
    data: {
      username: `${prefix}user_2`,
      displayName: "别家家长",
      passwordHash,
    },
  });

  const family2 = await prisma.family.create({
    data: {
      name: `${prefix}family_2`,
      inviteCode: `F2${Date.now().toString().slice(-4)}`,
      members: { create: [{ userId: user2.id, role: "admin", relation: "father" }] },
      babies: {
        create: [
          {
            nickname: `${prefix}baby_other`,
            gender: "male",
            birthDate: "2025-02-01",
          },
        ],
      },
    },
    include: { babies: true },
  });
  const baby2 = family2.babies[0];

  // 创建测试客户端
  const clientGemini = await prisma.oAuthClient.create({
    data: {
      clientId: `${prefix}gemini-spark-client`,
      clientName: "Gemini Spark AI",
      redirectUrisJson: JSON.stringify(["https://example.com/oauth/callback"]),
    },
  });

  const clientClaude = await prisma.oAuthClient.create({
    data: {
      clientId: `${prefix}claude-desktop-client`,
      clientName: "Claude Desktop",
      redirectUrisJson: JSON.stringify(["https://example.com/oauth/callback"]),
    },
  });

  const clientOther = await prisma.oAuthClient.create({
    data: {
      clientId: `${prefix}tenant2-client`,
      clientName: "Tenant 2 Client",
      redirectUrisJson: JSON.stringify(["https://example.com/oauth/callback"]),
    },
  });

  // 写入由 Gemini Spark 创建的快照
  await prisma.recordSnapshot.create({
    data: {
      babyId: baby1.id,
      userId: user1.id,
      source: "mcp",
      sourceAgent: "Gemini Spark",
      action: "delete",
      entityType: "feeding",
      entityId: "fake-feeding-1",
      payloadJson: JSON.stringify({ amountMl: 120 }),
    },
  });

  // 写入租户 1 的审计日志：
  // 1. Gemini Spark 调用 get_daily_summary (成功)
  await prisma.oAuthAuditLog.create({
    data: {
      clientId: clientGemini.clientId,
      userId: user1.id,
      babyId: baby1.id,
      action: "mcp_tool_call",
      toolName: "get_daily_summary",
      authResult: "success",
      durationMs: 35,
      metadataJson: JSON.stringify({ agent: "Gemini Spark", clientName: clientGemini.clientName }),
    },
  });

  // 2. Gemini Spark 调用 record_feeding (成功)
  await prisma.oAuthAuditLog.create({
    data: {
      clientId: clientGemini.clientId,
      userId: user1.id,
      babyId: baby1.id,
      action: "mcp_tool_call",
      toolName: "record_feeding",
      authResult: "success",
      durationMs: 48,
      metadataJson: JSON.stringify({ agent: "Gemini Spark", clientName: clientGemini.clientName }),
    },
  });

  // 3. Claude 调用 get_growth_records (成功)
  await prisma.oAuthAuditLog.create({
    data: {
      clientId: clientClaude.clientId,
      userId: user1.id,
      babyId: baby1.id,
      action: "mcp_tool_call",
      toolName: "get_growth_records",
      authResult: "success",
      durationMs: 25,
      metadataJson: JSON.stringify({ agent: "Claude", clientName: clientClaude.clientName }),
    },
  });

  // 4. Claude 调用 record_sleep (失败)
  await prisma.oAuthAuditLog.create({
    data: {
      clientId: clientClaude.clientId,
      userId: user1.id,
      babyId: baby1.id,
      action: "mcp_tool_call",
      toolName: "record_sleep",
      authResult: "error",
      durationMs: 15,
      metadataJson: JSON.stringify({
        agent: "Claude",
        clientName: clientClaude.clientName,
        error: "endTime must be after startTime",
      }),
    },
  });

  // 写入租户 2 的审计日志 (不能泄漏给租户 1)
  await prisma.oAuthAuditLog.create({
    data: {
      clientId: clientOther.clientId,
      userId: user2.id,
      babyId: baby2.id,
      action: "mcp_tool_call",
      toolName: "get_medical_reports",
      authResult: "success",
      durationMs: 100,
      metadataJson: JSON.stringify({ agent: "Tenant2 Secret Agent" }),
    },
  });

  await t.test("getMcpUsageStatistics computes accurate aggregation for tenant 1", async () => {
    const stats = await getMcpUsageStatistics(user1.id, baby1.id);

    assert.equal(stats.baby.id, baby1.id);
    assert.equal(stats.overview.totalCalls, 4);
    assert.equal(stats.overview.todayCalls, 4);
    assert.equal(stats.overview.readCallsCount, 2); // get_daily_summary, get_growth_records
    assert.equal(stats.overview.writeCallsCount, 2); // record_feeding, record_sleep
    assert.equal(stats.overview.successRate, 75); // 3 of 4 = 75%
    assert.equal(stats.overview.totalRecordsCreatedByAi, 1);

    // Connected agents check
    assert.equal(stats.connectedAgents.length, 2);
    const geminiAgent = stats.connectedAgents.find((a) => a.agentName === "Gemini Spark");
    assert.ok(geminiAgent);
    assert.equal(geminiAgent.totalCalls, 2);
    assert.equal(geminiAgent.successCount, 2);
    assert.equal(geminiAgent.recordsWritten, 1);

    const claudeAgent = stats.connectedAgents.find((a) => a.agentName === "Claude");
    assert.ok(claudeAgent);
    assert.equal(claudeAgent.totalCalls, 2);
    assert.equal(claudeAgent.successCount, 1);
    assert.equal(claudeAgent.errorCount, 1);

    // Tool rankings check
    assert.equal(stats.toolUsageRanking.length, 4);
    const dailySummaryStat = stats.toolUsageRanking.find((t) => t.toolName === "get_daily_summary");
    assert.ok(dailySummaryStat);
    assert.equal(dailySummaryStat.label, "获取当日育儿看板概览");
    assert.equal(dailySummaryStat.category, "read");
    assert.equal(dailySummaryStat.count, 1);

    // Daily trend check
    assert.equal(stats.dailyActivityTrend.length, 14);
    const lastPoint = stats.dailyActivityTrend[stats.dailyActivityTrend.length - 1];
    assert.equal(lastPoint.total, 4);
    assert.equal(lastPoint.success, 3);
    assert.equal(lastPoint.error, 1);

    // Recent logs check
    assert.equal(stats.recentAuditLogs.length, 4);
    const failedLog = stats.recentAuditLogs.find((l) => l.authResult === "error");
    assert.ok(failedLog);
    assert.equal(failedLog.toolName, "record_sleep");
    assert.equal(failedLog.errorMessage, "endTime must be after startTime");
    assert.equal(failedLog.userName, "妈妈王卓");
    assert.equal(failedLog.userRelation, "mother");
  });

  await t.test("Multi-tenant isolation: Tenant 1 cannot see Tenant 2's audit logs or agents", async () => {
    const stats1 = await getMcpUsageStatistics(user1.id, baby1.id);
    const hasTenant2Agent = stats1.connectedAgents.some((a) => a.agentName.includes("Tenant2"));
    assert.equal(hasTenant2Agent, false, "Tenant 1 must not see Tenant 2's connected agent");

    const hasTenant2Tool = stats1.recentAuditLogs.some((l) => l.toolName === "get_medical_reports");
    assert.equal(hasTenant2Tool, false, "Tenant 1 must not see Tenant 2's tool call log");

    // Check tenant 2 gets its own isolated stats
    const stats2 = await getMcpUsageStatistics(user2.id, baby2.id);
    assert.equal(stats2.overview.totalCalls, 1);
    assert.equal(stats2.connectedAgents[0].agentName, "Tenant2 Secret Agent");
  });

  await t.test("Multi-baby isolation: Logs for Baby 2 must never leak into Baby 1 stats when user owns both babies", async () => {
    // 同一家庭中创建二宝
    const babySibling = await prisma.baby.create({
      data: {
        familyId: family1.id,
        nickname: `${prefix}baby_sibling`,
        gender: "male",
        birthDate: "2025-06-01",
      },
    });

    // 为二宝写入审计日志
    await prisma.oAuthAuditLog.create({
      data: {
        clientId: clientGemini.clientId,
        userId: user1.id,
        babyId: babySibling.id,
        action: "mcp_tool_call",
        toolName: "record_diaper",
        authResult: "success",
        durationMs: 30,
        metadataJson: JSON.stringify({ agent: "Gemini Spark" }),
      },
    });

    // 查询大宝的统计，必须严格隔离，调用量维持 4，且绝不包含二宝的换尿布记录
    const statsBaby1 = await getMcpUsageStatistics(user1.id, baby1.id);
    assert.equal(statsBaby1.baby.id, baby1.id);
    assert.equal(statsBaby1.overview.totalCalls, 4, "大宝调用量必须保持为 4，不可混入二宝的数据");
    const hasSiblingDiaperLog = statsBaby1.recentAuditLogs.some(
      (l) => l.toolName === "record_diaper" && l.durationMs === 30
    );
    assert.equal(hasSiblingDiaperLog, false, "大宝日志流水中绝不能包含二宝的记录");

    // 查询二宝的独立统计
    const statsSibling = await getMcpUsageStatistics(user1.id, babySibling.id);
    assert.equal(statsSibling.baby.id, babySibling.id);
    assert.equal(statsSibling.overview.totalCalls, 1);
    assert.equal(statsSibling.recentAuditLogs[0].toolName, "record_diaper");
  });

  await t.test("GET /api/mcp/usage route handler requires authentication, validates babyId, and returns data", async () => {
    // 1. Unauthenticated request -> 401
    const unauthReq = new Request("http://localhost:3089/api/mcp/usage");
    const unauthRes = await usageGet(unauthReq);
    assert.equal(unauthRes.status, 401);

    // 2. Authenticated request -> 200 with data
    const sessionToken = await signAuthToken({
      userId: user1.id,
      username: user1.username,
    });

    const authReq = new Request(`http://localhost:3089/api/mcp/usage?babyId=${baby1.id}`, {
      headers: {
        cookie: `${AUTH_COOKIE_NAME}=${sessionToken}`,
      },
    });
    const authRes = await usageGet(authReq);
    assert.equal(authRes.status, 200);

    const json = await authRes.json();
    assert.equal(json.success, true);
    assert.equal(json.data.baby.id, baby1.id);
    assert.equal(json.data.overview.totalCalls, 4);
    assert.equal(json.data.connectedAgents.length, 2);

    // 3. Invalid babyId -> 400 Bad Request
    const invalidBabyReq = new Request("http://localhost:3089/api/mcp/usage?babyId=non-existent-id", {
      headers: {
        cookie: `${AUTH_COOKIE_NAME}=${sessionToken}`,
      },
    });
    const invalidRes = await usageGet(invalidBabyReq);
    assert.equal(invalidRes.status, 400);
    const invalidJson = await invalidRes.json();
    assert.equal(invalidJson.success, false);
    assert.match(invalidJson.error, /不存在或无权访问/);
  });
});
