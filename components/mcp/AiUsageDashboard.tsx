"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Bot,
  Activity,
  Sparkles,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  TrendingUp,
  BarChart3,
  Database,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Filter,
  Search,
  Zap,
  ArrowDownRight,
  ArrowUpRight,
} from "lucide-react";
import { AgentBadge, AgentIcon } from "@/components/ui/AgentBadge";
import type { McpUsageDashboardData, AuditLogItem } from "@/lib/mcp/usage-service";

interface Props {
  babyId?: string;
  className?: string;
  onNavigateToDocs?: () => void;
}

function formatTimeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(isoString).toLocaleDateString("zh-CN");
}

function formatExactTime(isoString: string): string {
  const d = new Date(isoString);
  return `${d.toLocaleDateString("zh-CN")} ${d.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })}`;
}

export function AiUsageDashboard({ babyId, className = "", onNavigateToDocs }: Props) {
  const [data, setData] = useState<McpUsageDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 筛选状态
  const [selectedAgent, setSelectedAgent] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const fetchUsageData = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const url = babyId ? `/api/mcp/usage?babyId=${encodeURIComponent(babyId)}` : "/api/mcp/usage";
      const res = await fetch(url);
      const json = await res.json();
      if (json.success && json.data) {
        setData(json.data);
      } else {
        setError(json.error || "获取统计数据失败");
      }
    } catch (err: any) {
      setError(err?.message || "网络请求异常");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [babyId]);

  useEffect(() => {
    fetchUsageData();
  }, [fetchUsageData]);

  if (loading && !data) {
    return (
      <div className="p-8 flex flex-col items-center justify-center space-y-3 text-text-muted">
        <RefreshCw size={28} className="animate-spin text-primary" />
        <p className="text-xs">正在汇总 AI 访问与使用统计...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="p-6 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-center space-y-3">
        <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
        <button
          type="button"
          onClick={() => fetchUsageData()}
          className="px-3.5 py-1.5 rounded-xl bg-rose-600 text-white text-xs font-semibold"
        >
          重试
        </button>
      </div>
    );
  }

  if (!data) return null;

  const { overview, connectedAgents, toolUsageRanking, dailyActivityTrend, recentAuditLogs } = data;

  // 过滤审计日志
  const filteredLogs = recentAuditLogs.filter((log) => {
    if (selectedAgent !== "all" && log.agentName !== selectedAgent) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTool = (log.toolName || "").toLowerCase().includes(q);
      const matchLabel = log.toolLabel.toLowerCase().includes(q);
      const matchAgent = log.agentName.toLowerCase().includes(q);
      const matchUser = log.userName.toLowerCase().includes(q);
      if (!matchTool && !matchLabel && !matchAgent && !matchUser) return false;
    }
    return true;
  });

  // 最大单日趋势值（用于条形图比例）
  const maxTrendTotal = Math.max(...dailyActivityTrend.map((d) => d.total), 1);

  return (
    <div className={`space-y-6 ${className}`}>
      {/* 1. Header with Refresh & Context */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-text-primary flex items-center gap-2">
            <Bot size={20} className="text-primary" />
            <span>AI 连接与 MCP 访问统计</span>
          </h2>
          <p className="text-xs text-text-secondary mt-0.5">
            实时汇总外部 AI（Gemini、ChatGPT、Claude、Cursor 等）对【{data.baby.nickname}】档案的查询与记录统计
          </p>
        </div>
        <button
          type="button"
          onClick={() => fetchUsageData(true)}
          disabled={refreshing}
          className="px-3 py-1.5 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
          title="刷新最新统计"
        >
          <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
          <span>{refreshing ? "刷新中..." : "刷新"}</span>
        </button>
      </div>

      {/* 2. 4 Stat Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Card 1: 已连接 AI */}
        <div className="p-4 rounded-2xl bg-gradient-to-br from-purple-500/10 via-indigo-500/5 to-transparent border border-purple-500/20 shadow-xs">
          <div className="flex items-center justify-between text-purple-600 dark:text-purple-400">
            <span className="text-[11px] font-medium text-text-secondary">已连接外部 AI</span>
            <Bot size={16} />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold font-mono text-text-primary">
              {overview.connectedAgentsCount}
            </span>
            <span className="text-[11px] text-text-muted">个客户端</span>
          </div>
          <p className="text-[10px] text-purple-600/80 dark:text-purple-400/80 mt-1 font-medium truncate">
            {connectedAgents.map((a) => a.agentName).slice(0, 2).join("、") || "暂无连接"}
          </p>
        </div>

        {/* Card 2: 累计调用次数 */}
        <div className="p-4 rounded-2xl bg-gradient-to-br from-primary/10 via-pink-500/5 to-transparent border border-primary/20 shadow-xs">
          <div className="flex items-center justify-between text-primary">
            <span className="text-[11px] font-medium text-text-secondary">累计访问 / 调用</span>
            <Zap size={16} />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold font-mono text-text-primary">
              {overview.totalCalls}
            </span>
            <span className="text-[11px] text-text-muted">次</span>
          </div>
          <p className="text-[10px] text-text-muted mt-1">
            读取 {overview.readCallsCount} · 写入 {overview.writeCallsCount}
          </p>
        </div>

        {/* Card 3: 今日调用 */}
        <div className="p-4 rounded-2xl bg-gradient-to-br from-sky-500/10 via-blue-500/5 to-transparent border border-sky-500/20 shadow-xs">
          <div className="flex items-center justify-between text-sky-600 dark:text-sky-400">
            <span className="text-[11px] font-medium text-text-secondary">今日 AI 访问</span>
            <Activity size={16} />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold font-mono text-text-primary">
              {overview.todayCalls}
            </span>
            <span className="text-[11px] text-text-muted">次 (7天: {overview.last7DaysCalls})</span>
          </div>
          <p className="text-[10px] text-sky-600/80 dark:text-sky-400/80 mt-1 font-medium">
            AI 写入数据 {overview.totalRecordsCreatedByAi} 条
          </p>
        </div>

        {/* Card 4: 响应与健康度 */}
        <div className="p-4 rounded-2xl bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-transparent border border-emerald-500/20 shadow-xs">
          <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400">
            <span className="text-[11px] font-medium text-text-secondary">响应与成功率</span>
            <ShieldCheck size={16} />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold font-mono text-text-primary">
              {overview.successRate}%
            </span>
            <span className="text-[11px] text-text-muted">成功率</span>
          </div>
          <p className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80 mt-1 font-medium">
            平均响应耗时 {overview.avgDurationMs} ms
          </p>
        </div>
      </div>

      {/* 3. 已连接的 AI 客户端列表 (Connected Agents Grid) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
            <Bot size={14} className="text-primary" />
            <span>已连接的 AI 客户端 ({connectedAgents.length})</span>
          </h3>
          <span className="text-[11px] text-text-muted">点击可单独筛选该 AI 访问明细</span>
        </div>

        {connectedAgents.length === 0 ? (
          <div className="p-6 rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 text-center space-y-2">
            <Bot size={32} className="mx-auto text-zinc-300 dark:text-zinc-700" />
            <p className="text-xs font-medium text-text-secondary">暂未连接外部 AI 客户端</p>
            <p className="text-[11px] text-text-muted max-w-sm mx-auto">
              您可以使用 Gemini、ChatGPT、Claude Desktop、Cursor 等支持 MCP 的软件连接宝宝工作台，开启全自动化育儿记录与洞察。
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {connectedAgents.map((agent) => {
              const isSelected = selectedAgent === agent.agentName;
              return (
                <div
                  key={agent.agentName}
                  onClick={() => setSelectedAgent(isSelected ? "all" : agent.agentName)}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer select-none relative overflow-hidden group ${
                    isSelected
                      ? "bg-primary/10 border-primary shadow-sm"
                      : "bg-card hover:bg-zinc-50 dark:hover:bg-zinc-800/50 border-zinc-200/80 dark:border-zinc-800/80 shadow-xs"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shadow-xs shrink-0 group-hover:scale-105 transition-transform">
                        <AgentIcon name={agent.agentName} size={22} />
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-bold text-text-primary">
                            {agent.agentName}
                          </span>
                        </div>
                        <span className="text-[11px] text-text-muted truncate block max-w-[140px]">
                          {agent.clientName !== agent.agentName ? agent.clientName : "MCP 智能连接"}
                        </span>
                      </div>
                    </div>

                    {/* Status badge */}
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-semibold flex items-center gap-1 shrink-0 ${
                        agent.status === "active"
                          ? "bg-emerald-50 text-emerald-600 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400"
                          : agent.status === "authorized"
                          ? "bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400"
                          : "bg-zinc-100 text-zinc-500 border border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400"
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          agent.status === "active"
                            ? "bg-emerald-500 animate-pulse"
                            : agent.status === "authorized"
                            ? "bg-blue-500"
                            : "bg-zinc-400"
                        }`}
                      />
                      {agent.status === "active" ? "活跃" : agent.status === "authorized" ? "已授权" : "休眠"}
                    </span>
                  </div>

                  {/* Stat numbers */}
                  <div className="mt-3.5 pt-3 border-t border-divider/60 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-[10px] text-text-muted block">调用次数</span>
                      <span className="font-mono font-bold text-text-primary text-sm">
                        {agent.totalCalls}{" "}
                        <span className="text-[10px] font-normal text-text-muted">
                          (今日 {agent.todayCalls})
                        </span>
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-text-muted block">最近活跃</span>
                      <span className="text-[11px] font-medium text-text-secondary">
                        {agent.totalCalls > 0 ? formatTimeAgo(agent.lastSeen) : "未开始"}
                      </span>
                    </div>
                  </div>

                  {/* Top tool & write count */}
                  {agent.topTool && (
                    <div className="mt-2.5 px-2.5 py-1.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 text-[11px] text-text-secondary flex items-center justify-between">
                      <span className="text-[10px] text-text-muted">最常调用:</span>
                      <span className="font-medium truncate max-w-[160px] text-primary">
                        {agent.topTool.label}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. 近 14 天活跃趋势图 (Daily Trend Chart) */}
      <div className="p-4 rounded-3xl bg-card border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp size={16} className="text-primary" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted">
              近 14 天 AI 调用量趋势
            </h3>
          </div>
          <span className="text-[11px] text-text-muted">
            最高单日调用: <span className="font-mono font-bold text-text-primary">{maxTrendTotal}</span> 次
          </span>
        </div>

        {/* Visual Bar Chart */}
        <div className="pt-2 overflow-x-auto pb-1">
          <div className="h-32 min-w-[320px] flex items-end gap-1 sm:gap-2">
            {dailyActivityTrend.map((d) => {
              const heightPercent = maxTrendTotal > 0 ? Math.max((d.total / maxTrendTotal) * 100, 4) : 4;
              return (
                <div
                  key={d.fullDate}
                  className="flex-1 flex flex-col items-center group relative cursor-pointer"
                >
                  {/* Tooltip */}
                  <div className="absolute bottom-full mb-2 hidden group-hover:flex flex-col items-center z-20 pointer-events-none">
                    <div className="px-2 py-1 rounded-lg bg-zinc-900 text-white text-[10px] whitespace-nowrap shadow-lg">
                      <div className="font-bold">{d.fullDate}</div>
                      <div>总调用: {d.total} 次</div>
                      {d.error > 0 && <div className="text-rose-400">异常: {d.error} 次</div>}
                    </div>
                    <div className="w-1.5 h-1.5 bg-zinc-900 rotate-45 -mt-0.5" />
                  </div>

                  {/* Value label on top of bar if > 0 */}
                  <span className="text-[9px] font-mono text-text-muted mb-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {d.total > 0 ? d.total : ""}
                  </span>

                  {/* Bar */}
                  <div className="w-full max-w-[28px] rounded-t-lg overflow-hidden bg-zinc-100 dark:bg-zinc-800 flex flex-col justify-end transition-all group-hover:scale-y-105" style={{ height: `${heightPercent}%` }}>
                    <div
                      className={`w-full h-full rounded-t-lg transition-all ${
                        d.total > 0
                          ? "bg-gradient-to-t from-primary to-indigo-500 group-hover:from-primary-dark group-hover:to-indigo-600"
                          : "bg-zinc-200/50 dark:bg-zinc-800/50"
                      }`}
                    />
                  </div>

                  {/* Date label */}
                  <span className="text-[9px] font-mono text-text-muted mt-2 scale-90 sm:scale-100">
                    {d.date}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 5. 高频工具调用排行 (Top Tools Ranking) */}
      <div className="p-4 rounded-3xl bg-card border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 size={16} className="text-primary" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted">
              高频工具调用排行 (TOP 10)
            </h3>
          </div>
          <span className="text-[11px] text-text-muted">共 {toolUsageRanking.length} 个工具被调用</span>
        </div>

        {toolUsageRanking.length === 0 ? (
          <p className="text-xs text-text-muted text-center py-4">暂无工具调用统计</p>
        ) : (
          <div className="space-y-2.5">
            {toolUsageRanking.slice(0, 10).map((tool, idx) => {
              const rankColor =
                idx === 0
                  ? "bg-amber-400 text-amber-950 font-bold"
                  : idx === 1
                  ? "bg-zinc-300 text-zinc-800 font-bold"
                  : idx === 2
                  ? "bg-amber-600 text-white font-bold"
                  : "bg-zinc-100 dark:bg-zinc-800 text-text-muted";

              return (
                <div key={tool.toolName} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-4 h-4 rounded-md flex items-center justify-center text-[10px] shrink-0 ${rankColor}`}>
                        {idx + 1}
                      </span>
                      <span className="font-semibold text-text-primary truncate">
                        {tool.label}
                      </span>
                      <span className="text-[10px] font-mono text-text-muted hidden sm:inline truncate">
                        ({tool.toolName})
                      </span>
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded-md font-semibold uppercase shrink-0 ${
                          tool.category === "write"
                            ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                            : tool.category === "manage"
                            ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                            : "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
                        }`}
                      >
                        {tool.category === "write" ? "写入" : tool.category === "manage" ? "管理" : "读取"}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 font-mono shrink-0">
                      <span className="font-bold text-text-primary">{tool.count} 次</span>
                      <span className="text-[10px] text-text-muted w-10 text-right">
                        {tool.percentage}%
                      </span>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="h-1.5 w-full bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        tool.category === "write"
                          ? "bg-amber-500"
                          : tool.category === "manage"
                          ? "bg-rose-500"
                          : "bg-primary"
                      }`}
                      style={{ width: `${Math.max(tool.percentage, 2)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 6. 最近访问记录明细 (Audit Trail Timeline) */}
      <div className="p-4 rounded-3xl bg-card border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-primary" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted">
              最近访问流水审计 ({filteredLogs.length})
            </h3>
          </div>

          {/* Controls: Agent Filter & Search */}
          <div className="flex items-center gap-2">
            {/* Agent Select */}
            <div className="relative">
              <select
                value={selectedAgent}
                onChange={(e) => setSelectedAgent(e.target.value)}
                className="text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-2.5 py-1.5 pr-7 text-text-primary appearance-none focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="all">全部 AI</option>
                {connectedAgents.map((a) => (
                  <option key={a.agentName} value={a.agentName}>
                    {a.agentName}
                  </option>
                ))}
              </select>
              <ChevronDown size={12} className="absolute right-2 top-2.5 text-text-muted pointer-events-none" />
            </div>

            {/* Keyword input */}
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索工具或用户..."
                className="text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl pl-7 pr-2.5 py-1.5 text-text-primary focus:outline-none focus:ring-1 focus:ring-primary w-28 sm:w-36"
              />
              <Search size={12} className="absolute left-2.5 top-2.5 text-text-muted pointer-events-none" />
            </div>
          </div>
        </div>

        {filteredLogs.length === 0 ? (
          <p className="text-xs text-text-muted text-center py-6">无匹配的访问记录</p>
        ) : (
          <div className="space-y-2">
            {filteredLogs.map((log) => {
              const isExpanded = expandedLogId === log.id;
              const hasError = log.authResult !== "success" || Boolean(log.errorMessage);

              return (
                <div
                  key={log.id}
                  onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                  className={`p-3 rounded-2xl border transition-all cursor-pointer ${
                    hasError
                      ? "bg-rose-50/50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/60"
                      : "bg-zinc-50/60 dark:bg-zinc-800/40 border-zinc-200/60 dark:border-zinc-800/60 hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {/* Agent Badge */}
                      <AgentBadge name={log.agentName} size="xs" />

                      {/* Tool Label */}
                      <span className="text-xs font-bold text-text-primary truncate">
                        {log.toolLabel}
                      </span>

                      {/* Category */}
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                          log.category === "write"
                            ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                            : "bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300"
                        }`}
                      >
                        {log.category === "write" ? "写入" : "读取"}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {/* Status indicator */}
                      {log.authResult === "success" ? (
                        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-950/50 px-1.5 py-0.5 rounded-md">
                          <CheckCircle2 size={11} /> 成功
                        </span>
                      ) : log.authResult === "denied" ? (
                        <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 font-semibold bg-amber-50 dark:bg-amber-950/50 px-1.5 py-0.5 rounded-md">
                          <AlertTriangle size={11} /> 拒绝
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] text-rose-600 dark:text-rose-400 font-semibold bg-rose-50 dark:bg-rose-950/50 px-1.5 py-0.5 rounded-md">
                          <XCircle size={11} /> 失败
                        </span>
                      )}

                      {/* Time */}
                      <span className="text-[11px] text-text-muted font-mono" title={formatExactTime(log.createdAt)}>
                        {formatTimeAgo(log.createdAt)}
                      </span>

                      {isExpanded ? <ChevronUp size={14} className="text-text-muted" /> : <ChevronDown size={14} className="text-text-muted" />}
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="mt-2.5 pt-2.5 border-t border-divider/60 text-[11px] text-text-secondary space-y-1 font-mono">
                      <div className="flex justify-between">
                        <span className="text-text-muted">具体工具方法:</span>
                        <span className="font-bold text-text-primary">{log.toolName || "无"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-text-muted">身份授权家长:</span>
                        <span>{log.userName} ({log.userRelation})</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-text-muted">精确耗时:</span>
                        <span>{log.durationMs !== null ? `${log.durationMs} ms` : "未知"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-text-muted">操作时间:</span>
                        <span>{formatExactTime(log.createdAt)}</span>
                      </div>
                      {log.ip && (
                        <div className="flex justify-between">
                          <span className="text-text-muted">客户端 IP:</span>
                          <span>{log.ip}</span>
                        </div>
                      )}
                      {log.errorMessage && (
                        <div className="mt-1.5 p-2 rounded-xl bg-rose-100/60 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 font-sans text-xs">
                          异常信息: {log.errorMessage}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
