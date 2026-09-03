"use client";

import React from "react";
import { Sparkles, Check, Clock, MessageSquare, ArrowRight, X } from "lucide-react";
import { formatIsoToLocalTime } from "@/lib/date";

export interface AgentVoiceLogData {
  id: string;
  prompt: string;
  reply: string;
  isAsync: boolean;
  isFastPath: boolean;
  createdAt: string | number | Date;
  baby?: {
    id: string;
    nickname: string;
    gender?: string;
  } | null;
}

interface Props {
  isOpen: boolean;
  log: AgentVoiceLogData | null;
  onClose: () => void;
}

export function AgentVoiceResultModal({ isOpen, log, onClose }: Props) {
  if (!isOpen || !log) return null;

  const timeStr =
    typeof log.createdAt === "string"
      ? formatIsoToLocalTime(log.createdAt)
      : typeof log.createdAt === "number"
        ? formatIsoToLocalTime(new Date(log.createdAt).toISOString())
        : formatIsoToLocalTime(log.createdAt.toISOString());

  const babyName = log.baby?.nickname || "宝宝";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div
        className="relative w-full max-w-md bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl border border-primary/20 overflow-hidden animate-scale-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header gradient banner */}
        <div className="relative px-6 pt-6 pb-4 bg-gradient-to-br from-primary/15 via-lavender/20 to-pink-500/10 border-b border-primary/10">
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-full text-text-muted hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            aria-label="关闭"
          >
            <X size={18} />
          </button>

          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-primary to-pink-500 text-white flex items-center justify-center shadow-md shadow-primary/25">
              <Sparkles size={20} className="animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-text-primary">
                  Siri / 语音助手反馈
                </h3>
                {log.isAsync && (
                  <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                    后台处理完成
                  </span>
                )}
              </div>
              <p className="text-xs text-text-secondary mt-0.5 flex items-center gap-1.5">
                <Clock size={12} />
                <span>{babyName}的专属助理 · {timeStr || "刚才"}</span>
              </p>
            </div>
          </div>
        </div>

        {/* Modal content body */}
        <div className="p-6 space-y-4">
          {/* User's spoken prompt */}
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-text-muted flex items-center gap-1">
              <MessageSquare size={13} className="text-primary" />
              你的语音指令
            </span>
            <div className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200/70 dark:border-zinc-700/60 text-sm font-medium text-text-primary">
              “{log.prompt}”
            </div>
          </div>

          {/* Agent's response */}
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-text-muted flex items-center gap-1">
              <Sparkles size={13} className="text-pink-500" />
              处理结果与回复
            </span>
            <div className="p-4 rounded-2xl bg-gradient-to-br from-primary-soft/40 to-pink-50/50 dark:from-primary/10 dark:to-pink-950/20 border border-primary/25 text-sm leading-relaxed text-text-primary whitespace-pre-line shadow-xs">
              {log.reply}
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-6 pb-6 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-primary to-pink-500 hover:from-primary-dark hover:to-pink-600 text-white font-bold text-sm shadow-button flex items-center justify-center gap-2 active:scale-[0.98] transition-all cursor-pointer"
          >
            <Check size={18} />
            <span>知道了</span>
          </button>
        </div>
      </div>
    </div>
  );
}
