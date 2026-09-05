/**
 * MCP AI Usage & Audit Statistics Service
 * 聚合统计家庭宝宝已连接的外部 AI、调用量排行、近 14 天趋势及详细审计日志
 */

import { prisma } from "@/lib/prisma";
import { resolveSourceAgent } from "@/lib/oauth/service";
import { getToolMeta, ToolMeta } from "@/lib/mcp/tool-labels";

export interface ConnectedAgentSummary {
  agentName: string;
  clientId: string;
  clientName: string;
  totalCalls: number;
  todayCalls: number;
  successCount: number;
  errorCount: number;
  firstSeen: string;
  lastSeen: string;
  status: "active" | "idle" | "authorized";
  topTool: { toolName: string; label: string; count: number } | null;
  recordsWritten: number;
}

export interface ToolUsageStat {
  toolName: string;
  label: string;
  category: "read" | "write" | "manage";
  count: number;
  percentage: number;
}

export interface DailyActivityPoint {
  date: string; // MM-DD
  fullDate: string; // YYYY-MM-DD
  total: number;
  success: number;
  error: number;
}

export interface AuditLogItem {
  id: string;
  createdAt: string;
  agentName: string;
  toolName: string | null;
  toolLabel: string;
  category: "read" | "write" | "manage";
  action: string;
  authResult: "success" | "denied" | "error";
  durationMs: number | null;
  userName: string;
  userRelation: string;
  errorMessage: string | null;
  ip: string | null;
}

export interface McpUsageDashboardData {
  baby: {
    id: string;
    nickname: string;
    familyId: string;
    familyName: string;
  };
  overview: {
    totalCalls: number;
    todayCalls: number;
    last7DaysCalls: number;
    connectedAgentsCount: number;
    successRate: number;
    avgDurationMs: number;
    readCallsCount: number;
    writeCallsCount: number;
    manageCallsCount: number;
    totalRecordsCreatedByAi: number;
  };
  connectedAgents: ConnectedAgentSummary[];
  toolUsageRanking: ToolUsageStat[];
  dailyActivityTrend: DailyActivityPoint[];
  recentAuditLogs: AuditLogItem[];
}

/**
 * 获取指定用户及其当前家庭/宝宝的 MCP AI 访问与使用统计
 */
