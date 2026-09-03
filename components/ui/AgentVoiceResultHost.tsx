"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { AgentVoiceResultModal, type AgentVoiceLogData } from "./AgentVoiceResultModal";

export function AgentVoiceResultHost() {
  const [activeLog, setActiveLog] = useState<AgentVoiceLogData | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const checkedRef = useRef(false);

  const checkUnreadAsync = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/voice/logs?unreadAsync=true");
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.unreadLog) {
        setActiveLog(data.unreadLog);
        setIsOpen(true);
      }
    } catch {
      // ignore network errors
    }
  }, []);

  const checkDeepLink = useCallback(async (logId: string) => {
    try {
      const res = await fetch(`/api/agent/voice/logs/${logId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.log) {
        setActiveLog(data.log);
        setIsOpen(true);
      }
    } catch {
      // ignore
    }
  }, []);

  // 1. Initial check on mount: deep link query param or unread async log
  useEffect(() => {
    const deepLinkId = searchParams.get("agentVoiceLogId");
    if (deepLinkId) {
      checkDeepLink(deepLinkId);
      // Clean up URL query without refreshing page
      if (typeof window !== "undefined") {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.delete("agentVoiceLogId");
        window.history.replaceState({}, "", nextUrl.pathname + nextUrl.search);
      }
    } else if (!checkedRef.current) {
      checkedRef.current = true;
      checkUnreadAsync();
    }
  }, [searchParams, checkDeepLink, checkUnreadAsync]);

  // 2. Re-check when user returns to app (tab focus / visibility change)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        checkUnreadAsync();
      }
    };

    window.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleVisibilityChange);

    return () => {
      window.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleVisibilityChange);
    };
  }, [checkUnreadAsync]);

  const handleClose = async () => {
    if (activeLog?.id) {
      const logId = activeLog.id;
      // Mark acknowledged in background
      void fetch(`/api/agent/voice/logs/${logId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acknowledged: true }),
      }).catch(() => {});
    }
    setIsOpen(false);
  };

  return (
    <AgentVoiceResultModal
      isOpen={isOpen}
      log={activeLog}
      onClose={handleClose}
    />
  );
}
