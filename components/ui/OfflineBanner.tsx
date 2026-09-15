"use client";

import React, { useEffect, useState, useCallback } from "react";
import { CloudOff, CloudUpload, AlertTriangle, Download, Trash2, CheckCircle } from "lucide-react";
import { listPending, flushOutbox, claimOrphanEntries, removePending, type OutboxEntry } from "@/lib/outbox";
import { useBabyStore } from "@/stores/useBabyStore";

/**
 * 全局在线/待同步状态指示器：
 * - 离线时显示"当前离线，数据保存在本机"
 * - 有 outbox 待同步记录时显示条数并按当前登录身份重放
 * - 409 冲突或未认领原稿提供查看、导出、认领与删除交互
 */
export const OfflineBanner: React.FC = () => {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [conflicts, setConflicts] = useState<OutboxEntry[]>([]);
  const [orphans, setOrphans] = useState<OutboxEntry[]>([]);
  const [flushing, setFlushing] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

  const user = useBabyStore((s) => s.user);
  const family = useBabyStore((s) => s.family);
  const baby = useBabyStore((s) => s.baby);

  const refreshCount = useCallback(async () => {
    const items = await listPending();
    const userItems = user?.id ? items.filter((i) => i.userId === user.id) : [];
    const conflictItems = items.filter((i) => i.status === "conflict" && (!i.userId || i.userId === user?.id));
    const orphanItems = items.filter((i) => !i.userId);

    setPending(userItems.filter((i) => i.status !== "conflict").length);
    setConflicts(conflictItems);
    setOrphans(orphanItems);
  }, [user?.id]);

  const triggerFlush = useCallback(async () => {
    if (!user?.id) return;
    setFlushing(true);
    try {
      await flushOutbox({
        activeUserId: user.id,
        activeFamilyId: family?.id,
        activeBabyId: baby?.id,
      });
    } finally {
      setFlushing(false);
      await refreshCount();
    }
  }, [user?.id, family?.id, baby?.id, refreshCount]);

  useEffect(() => {
    setOnline(navigator.onLine);
    refreshCount();

    const goOnline = async () => {
      setOnline(true);
      await triggerFlush();
    };
    const goOffline = () => setOnline(false);
    const timer = window.setInterval(refreshCount, 30_000);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.clearInterval(timer);
    };
  }, [refreshCount, triggerFlush]);

  // 定时周期重放
  useEffect(() => {
    const i = window.setInterval(async () => {
      if (navigator.onLine && pending > 0 && user?.id) {
        await triggerFlush();
      } else {
        await refreshCount();
      }
    }, 60_000);
    return () => window.clearInterval(i);
  }, [pending, user?.id, triggerFlush, refreshCount]);

  const handleExport = (entries: OutboxEntry[]) => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(entries, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `outbox-drafts-${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleClaimOrphans = async () => {
    if (!user?.id) return;
    await claimOrphanEntries(user.id, family?.id, baby?.id);
    await refreshCount();
    await triggerFlush();
  };

  const showOffline = !online;
  const showPending = pending > 0;
  const showConflicts = conflicts.length > 0;
  const showOrphans = orphans.length > 0;

  if (!showOffline && !showPending && !showConflicts && !showOrphans) return null;

  return (
    <div className="mx-3 mt-2 flex flex-col gap-1.5">
      <div
        role="status"
        className={`flex items-center gap-2 rounded-[16px] px-3 py-2 text-xs ${
          showOffline
            ? "bg-amber-50 text-amber-700 border border-amber-200"
            : showConflicts
              ? "bg-rose-50 text-rose-700 border border-rose-200"
              : "bg-mint/15 text-text-secondary"
        }`}
      >
        {showOffline ? (
          <CloudOff size={14} />
        ) : showConflicts ? (
          <AlertTriangle size={14} className="text-rose-600" />
        ) : (
          <CloudUpload size={14} className={flushing ? "animate-pulse" : ""} />
        )}
        <span className="flex-1">
          {showOffline
            ? "当前离线 · 新记录已保存在本机，联网后自动同步"
            : flushing
              ? "正在同步待处理记录…"
              : showConflicts
                ? `检测到 ${conflicts.length} 条提交版本冲突，原稿已妥善保留`
                : `${pending} 条记录待同步`}
        </span>

        {showConflicts && (
          <button
            type="button"
            onClick={() => setShowDetail((v) => !v)}
            className="px-2 py-1 rounded-full bg-white/80 text-[11px] font-medium text-rose-700 border border-rose-200 hover:bg-white"
          >
            {showDetail ? "收起冲突" : "查看冲突"}
          </button>
        )}

        {!showOffline && pending > 0 && (
          <button
            type="button"
            onClick={triggerFlush}
            disabled={flushing}
            className="px-2 py-1 rounded-full bg-white/70 text-[11px] min-h-[28px] hover:bg-white"
          >
            立即同步
          </button>
        )}
      </div>

      {showOrphans && user?.id && (
        <div className="flex items-center justify-between rounded-[12px] bg-sky-50 border border-sky-200 px-3 py-1.5 text-xs text-sky-800">
          <span>发现 {orphans.length} 条无主旧离线草稿</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleClaimOrphans}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-sky-600 text-white text-[11px] hover:bg-sky-700"
            >
              <CheckCircle size={12} />
              恢复至当前账号
            </button>
            <button
              type="button"
              onClick={() => handleExport(orphans)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white text-sky-700 border border-sky-300 text-[11px]"
            >
              <Download size={12} />
              导出
            </button>
          </div>
        </div>
      )}

      {showDetail && showConflicts && (
        <div className="rounded-[14px] bg-white border border-rose-200 p-3 shadow-sm text-xs space-y-2">
          <div className="flex items-center justify-between font-medium text-text-primary">
            <span>冲突原稿清单 ({conflicts.length})</span>
            <button
              type="button"
              onClick={() => handleExport(conflicts)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-100 text-text-secondary hover:bg-slate-200 text-[11px]"
            >
              <Download size={12} />
              全量导出 JSON
            </button>
          </div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {conflicts.map((c) => (
              <div
                key={c.clientId}
                className="flex items-start justify-between gap-2 p-2 rounded bg-rose-50/50 border border-rose-100"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[11px] text-rose-800 truncate">
                    {c.url} · {new Date(c.createdAt).toLocaleTimeString()}
                  </div>
                  <div className="text-[11px] text-text-secondary truncate mt-0.5">
                    {c.error?.message || "与服务端版本不一致 (409 Conflict)"}
                  </div>
                </div>
                <button
                  type="button"
                  title="删除该草稿"
                  onClick={async () => {
                    await removePending(c.clientId);
                    await refreshCount();
                  }}
                  className="text-rose-500 hover:text-rose-700 p-1"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
