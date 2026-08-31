"use client";

import React, { useState } from "react";
import type { TimelineEntry } from "@/types";
import { X, Baby, Moon, Droplets, UtensilsCrossed } from "lucide-react";
import { FeedingForm } from "@/components/records/FeedingForm";
import { DiaperForm } from "@/components/records/DiaperForm";
import { SleepForm } from "@/components/records/SleepForm";
import { FoodLogForm } from "@/components/records/FoodLogForm";
import { getLocalDateStr } from "@/lib/date";

// Ensure date is derived from record.timestamp/startTime via getLocalDateStr(originalIso)
export { getLocalDateStr };

interface RecordEditDialogProps {
  item: TimelineEntry | null;
  onClose: () => void;
  onSubmit: (patch: Record<string, unknown>) => Promise<void>;
}

const typeMeta: Record<
  TimelineEntry["type"],
  { title: string; icon: React.FC<{ size?: number; className?: string }>; color: string }
> = {
  feeding: { title: "修改喂养记录", icon: Baby, color: "text-peach bg-peach/15" },
  sleep: { title: "修改睡眠记录", icon: Moon, color: "text-lavender bg-lavender/15" },
  diaper: { title: "修改尿布记录", icon: Droplets, color: "text-sky bg-sky/15" },
  food: { title: "修改辅食记录", icon: UtensilsCrossed, color: "text-mint bg-mint/15" },
};

/**
 * 时间轴记录编辑抽屉：直接复用各业务核心表单组件，保证数据完整性与交互一致性。
 */
export const RecordEditDialog: React.FC<RecordEditDialogProps> = ({ item, onClose, onSubmit }) => {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!item) return null;

  const meta = typeMeta[item.type] || typeMeta.feeding;
  const Icon = meta.icon;

  const handlePatchSubmit = async (patch: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    try {
      await onSubmit({ id: item.id, ...patch });
      onClose();
    } catch (e: any) {
      setError(e?.message || "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-xs animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="编辑记录"
    >
      <div
        className="w-full sm:max-w-md bg-card rounded-t-[28px] sm:rounded-[28px] max-h-[90dvh] flex flex-col shadow-2xl animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-divider/60 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${meta.color}`}>
              <Icon size={16} />
            </div>
            <div>
              <h3 className="text-base font-bold text-text-primary">{meta.title}</h3>
              <p className="text-[11px] text-text-muted">
                {item.time} · {item.title}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="w-8 h-8 rounded-full flex items-center justify-center text-text-muted hover:bg-primary-soft/40 btn-press"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body (Scrollable) */}
        <div className="px-5 py-4 overflow-y-auto overscroll-contain flex-1 pb-[max(20px,env(safe-area-inset-bottom))]">
          {error && (
            <div className="mb-4 p-3 rounded-2xl bg-red-50 border border-red-200 text-xs text-red-600 font-medium">
              {error}
            </div>
          )}

          {item.type === "feeding" && (
            <FeedingForm
              mode="edit"
              initialData={item.rawRecord}
              onSubmit={handlePatchSubmit}
              onCancel={onClose}
              saving={saving}
            />
          )}

          {item.type === "sleep" && (
            <SleepForm
              mode="edit"
              initialData={item.rawRecord}
              onSubmit={handlePatchSubmit}
              onCancel={onClose}
              saving={saving}
            />
          )}

          {item.type === "diaper" && (
            <DiaperForm
              mode="edit"
              initialData={item.rawRecord}
              onSubmit={handlePatchSubmit}
              onCancel={onClose}
              saving={saving}
            />
          )}

          {item.type === "food" && (
            <FoodLogForm
              mode="edit"
              initialData={item.rawRecord}
              onSubmit={handlePatchSubmit}
              onCancel={onClose}
              saving={saving}
            />
          )}
        </div>
      </div>
    </div>
  );
};
