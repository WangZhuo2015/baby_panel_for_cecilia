"use client";

import React, { useEffect, useState } from "react";
import { CloudOff, CloudUpload } from "lucide-react";
import { listPending, flushOutbox } from "@/lib/outbox";

/**
 * 全局在线/待同步状态指示器：
 * - 离线时显示"当前离线，数据保存在本机"
 * - 有 outbox 待同步记录时显示条数并可手动触发重放
 */
export const OfflineBanner: React.FC = () => {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [flushing, setFlushing] = useState(false);

  useEffect(() => {
    setOnline(navigator.onLine);

    const refreshCount = async () => {
      const items = await listPending();
      setPending(items.length);
    };
    refreshCount();

    const goOnline = async () => {
      setOnline(true);
      setFlushing(true);
      try {
        await flushOutbox();
      } finally {
        setFlushing(false);
        refreshCount();
      }
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
  }, []);

  // 手动刷新数据后也刷新计数
  useEffect(() => {
    const i = window.setInterval(async () => {
      if (navigator.onLine && pending > 0) {
        setFlushing(true);
        try { await flushOutbox(); } finally { setFlushing(false); }
      }
      const items = await listPending();
      setPending(items.length);
    }, 60_000);
    return () => window.clearInterval(i);
  }, [pending]);

  const showOffline = !online;
  const showPending = pending > 0;
  if (!showOffline && !showPending) return null;

  return (
    <div
      role="status"
      className={`mx-3 mt-2 flex items-center gap-2 rounded-[16px] px-3 py-2 text-xs ${
        showOffline ? "bg-amber-50 text-amber-700 border border-amber-200" : "bg-mint/15 text-text-secondary"
      }`}
    >
      {showOffline ? <CloudOff size={14} /> : <CloudUpload size={14} className={flushing ? "animate-pulse" : ""} />}
      <span className="flex-1">
        {showOffline
          ? "当前离线 · 新记录已保存在本机，联网后自动同步"
          : flushing
            ? "正在同步待处理记录…"
            : `${pending} 条记录待同步`}
      </span>
      {!showOffline && pending > 0 && (
        <button
          type="button"
          onClick={async () => {
            setFlushing(true);
            try { await flushOutbox(); } finally { setFlushing(false); listPending().then((i) => setPending(i.length)); }
          }}
          className="px-2 py-1 rounded-full bg-white/70 text-[11px] min-h-[28px]"
        >
          立即同步
        </button>
      )}
    </div>
  );
};
