"use client";

import React from "react";
import type { TimelineEntry } from "@/types";
import { Pencil, Trash2, X } from "lucide-react";
import { AgentBadge } from "@/components/ui/AgentBadge";

interface RecordActionSheetProps {
  item: TimelineEntry | null;
  onClose: () => void;
  onEdit: (item: TimelineEntry) => void;
  onDelete: (item: TimelineEntry) => void;
}

/**
 * 时间轴条目操作面板（移动端底部弹出手势替代 hover）
 */
export const RecordActionSheet: React.FC<RecordActionSheetProps> = ({
  item,
  onClose,
  onEdit,
  onDelete,
}) => {
  if (!item) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end bg-black/40 animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="记录操作"
    >
      <div
        className="w-full sm:max-w-sm sm:mx-auto sm:mb-6 bg-white dark:bg-[#1E171E] text-text-primary dark:text-gray-100 rounded-t-[24px] sm:rounded-[24px] p-4 pb-[max(16px,env(safe-area-inset-bottom))] shadow-2xl border border-primary/20"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-1 pb-2">
          <p className="text-xs text-text-secondary truncate flex items-center gap-1.5 flex-wrap">
            <span>{item.time} · {item.title}</span>
            {item.sourceAgent && <AgentBadge name={item.sourceAgent} size="xs" />}
            {item.recorderName ? <span>· {item.recorderName} 记录</span> : ""}
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="tap-hotzone p-1.5 rounded-full text-text-muted hover:bg-primary-soft/30"
          >
            <X size={16} />
          </button>
        </div>
        {item.detail ? (
          <p className="px-1 pb-2 text-xs text-text-secondary break-words">
            {item.detail}
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => onEdit(item)}
          className="w-full flex items-center gap-3 px-4 py-3.5 rounded-[16px] hover:bg-primary-soft/20 active:bg-primary-soft/40 text-text-primary"
        >
          <Pencil size={17} className="text-primary" />
          <span className="text-sm font-medium">修改这条记录</span>
        </button>

        <button
          type="button"
          onClick={() => onDelete(item)}
          className="w-full flex items-center gap-3 px-4 py-3.5 rounded-[16px] hover:bg-red-50 active:bg-red-100 text-red-500"
        >
          <Trash2 size={17} />
          <span className="text-sm font-medium">删除这条记录</span>
        </button>
      </div>
    </div>
  );
};