export async function getMcpUsageStatistics(
  userId: string,
  requestedBabyId?: string | null
): Promise<McpUsageDashboardData> {
  // 1. 查找用户及其家庭成员资格
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      memberships: {
        include: {
          family: {
            include: {
              babies: { orderBy: { createdAt: "asc" } },
              members: {
                include: {
                  user: {
                    select: { id: true, username: true, displayName: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!user || user.memberships.length === 0) {
    throw new Error("用户未加入任何家庭");
  }

  // 2. 确定目标宝宝与目标家庭
  let targetBaby: any = null;
  let targetFamily: any = null;

  if (requestedBabyId) {
    for (const m of user.memberships) {
      const match = m.family.babies.find((b) => b.id === requestedBabyId);
      if (match) {
        targetBaby = match;
        targetFamily = m.family;
        break;
      }
    }
  }

  if (!targetBaby) {
    const firstMembership = user.memberships[0];
    targetFamily = firstMembership.family;
    targetBaby = targetFamily.babies[0] || null;
  }

  if (!targetBaby) {
    throw new Error("家庭中未创建宝宝档案");
  }

  // 3. 构建家庭成员 ID 集合与姓名映射（防串号与租户隔离）
  const familyUserIds = targetFamily.members.map((m: any) => m.userId);
  const userMap = new Map<string, { displayName: string; relation: string }>();
  for (const m of targetFamily.members) {
    userMap.set(m.userId, {
      displayName: m.user.displayName || m.user.username,
      relation: m.relation || "家庭成员",
    });
  }

  // 4. 查询该家庭/宝宝下的全部相关审计日志
  // 严格隔离：仅查询 babyId 为当前宝宝，或由该家庭成员触发的操作
  const auditLogs = await prisma.oAuthAuditLog.findMany({
    where: {
      OR: [
        { babyId: targetBaby.id },
        { userId: { in: familyUserIds } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });

  // 5. 收集 clientIds 并查询关联的 OAuthClient
  const clientIds = Array.from(
    new Set(auditLogs.map((l) => l.clientId).filter(Boolean))
  ) as string[];
  const clients = await prisma.oAuthClient.findMany({
    where: { clientId: { in: clientIds } },
    select: { clientId: true, clientName: true, createdAt: true },
  });
  const clientMap = new Map(clients.map((c) => [c.clientId, c]));

  // 6. 查询已授权客户端（OAuthConsent）
  const consents = await prisma.oAuthConsent.findMany({
    where: {
      OR: [
        { babyId: targetBaby.id },
        { userId: { in: familyUserIds } },
      ],
    },
    include: { client: true },
  });

  // 7. 查询由 MCP 写入的快照/记录统计
  const snapshotCounts = await prisma.recordSnapshot.groupBy({
    by: ["sourceAgent"],
    where: { babyId: targetBaby.id },
    _count: { id: true },
  });
  const recordsWrittenByAgentMap = new Map<string, number>();
  let totalRecordsCreatedByAi = 0;
  for (const s of snapshotCounts) {
    const agent = s.sourceAgent || "外部 Agent (MCP)";
    const count = s._count.id;
    recordsWrittenByAgentMap.set(agent, (recordsWrittenByAgentMap.get(agent) || 0) + count);
    totalRecordsCreatedByAi += count;
  }

  // 8. 辅助函数：解析每条日志所属的 Agent 名称
  function getLogAgentName(log: typeof auditLogs[0]): string {
    if (log.metadataJson) {
      try {
        const meta = JSON.parse(log.metadataJson);
        if (meta.agent && typeof meta.agent === "string") return meta.agent;
      } catch {}
    }
    const client = log.clientId ? clientMap.get(log.clientId) : undefined;
    return resolveSourceAgent(
      log.clientId || undefined,
      client?.clientName || undefined,
      log.userAgent || undefined
    );
  }

  // 9. 计算总览数据 (Overview)
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  let totalCalls = 0;
  let todayCalls = 0;
  let last7DaysCalls = 0;
  let successCalls = 0;
  let totalDurationMs = 0;
  let durationCount = 0;
  let readCallsCount = 0;
  let writeCallsCount = 0;
  let manageCallsCount = 0;

  // 工具统计映射
  const toolCountMap = new Map<string, number>();

  // Agent 聚合统计
  interface AgentAgg {
    agentName: string;
    clientId: string;
    clientName: string;
    totalCalls: number;
    todayCalls: number;
    successCount: number;
    errorCount: number;
    firstSeen: Date;
    lastSeen: Date;
    toolCounts: Map<string, number>;
  }
  const agentAggMap = new Map<string, AgentAgg>();

  // 初始化来自 OAuthConsent 的已授权 Agent
  for (const consent of consents) {
    const agentName = resolveSourceAgent(
      consent.clientId,
      consent.client.clientName || undefined
    );
    if (!agentAggMap.has(agentName)) {
      agentAggMap.set(agentName, {
        agentName,
        clientId: consent.clientId,
        clientName: consent.client.clientName || agentName,
        totalCalls: 0,
        todayCalls: 0,
        successCount: 0,
        errorCount: 0,
        firstSeen: consent.createdAt,
        lastSeen: consent.updatedAt,
        toolCounts: new Map(),
      });
    }
  }

  for (const log of auditLogs) {
    if (log.action !== "mcp_tool_call") continue;

    totalCalls++;
    const logTime = log.createdAt.getTime();
    if (logTime >= oneDayAgo) todayCalls++;
    if (logTime >= sevenDaysAgo) last7DaysCalls++;

    const isSuccess = log.authResult === "success";
    if (isSuccess) successCalls++;

    if (log.durationMs && log.durationMs > 0) {
      totalDurationMs += log.durationMs;
      durationCount++;
    }

    const toolName = log.toolName || "unknown";
    toolCountMap.set(toolName, (toolCountMap.get(toolName) || 0) + 1);

    const toolMeta = getToolMeta(toolName);
    if (toolMeta.category === "read") readCallsCount++;
    else if (toolMeta.category === "write") writeCallsCount++;
    else manageCallsCount++;

    const agentName = getLogAgentName(log);
    let agg = agentAggMap.get(agentName);
    if (!agg) {
      const client = log.clientId ? clientMap.get(log.clientId) : undefined;
      agg = {
        agentName,
        clientId: log.clientId || "unknown",
        clientName: client?.clientName || agentName,
        totalCalls: 0,
        todayCalls: 0,
        successCount: 0,
        errorCount: 0,
        firstSeen: log.createdAt,
        lastSeen: log.createdAt,
        toolCounts: new Map(),
      };
      agentAggMap.set(agentName, agg);
    }

    agg.totalCalls++;
    if (logTime >= oneDayAgo) agg.todayCalls++;
    if (isSuccess) agg.successCount++;
    else agg.errorCount++;

    if (log.createdAt < agg.firstSeen) agg.firstSeen = log.createdAt;
    if (log.createdAt > agg.lastSeen) agg.lastSeen = log.createdAt;

    agg.toolCounts.set(toolName, (agg.toolCounts.get(toolName) || 0) + 1);
  }

  const successRate = totalCalls > 0 ? Math.round((successCalls / totalCalls) * 1000) / 10 : 100;
  const avgDurationMs = durationCount > 0 ? Math.round(totalDurationMs / durationCount) : 0;

  // 10. 构建已连接 Agent 列表
  const connectedAgents: ConnectedAgentSummary[] = Array.from(agentAggMap.values())
    .map((agg) => {
      let topTool: { toolName: string; label: string; count: number } | null = null;
      let maxToolCount = 0;
      for (const [tName, count] of agg.toolCounts.entries()) {
        if (count > maxToolCount) {
          maxToolCount = count;
          topTool = {
            toolName: tName,
            label: getToolMeta(tName).label,
            count,
          };
        }
      }

      const lastSeenTime = agg.lastSeen.getTime();
      let status: "active" | "idle" | "authorized" = "idle";
      if (agg.totalCalls === 0) {
        status = "authorized";
      } else if (now - lastSeenTime < 7 * 24 * 60 * 60 * 1000) {
        status = "active";
      }

      return {
        agentName: agg.agentName,
        clientId: agg.clientId,
        clientName: agg.clientName,
        totalCalls: agg.totalCalls,
        todayCalls: agg.todayCalls,
        successCount: agg.successCount,
        errorCount: agg.errorCount,
        firstSeen: agg.firstSeen.toISOString(),
        lastSeen: agg.lastSeen.toISOString(),
        status,
        topTool,
        recordsWritten: recordsWrittenByAgentMap.get(agg.agentName) || 0,
      };
    })
    .sort((a, b) => b.totalCalls - a.totalCalls);

  // 11. 构建工具调用排行 (Top Tools)
  const toolUsageRanking: ToolUsageStat[] = Array.from(toolCountMap.entries())
    .map(([toolName, count]) => {
      const meta = getToolMeta(toolName);
      return {
        toolName,
        label: meta.label,
        category: meta.category,
        count,
        percentage: totalCalls > 0 ? Math.round((count / totalCalls) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.count - a.count);

  // 12. 构建近 14 天趋势数据 (Daily Activity Trend)
  const dailyPointsMap = new Map<string, { total: number; success: number; error: number }>();
  const trendDays = 14;
  for (let i = trendDays - 1; i >= 0; i--) {
    const d = new Date(now - i * 24 * 60 * 60 * 1000);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const key = `${yyyy}-${mm}-${dd}`;
    dailyPointsMap.set(key, { total: 0, success: 0, error: 0 });
  }

  for (const log of auditLogs) {
    if (log.action !== "mcp_tool_call") continue;
    const d = log.createdAt;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const key = `${yyyy}-${mm}-${dd}`;

    const point = dailyPointsMap.get(key);
    if (point) {
      point.total++;
      if (log.authResult === "success") point.success++;
      else point.error++;
    }
  }

  const dailyActivityTrend: DailyActivityPoint[] = Array.from(dailyPointsMap.entries()).map(
    ([fullDate, p]) => {
      const parts = fullDate.split("-");
      return {
        date: `${parts[1]}-${parts[2]}`,
        fullDate,
        total: p.total,
        success: p.success,
        error: p.error,
      };
    }
  );

  // 13. 最近详细审计记录明细 (Latest 50 logs)
  const recentAuditLogs: AuditLogItem[] = auditLogs.slice(0, 50).map((log) => {
    let errorMsg: string | null = null;
    if (log.metadataJson) {
      try {
        const meta = JSON.parse(log.metadataJson);
        if (meta.error && typeof meta.error === "string") errorMsg = meta.error;
      } catch {}
    }

    const userInfo = log.userId ? userMap.get(log.userId) : undefined;
    const toolMeta = getToolMeta(log.toolName);

    return {
      id: log.id,
      createdAt: log.createdAt.toISOString(),
      agentName: getLogAgentName(log),
      toolName: log.toolName,
      toolLabel: toolMeta.label,
      category: toolMeta.category,
      action: log.action,
      authResult: (log.authResult as "success" | "denied" | "error") || "success",
      durationMs: log.durationMs,
      userName: userInfo?.displayName || "未知用户",
      userRelation: userInfo?.relation || "家庭成员",
      errorMessage: errorMsg,
      ip: log.ip,
    };
  });

  return {
    baby: {
      id: targetBaby.id,
      nickname: targetBaby.nickname,
      familyId: targetFamily.id,
      familyName: targetFamily.name,
    },
    overview: {
      totalCalls,
      todayCalls,
      last7DaysCalls,
      connectedAgentsCount: connectedAgents.length,
      successRate,
      avgDurationMs,
      readCallsCount,
      writeCallsCount,
      manageCallsCount,
      totalRecordsCreatedByAi,
    },
    connectedAgents,
    toolUsageRanking,
    dailyActivityTrend,
    recentAuditLogs,
  };
}
