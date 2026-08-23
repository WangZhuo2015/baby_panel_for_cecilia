"use client";

import React, { useState } from "react";
import {
  CheckCircle2,
  FileText,
  Utensils,
  Moon,
  Droplets,
  TrendingUp,
  Hospital,
  Calendar,
  AlertTriangle,
  Sparkles,
  Loader2,
  ArrowRight,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useBabyStore } from "@/stores/useBabyStore";

export interface ActionCardData {
  type: "medical_report" | "feeding" | "sleep" | "diaper" | "growth";
  data: any;
}

interface AiActionCardProps {
  action: ActionCardData;
  onSaved?: () => void;
}

const CATEGORY_MAP: Record<string, { label: string; emoji: string }> = {
  blood: { label: "血常规", emoji: "🩸" },
  growth: { label: "体检记录", emoji: "📏" },
  trace_element: { label: "微量元素", emoji: "🧪" },
  allergy: { label: "过敏原", emoji: "🌾" },
  general: { label: "综合单据", emoji: "📑" },
};

export const AiActionCard: React.FC<AiActionCardProps> = ({ action, onSaved }) => {
  const { showToast } = useToast();
  const fetchBaby = useBabyStore((s) => s.fetchBaby);
  const fetchGrowthMeasurements = useBabyStore((s) => s.fetchGrowthMeasurements);
  const fetchDailySummary = useBabyStore((s) => s.fetchDailySummary);
  const fetchTimeline = useBabyStore((s) => s.fetchTimeline);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleConfirmSave = async () => {
    if (saved || saving) return;
    setSaving(true);

    try {
      if (action.type === "medical_report") {
        const res = await fetch("/api/medical/reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action.data),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "保存化验单失败");
        }
        showToast("化验单已成功存入宝宝健康档案 ✨");
        fetchGrowthMeasurements();
      } else if (action.type === "feeding") {
        const res = await fetch("/api/records/feeding", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action.data),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "保存喂养记录失败");
        }
        showToast("喂养记录已存入 ✨");
        fetchDailySummary();
        fetchTimeline();
      } else if (action.type === "sleep") {
        const res = await fetch("/api/records/sleep", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action.data),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "保存睡眠记录失败");
        }
        showToast("睡眠记录已存入 ✨");
        fetchDailySummary();
        fetchTimeline();
      } else if (action.type === "diaper") {
        const res = await fetch("/api/records/diaper", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action.data),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "保存排便记录失败");
        }
        showToast("排便记录已存入 ✨");
        fetchDailySummary();
        fetchTimeline();
      } else if (action.type === "growth") {
        const res = await fetch("/api/growth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action.data),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "保存生长数据失败");
        }
        showToast("生长发育记录已存入 ✨");
        fetchGrowthMeasurements();
        fetchBaby();
      }

      setSaved(true);
      if (onSaved) onSaved();
    } catch (err: any) {
      showToast(err?.message || "保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  };

  // Render Medical Report Action Card
  if (action.type === "medical_report") {
    const { title, category, date, hospital, items, growthData, aiSummary } = action.data;
    const catInfo = CATEGORY_MAP[category] || CATEGORY_MAP.general;
    const abnormalItems = Array.isArray(items)
      ? items.filter((i: any) => i.status && i.status !== "normal")
      : [];

    return (
      <div className="my-3 p-3.5 bg-gradient-to-br from-amber-50/70 via-white to-pink-50/40 rounded-2xl border border-amber-200/70 shadow-sm text-text-primary text-xs space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-bold text-amber-900 text-xs sm:text-sm">
            <span className="text-base">{catInfo.emoji}</span>
            <span className="truncate max-w-[200px]">{title || "医学化验单据"}</span>
          </div>
          <span className="px-2 py-0.5 rounded-full bg-amber-100/80 text-amber-800 text-[10px] font-semibold">
            {catInfo.label}
          </span>
        </div>

        {/* Basic metadata */}
        <div className="grid grid-cols-2 gap-2 text-[11px] text-text-secondary bg-white/70 p-2 rounded-xl border border-amber-100/60">
          {hospital && (
            <div className="flex items-center gap-1 truncate">
              <Hospital size={12} className="text-amber-600 shrink-0" />
              <span className="truncate">{hospital}</span>
            </div>
          )}
          {date && (
            <div className="flex items-center gap-1">
              <Calendar size={12} className="text-amber-600 shrink-0" />
              <span>{date}</span>
            </div>
          )}
        </div>

        {/* Growth data if included */}
        {growthData && (growthData.weightKg || growthData.heightCm || growthData.headCircumferenceCm) && (
          <div className="flex items-center gap-2 p-2 bg-emerald-50/60 rounded-xl border border-emerald-100 text-[11px] text-emerald-800 font-medium">
            <span>📏 体格测量：</span>
            {growthData.weightKg && <span>体重 {growthData.weightKg}kg</span>}
            {growthData.heightCm && <span>身长 {growthData.heightCm}cm</span>}
            {growthData.headCircumferenceCm && <span>头围 {growthData.headCircumferenceCm}cm</span>}
          </div>
        )}

        {/* Extracted items summary */}
        {Array.isArray(items) && items.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] text-text-muted px-1">
              <span>已结构化识别 {items.length} 个检验指标</span>
              {abnormalItems.length > 0 ? (
                <span className="text-red-500 font-semibold flex items-center gap-0.5">
                  <AlertTriangle size={11} />
                  {abnormalItems.length} 项指标偏离标准
                </span>
              ) : (
                <span className="text-emerald-600 font-medium flex items-center gap-0.5">
                  <CheckCircle2 size={11} />
                  指标均在参考范围内
                </span>
              )}
            </div>

            {/* Quick preview of abnormal or key items */}
            <div className="max-h-36 overflow-y-auto space-y-1 p-2 bg-white rounded-xl border border-primary/10 text-[11px]">
              {items.slice(0, 8).map((it: any, idx: number) => {
                const isAbnormal = it.status && it.status !== "normal";
                return (
                  <div key={idx} className="flex items-center justify-between py-0.5 border-b border-slate-50 last:border-0">
                    <span className="truncate max-w-[150px]">{it.name}</span>
                    <div className="flex items-center gap-1.5">
                      <span className={`font-mono font-semibold ${isAbnormal ? "text-red-600 font-bold" : "text-text-primary"}`}>
                        {it.value} {it.unit || ""}
                      </span>
                      {it.referenceRange && (
                        <span className="text-[9px] text-text-muted">({it.referenceRange})</span>
                      )}
                    </div>
                  </div>
                );
              })}
              {items.length > 8 && (
                <p className="text-[10px] text-center text-text-muted pt-1">
                  ... 及其余 {items.length - 8} 项指标
                </p>
              )}
            </div>
          </div>
        )}

        {/* Action Commit Button */}
        <button
          onClick={handleConfirmSave}
          disabled={saved || saving}
          className={`w-full py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-xs cursor-pointer ${
            saved
              ? "bg-emerald-500 text-white cursor-default"
              : "bg-gradient-to-r from-amber-500 to-pink-500 text-white hover:opacity-95 active:scale-98"
          }`}
        >
          {saving ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              <span>正在存入宝宝档案...</span>
            </>
          ) : saved ? (
            <>
              <CheckCircle2 size={14} />
              <span>已成功存入健康档案 ✨</span>
            </>
          ) : (
            <>
              <Sparkles size={14} />
              <span>一键确认存入宝宝健康档案</span>
            </>
          )}
        </button>
      </div>
    );
  }

  // Render Feeding Action Card
  if (action.type === "feeding") {
    const { type, amountMl, durationMinutes, notes, timestamp } = action.data;
    const typeLabel =
      type === "breast" ? "母乳亲喂" : type === "formula" ? "配方奶粉" : type === "bottle_breast" ? "瓶喂母乳" : "混合喂养";

    return (
      <div className="my-2.5 p-3 bg-gradient-to-br from-sky-50/80 to-blue-50/40 rounded-2xl border border-sky-200/70 shadow-xs text-xs space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-bold text-sky-900 flex items-center gap-1.5">
            <span>🍼</span> 喂养记录确认
          </span>
          <span className="text-[10px] text-sky-700 bg-sky-100 px-2 py-0.5 rounded-full font-semibold">
            {typeLabel}
          </span>
        </div>
        <div className="flex items-center justify-between bg-white/80 p-2 rounded-xl text-text-secondary text-[11px]">
          {amountMl && <span>奶量：<strong className="text-sky-700 font-bold">{amountMl} ml</strong></span>}
          {durationMinutes && <span>时长：<strong className="text-sky-700 font-bold">{durationMinutes} 分钟</strong></span>}
          {timestamp && <span>时间：{new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
        </div>
        {notes && <p className="text-[10px] text-text-muted px-1">备注：{notes}</p>}

        <button
          onClick={handleConfirmSave}
          disabled={saved || saving}
          className={`w-full py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1 transition-all cursor-pointer ${
            saved
              ? "bg-emerald-500 text-white"
              : "bg-sky-500 text-white hover:bg-sky-600 shadow-xs"
          }`}
        >
          {saved ? <CheckCircle2 size={13} /> : <Sparkles size={13} />}
          <span>{saved ? "已存入喂养记录 ✨" : "确认保存喂养记录"}</span>
        </button>
      </div>
    );
  }

  // Render Sleep Action Card
  if (action.type === "sleep") {
    const { startTime, endTime, type, notes } = action.data;
    return (
      <div className="my-2.5 p-3 bg-gradient-to-br from-indigo-50/80 to-purple-50/40 rounded-2xl border border-indigo-200/70 shadow-xs text-xs space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-bold text-indigo-900 flex items-center gap-1.5">
            <span>😴</span> 睡眠记录确认
          </span>
          <span className="text-[10px] text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full font-semibold">
            {type === "night" ? "夜间睡眠" : "白天小睡"}
          </span>
        </div>
        <div className="bg-white/80 p-2 rounded-xl text-text-secondary text-[11px] flex items-center justify-between">
          <span>入睡：{startTime}</span>
          <ArrowRight size={12} className="text-indigo-400" />
          <span>醒来：{endTime}</span>
        </div>
        {notes && <p className="text-[10px] text-text-muted px-1">备注：{notes}</p>}

        <button
          onClick={handleConfirmSave}
          disabled={saved || saving}
          className={`w-full py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1 transition-all cursor-pointer ${
            saved
              ? "bg-emerald-500 text-white"
              : "bg-indigo-500 text-white hover:bg-indigo-600 shadow-xs"
          }`}
        >
          {saved ? <CheckCircle2 size={13} /> : <Sparkles size={13} />}
          <span>{saved ? "已存入睡眠记录 ✨" : "确认保存睡眠记录"}</span>
        </button>
      </div>
    );
  }

  // Render Diaper Action Card
  if (action.type === "diaper") {
    const { type, poopColor, poopConsistency, notes, timestamp } = action.data;
    const typeLabel = type === "pee" ? "💧 尿尿" : type === "poop" ? "💩 便便" : "💧💩 尿+便";
    return (
      <div className="my-2.5 p-3 bg-gradient-to-br from-amber-50/80 to-yellow-50/40 rounded-2xl border border-amber-200/70 shadow-xs text-xs space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-bold text-amber-900 flex items-center gap-1.5">
            <span>🍑</span> 排便记录确认
          </span>
          <span className="text-[10px] text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full font-semibold">
            {typeLabel}
          </span>
        </div>
        <div className="bg-white/80 p-2 rounded-xl text-text-secondary text-[11px] flex items-center justify-between">
          {poopColor && <span>颜色：{poopColor}</span>}
          {poopConsistency && <span>形态：{poopConsistency}</span>}
          {timestamp && <span>时间：{new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
        </div>
        {notes && <p className="text-[10px] text-text-muted px-1">备注：{notes}</p>}

        <button
          onClick={handleConfirmSave}
          disabled={saved || saving}
          className={`w-full py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1 transition-all cursor-pointer ${
            saved
              ? "bg-emerald-500 text-white"
              : "bg-amber-500 text-white hover:bg-amber-600 shadow-xs"
          }`}
        >
          {saved ? <CheckCircle2 size={13} /> : <Sparkles size={13} />}
          <span>{saved ? "已存入排便记录 ✨" : "确认保存排便记录"}</span>
        </button>
      </div>
    );
  }

  // Render Growth Action Card
  if (action.type === "growth") {
    const { weightKg, heightCm, headCircumferenceCm, date, notes } = action.data;
    return (
      <div className="my-2.5 p-3 bg-gradient-to-br from-emerald-50/80 to-teal-50/40 rounded-2xl border border-emerald-200/70 shadow-xs text-xs space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-bold text-emerald-900 flex items-center gap-1.5">
            <span>📈</span> 生长测量记录确认
          </span>
          {date && <span className="text-[10px] text-emerald-800 font-semibold">{date}</span>}
        </div>
        <div className="bg-white/80 p-2 rounded-xl text-emerald-800 text-[11px] grid grid-cols-3 gap-1 text-center font-medium">
          {weightKg && <div><p className="text-[10px] text-text-muted">体重</p><p className="font-bold">{weightKg} kg</p></div>}
          {heightCm && <div><p className="text-[10px] text-text-muted">身长</p><p className="font-bold">{heightCm} cm</p></div>}
          {headCircumferenceCm && <div><p className="text-[10px] text-text-muted">头围</p><p className="font-bold">{headCircumferenceCm} cm</p></div>}
        </div>
        {notes && <p className="text-[10px] text-text-muted px-1">备注：{notes}</p>}

        <button
          onClick={handleConfirmSave}
          disabled={saved || saving}
          className={`w-full py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1 transition-all cursor-pointer ${
            saved
              ? "bg-emerald-500 text-white"
              : "bg-emerald-600 text-white hover:bg-emerald-700 shadow-xs"
          }`}
        >
          {saved ? <CheckCircle2 size={13} /> : <Sparkles size={13} />}
          <span>{saved ? "已存入生长曲线 ✨" : "确认存入生长曲线"}</span>
        </button>
      </div>
    );
  }

  return null;
};
