"use client";

import React, { useEffect } from "react";
import { X, Bot } from "lucide-react";
import { AiUsageDashboard } from "./AiUsageDashboard";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  babyId?: string;
}

export function AiUsageModal({ isOpen, onClose, babyId }: Props) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm animate-fade-in cursor-pointer"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="已连接 AI 与访问统计"
    >
      <div
        className="relative w-full max-w-3xl max-h-[92vh] bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl border border-primary/20 flex flex-col overflow-hidden animate-scale-up cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="relative px-5 pt-5 pb-4 bg-gradient-to-br from-purple-500/10 via-primary/10 to-transparent border-b border-primary/10 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-purple-600 to-primary text-white flex items-center justify-center shadow-md shadow-primary/25">
              <Bot size={22} />
            </div>
            <div>
              <h3 className="text-base font-bold text-text-primary">
                已连接 AI 与访问统计 (MCP)
              </h3>
              <p className="text-xs text-text-secondary mt-0.5">
                查看 Gemini Spark、ChatGPT、Claude 等 AI 客户端的连接状态与历史调用
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full text-text-muted hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1">
          <AiUsageDashboard babyId={babyId} />
        </div>
      </div>
    </div>
  );
}
