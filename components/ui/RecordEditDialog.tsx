"use client";

import React, { useEffect, useState } from "react";
import type { TimelineEntry } from "@/types";
import { X, Baby, Moon, Droplets, UtensilsCrossed, Pill } from "lucide-react";
import { AgentBadge } from "@/components/ui/AgentBadge";
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

const DETAIL_ENDPOINTS: Partial<Record<TimelineEntry["type"], string>> = {
  feeding: "/api/records/feeding",
  sleep: "/api/records/sleep",
  diaper: "/api/records/diaper",
  food: "/api/food/logs",
};

function hasObservedVersion(record: unknown): boolean {
  if (!record || typeof record !== "object") return false;
  const version = (record as Record<string, unknown>).version ?? (record as Record<string, unknown>).baseVersion;
  return (typeof version === "string" && /^[1-9]\d*$/.test(version))
    || (typeof version === "number" && Number.isSafeInteger(version) && version > 0);
}

function hasEditableFields(type: TimelineEntry["type"], record: unknown): record is Record<string, unknown> {
  if (!record || typeof record !== "object") return false;
  const value = record as Record<string, unknown>;
  if (type === "feeding") return typeof value.timestamp === "string" && value.timestamp.length > 0;
  if (type === "sleep") {
    const startedAt = value.startedAt ?? value.startTime;
    const sleepType = value.sleepType ?? value.type;
    return typeof startedAt === "string" && startedAt.length > 0 && ["nap", "night", "day"].includes(String(sleepType));
  }
  if (type === "diaper") return typeof value.timestamp === "string" && value.timestamp.length > 0 && ["pee", "poop", "both"].includes(String(value.type));
  if (type === "food") {
    return typeof value.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.date)
      && typeof value.time === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.time)
      && Array.isArray(value.foods);
  }
  return false;
}

function hasCompleteEditableRecord(type: TimelineEntry["type"], record: unknown): record is Record<string, unknown> {
  return hasObservedVersion(record) && hasEditableFields(type, record);
}


const typeMeta: Record<
  TimelineEntry["type"],
  { title: string; icon: React.FC<{ size?: number; className?: string }>; color: string }
> = {
  feeding: { title: "修改喂养记录", icon: Baby, color: "text-peach bg-peach/15" },
  sleep: { title: "修改睡眠记录", icon: Moon, color: "text-lavender bg-lavender/15" },
  diaper: { title: "修改尿布记录", icon: Droplets, color: "text-sky bg-sky/15" },
  food: { title: "修改辅食记录", icon: UtensilsCrossed, color: "text-mint bg-mint/15" },
  supplement: { title: "补剂打卡详情", icon: Pill, color: "text-emerald-700 bg-emerald-100" },
};

/**
 * 时间轴记录编辑抽屉：直接复用各业务核心表单组件，保证数据完整性与交互一致性。
 */
