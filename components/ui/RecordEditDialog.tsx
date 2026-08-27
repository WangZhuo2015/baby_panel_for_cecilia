"use client";

import React, { useEffect, useState } from "react";
import type { TimelineEntry } from "@/types";
import { getLocalDateStr } from "@/lib/date";

interface RecordEditDialogProps {
  item: TimelineEntry | null;
  onClose: () => void;
  onSubmit: (patch: Record<string, unknown>) => Promise<void>;
}

const FEEDING_TYPES: [string, string][] = [
  ["breast", "母乳亲喂"], ["formula", "配方奶"], ["bottle_breast", "瓶喂母乳"],
  ["mixed", "混合喂养"], ["solid", "辅食"],
];
const DIAPER_TYPES: [string, string][] = [["pee", "尿尿"], ["poop", "便便"], ["both", "都有"]];
const PORTIONS: [string, string][] = [["little", "少量"], ["half", "一半"], ["most", "大部分"], ["all", "全部"]];
const STATES: [string, string][] = [["happy", "开心"], ["neutral", "一般"], ["rejected", "拒绝"]];

function isoToLocalHHMM(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  return `${p.find((x) => x.type === "hour")?.value ?? "00"}:${p.find((x) => x.type === "minute")?.value ?? "00"}`;
}

/**
 * 时间轴记录编辑对话框：按类型渲染可修正字段，PUT 提交部分补丁。
 */
export const RecordEditDialog: React.FC<RecordEditDialogProps> = ({ item, onClose, onSubmit }) => {
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!item) return;
    if (item.type === "feeding") {
      setForm({ time: isoToLocalHHMM((item as any).timestamp), type: (item as any).type ?? "", amountMl: String((item as any).amountMl ?? ""), notes: (item as any).notes ?? "" });
    } else if (item.type === "sleep") {
      setForm({ startTime: isoToLocalHHMM((item as any).startTime), endTime: isoToLocalHHMM((item as any).endTime), nightWakingCount: String((item as any).nightWakingCount ?? 0), notes: (item as any).notes ?? "" });
    } else if (item.type === "diaper") {
      setForm({ time: isoToLocalHHMM((item as any).timestamp), type: (item as any).type ?? "", notes: (item as any).notes ?? "" });
    } else if (item.type === "food") {
      setForm({ time: (item as any).time ?? "", portion: (item as any).portion ?? "most", acceptance: String((item as any).acceptance ?? 3), babyState: (item as any).babyState ?? "happy" });
    }
    setError(null);
  }, [item]);

  if (!item) return null;

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const inputCls =
    "w-full rounded-[14px] border border-primary-soft bg-white px-3 py-2 text-[16px] text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30";
  const labelCls = "block text-xs text-text-secondary mb-1";

  const buildPatch = (): Record<string, unknown> => {
    const toIso = (hhmm: string, originalIso?: string): string => {
      const dateStr = originalIso
        ? getLocalDateStr(new Date(originalIso))
        : new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date());
      return new Date(`${dateStr}T${hhmm}:00+08:00`).toISOString();
    };
    const toSleepIso = (hhmm: string, originalIso: string): string => {
      const dateStr = getLocalDateStr(new Date(originalIso));
      return new Date(`${dateStr}T${hhmm}:00+08:00`).toISOString();
    };

    if (item.type === "feeding") {
      const orig = (item as any).timestamp as string | undefined;
      return { id: item.id, timestamp: toIso(form.time, orig), type: form.type,
        amountMl: form.amountMl === "" ? null : Number(form.amountMl), notes: form.notes };
    }
    if (item.type === "sleep") {
      const origStart = (item as any).startTime as string;
      const origEnd = (item as any).endTime as string;
      let startIso = toSleepIso(form.startTime, origStart);
      let endIso = toSleepIso(form.endTime, origStart);
      if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
        endIso = new Date(new Date(endIso).getTime() + 24*60*60*1000).toISOString();
      }
      return { id: item.id, startTime: startIso, endTime: endIso,
        nightWakingCount: Number(form.nightWakingCount || 0), notes: form.notes };
    }
    if (item.type === "diaper") {
      const orig = (item as any).timestamp as string | undefined;
      return { id: item.id, timestamp: toIso(form.time, orig), type: form.type, notes: form.notes };
    }
    return { id: item.id, time: form.time, portion: form.portion,
      acceptance: Number(form.acceptance), babyState: form.babyState };
  };

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSubmit(buildPatch());
      onClose();
    } catch (e: any) {
      setError(e?.message || "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full sm:max-w-sm bg-card rounded-t-[24px] sm:rounded-[24px] p-5 pb-[max(20px,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="编辑记录"
      >
        <h3 className="text-base font-bold text-text-primary mb-4">修改这条{item.title}</h3>
        <div className="space-y-3">
          {item.type === "feeding" && (
            <>
              <div><label className={labelCls}>时间</label>
                <input type="time" className={inputCls} value={form.time} onChange={set("time")} /></div>
              <div><label className={labelCls}>方式</label>
                <select className={inputCls} value={form.type} onChange={set("type")}>
                  {FEEDING_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select></div>
              <div><label className={labelCls}>奶量 (ml)</label>
                <input type="number" min={0} max={3000} className={inputCls} value={form.amountMl} onChange={set("amountMl")} /></div>
              <div><label className={labelCls}>备注</label>
                <textarea className={inputCls} rows={2} value={form.notes} onChange={set("notes")} /></div>
            </>
          )}
          {item.type === "sleep" && (
            <>
              <div><label className={labelCls}>入睡 (HH:MM，跨夜自动+1天)</label>
                <input type="time" className={inputCls} value={form.startTime} onChange={set("startTime")} /></div>
              <div><label className={labelCls}>醒来</label>
                <input type="time" className={inputCls} value={form.endTime} onChange={set("endTime")} /></div>
              <div><label className={labelCls}>夜醒次数</label>
                <input type="number" min={0} max={50} className={inputCls} value={form.nightWakingCount} onChange={set("nightWakingCount")} /></div>
              <div><label className={labelCls}>备注</label>
                <textarea className={inputCls} rows={2} value={form.notes} onChange={set("notes")} /></div>
            </>
          )}
          {item.type === "diaper" && (
            <>
              <div><label className={labelCls}>时间</label>
                <input type="time" className={inputCls} value={form.time} onChange={set("time")} /></div>
              <div><label className={labelCls}>类型</label>
                <select className={inputCls} value={form.type} onChange={set("type")}>
                  {DIAPER_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select></div>
              <div><label className={labelCls}>备注</label>
                <textarea className={inputCls} rows={2} value={form.notes} onChange={set("notes")} /></div>
            </>
          )}
          {item.type === "food" && (
            <>
              <div><label className={labelCls}>时间</label>
                <input type="time" className={inputCls} value={form.time} onChange={set("time")} /></div>
              <div><label className={labelCls}>进食量</label>
                <select className={inputCls} value={form.portion} onChange={set("portion")}>
                  {PORTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select></div>
              <div><label className={labelCls}>接受度 (1-5)</label>
                <input type="number" min={1} max={5} className={inputCls} value={form.acceptance} onChange={set("acceptance")} /></div>
              <div><label className={labelCls}>宝宝状态</label>
                <select className={inputCls} value={form.babyState} onChange={set("babyState")}>
                  {STATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select></div>
            </>
          )}
        </div>

        {error && <p className="mt-3 text-xs text-red-500">{error}</p>}

        <div className="flex gap-3 mt-5">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-full border border-primary-soft text-text-secondary text-sm"
          >
            取消
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSubmit}
            className="flex-1 py-2.5 rounded-full bg-primary text-white text-sm font-medium disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存修改"}
          </button>
        </div>
      </div>
    </div>
  );
};