export const RecordEditDialog: React.FC<RecordEditDialogProps> = ({ item, onClose, onSubmit }) => {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [loaded, setLoaded] = useState<{ key: string; record: Record<string, unknown> } | null>(null);
  const [loadError, setLoadError] = useState<{ key: string; message: string } | null>(null);
  const itemKey = item ? `${item.type}:${item.babyId}:${item.id}:${item.version ?? ""}` : "";
  const rawRecord = item?.rawRecord ?? (loaded?.key === itemKey ? loaded.record : null);

  useEffect(() => {
    setError(null);
    if (!item) {
      setLoaded(null);
      setLoadError(null);
      return;
    }
    const endpoint = DETAIL_ENDPOINTS[item.type];
    if (!endpoint || (item.rawRecord && hasEditableFields(item.type, item.rawRecord))) {
      setLoaded(null);
      setLoadError(null);
      return;
    }
    if (!item.babyId) {
      setLoaded(null);
      setLoadError({ key: itemKey, message: "缺少宝宝归属，无法加载记录详情" });
      return;
    }
    const controller = new AbortController();
    setLoaded(null);
    setLoadError(null);
    const query = new URLSearchParams({ babyId: item.babyId, id: item.id });
    fetch(`${endpoint}?${query.toString()}`, { signal: controller.signal })
      .then(async response => {
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const message = body && typeof body === "object" && typeof (body as Record<string, unknown>).error === "string"
            ? (body as Record<string, unknown>).error as string
            : "无法加载记录详情";
          throw new Error(message);
        }
        if (!body || typeof body !== "object" || (body as Record<string, unknown>).id !== item.id
          || (body as Record<string, unknown>).babyId !== item.babyId
          || !hasCompleteEditableRecord(item.type, body)) {
          throw new Error("记录详情不完整，请关闭后重试");
        }
        if (!controller.signal.aborted) setLoaded({ key: itemKey, record: body as Record<string, unknown> });
      })
      .catch(cause => {
        if (!controller.signal.aborted) {
          setLoadError({ key: itemKey, message: cause instanceof Error ? cause.message : "无法加载记录详情" });
        }
      });
    return () => controller.abort();
  }, [item, itemKey]);

  if (!item) return null;

  const meta = typeMeta[item.type] || typeMeta.feeding;
  const Icon = meta.icon;

  const handlePatchSubmit = async (patch: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    try {
      if (!rawRecord || !hasEditableFields(item.type, rawRecord)) {
        throw new Error("完整记录尚未加载，暂时无法保存");
      }
      const baseVersion = rawRecord.version ?? rawRecord.baseVersion;
      await onSubmit({ ...patch, id: item.id, ...(hasObservedVersion(rawRecord) ? { baseVersion } : {}) });
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
        className="w-full sm:max-w-md bg-white dark:bg-[#1E171E] text-text-primary dark:text-gray-100 rounded-t-[28px] sm:rounded-[28px] max-h-[90dvh] flex flex-col shadow-2xl border border-primary/20 animate-slide-up"
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
              <p className="text-[11px] text-text-muted flex items-center gap-1.5 flex-wrap">
                <span>{item.time} · {item.title}</span>
                {item.sourceAgent && <AgentBadge name={item.sourceAgent} size="xs" />}
                {item.recorderName && <span>· {item.recorderName}</span>}
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

          {!rawRecord && (
            <p role="status" className="py-4 text-sm text-text-muted">
              {loadError?.key === itemKey ? loadError.message : item.type === "feeding" ? "正在加载完整记录…" : "暂时无法加载完整记录，请从对应记录页面操作。"}
            </p>
          )}

          {rawRecord && item.type === "feeding" && (
            <FeedingForm
              mode="edit"
              initialData={rawRecord}
              onSubmit={handlePatchSubmit}
              onCancel={onClose}
              saving={saving}
            />
          )}

          {rawRecord && item.type === "sleep" && (
            <SleepForm
              mode="edit"
              initialData={rawRecord}
              onSubmit={handlePatchSubmit}
              onCancel={onClose}
              saving={saving}
            />
          )}

          {rawRecord && item.type === "diaper" && (
            <DiaperForm
              mode="edit"
              initialData={rawRecord}
              onSubmit={handlePatchSubmit}
              onCancel={onClose}
              saving={saving}
            />
          )}

          {rawRecord && item.type === "food" && (
            <FoodLogForm
              mode="edit"
              initialData={rawRecord}
              onSubmit={handlePatchSubmit}
              onCancel={onClose}
              saving={saving}
            />
          )}

          {rawRecord && item.type === "supplement" && (
            <div className="space-y-4 py-2">
              <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-100 text-emerald-950 space-y-2">
                <div className="flex items-center justify-between font-bold text-sm">
                  <span>{rawRecord.productName || item.title}</span>
                  <span className="text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full text-xs">
                    {rawRecord.dose || 1.0} {rawRecord.unitName || "剂"}
                  </span>
                </div>
                <div className="text-xs text-emerald-800/80">
                  <p>打卡日期：{rawRecord.date || item.time}</p>
                  <p>打卡时间：{rawRecord.time || item.time}</p>
                  {rawRecord.notes && <p>备注信息：{item.rawRecord.notes}</p>}
                </div>
              </div>
              <p className="text-xs text-text-muted text-center">
                若需调整剂量或重复打卡，可在操作面板中删除本条后重新打卡。
              </p>
              <button
                type="button"
                onClick={onClose}
                className="w-full py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm btn-press shadow-xs"
              >
                我知道了
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
