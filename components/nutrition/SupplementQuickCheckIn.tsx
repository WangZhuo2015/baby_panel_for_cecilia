"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Check, AlertTriangle, Sparkles, RefreshCw, ShieldAlert, X } from "lucide-react";
import { CuteCard } from "@/components/ui/CuteCard";
import { CuteButton } from "@/components/ui/CuteButton";
import { getLocalDateStr } from "@/lib/date";
import type { SupplementSchedule, SupplementProduct, ConflictCheckResult } from "@/types/nutrition";

import { useBabyStore } from "@/stores/useBabyStore";

export interface SupplementQuickCheckInProps {
  babyId?: string;
  date?: string;
  refreshKey?: number;
  onRecordSuccess?: () => void;
  className?: string;
}

export function SupplementQuickCheckIn({ babyId, date, refreshKey, onRecordSuccess, className = "" }: SupplementQuickCheckInProps) {
  const [schedules, setSchedules] = useState<SupplementSchedule[]>([]);
  const [supplements, setSupplements] = useState<SupplementProduct[]>([]);
  const [completedProductIds, setCompletedProductIds] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const targetDate = date || getLocalDateStr();
  const isToday = targetDate === getLocalDateStr();

  // 冲突拦截弹窗状态
  const [conflictModal, setConflictModal] = useState<{
    isOpen: boolean;
    product: SupplementProduct | null;
    warnings: string[];
    details: ConflictCheckResult["details"];
  }>({
    isOpen: false,
    product: null,
    warnings: [],
    details: [],
  });

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [schedulesRes, productsRes] = await Promise.all([
        fetch(`/api/nutrition/schedules?date=${targetDate}${babyId ? `&babyId=${babyId}` : ""}`),
        fetch("/api/nutrition/products?type=supplement"),
      ]);

      if (schedulesRes.ok) {
        const data = await schedulesRes.json();
        setSchedules(data.schedules || []);
        setCompletedProductIds(data.completedProductIds || []);
      }
      if (productsRes.ok) {
        const data = await productsRes.json();
        setSupplements(data.supplements || []);
      }
    } catch (e) {
      console.error("Failed to fetch supplement data:", e);
    } finally {
      setLoading(false);
    }
  }, [babyId, targetDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshKey]);

  // 全局营养/计划变动与数据轮询自动刷新监听
  useEffect(() => {
    const handleUpdate = () => {
      fetchData();
    };
    window.addEventListener("baby:nutrition-updated", handleUpdate);
    window.addEventListener("baby:data-polled", handleUpdate);
    return () => {
      window.removeEventListener("baby:nutrition-updated", handleUpdate);
      window.removeEventListener("baby:data-polled", handleUpdate);
    };
  }, [fetchData]);

  const handleCheckIn = async (product: SupplementProduct, forceOverride = false) => {
    setSubmittingId(product.id);
    try {
      const res = await fetch("/api/nutrition/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          babyId,
          productId: product.id,
          dose: product.defaultDose || 1.0,
          unitName: product.unitName,
          date: targetDate,
          forceOverride,
        }),
      });

      if (res.status === 409) {
        // 触发冲突拦截！
        const conflictData = await res.json();
        setConflictModal({
          isOpen: true,
          product,
          warnings: conflictData.warnings || [],
          details: conflictData.details || [],
        });
        return;
      }

      if (res.ok) {
        setConflictModal({ isOpen: false, product: null, warnings: [], details: [] });
        await fetchData();
        if (onRecordSuccess) onRecordSuccess();
        window.dispatchEvent(new CustomEvent("baby:nutrition-updated"));
        // 刷新时间轴与每日概览，确保打卡流水立即呈现在时间轴上
        try {
          useBabyStore.getState().fetchTimeline(undefined, true);
          useBabyStore.getState().fetchDailySummary(undefined, true);
        } catch {}
      } else {
        const err = await res.json();
        alert(err.error || "打卡失败，请重试");
      }
    } catch (e) {
      console.error("Check in error:", e);
      alert("网络请求失败，请稍后重试");
    } finally {
      setSubmittingId(null);
    }
  };

  // 如果没有配置任何补剂计划，但有产品库中的补剂，展示快速补剂打卡列表
  const displayItems =
    schedules.length > 0
      ? schedules
      : supplements.slice(0, 3).map((p) => ({
          id: p.id,
          babyId: babyId || "",
          productId: p.id,
          product: p,
          frequency: "daily" as const,
          targetDose: p.defaultDose || 1.0,
          isActive: true,
          isCompletedToday: completedProductIds.includes(p.id),
        }));

  if (loading && displayItems.length === 0) {
    return (
      <CuteCard className={`p-3.5 bg-gradient-to-r from-emerald-50/60 to-teal-50/40 border border-emerald-100 ${className}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm">💊</span>
            <span className="text-xs font-bold text-emerald-950">
              {isToday ? "今日补剂打卡" : `${targetDate} 补剂打卡`}
            </span>
          </div>
          <RefreshCw size={12} className="animate-spin text-emerald-600" />
        </div>
      </CuteCard>
    );
  }

  return (
    <>
      <CuteCard className={`p-3.5 bg-gradient-to-br from-emerald-50/80 via-teal-50/40 to-sky-50/30 border border-emerald-100/90 shadow-2xs ${className}`}>
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-1.5">
            <span className="text-sm">💊</span>
            <h3 className="text-xs font-bold text-emerald-950">
              {isToday ? "今日补剂打卡" : `${targetDate} 补剂打卡`}
            </h3>
            <span className="text-[10px] text-emerald-700 bg-emerald-100/70 px-1.5 py-0.2 rounded-full font-bold">
              {isToday ? "安全守护中" : "指定日期录入"}
            </span>
          </div>
          <button
            type="button"
            onClick={fetchData}
            className="text-[11px] text-emerald-700 hover:text-emerald-900 flex items-center gap-0.5"
            title="刷新补剂计划"
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        {displayItems.length > 0 ? (
          <div className="grid grid-cols-1 gap-2">
            {displayItems.map((item) => {
              const product = item.product;
              if (!product) return null;
              const isCompleted = Boolean(item.isCompletedToday);
              const isSubmitting = submittingId === product.id;

              return (
                <div
                  key={item.id}
                  className={`flex items-center justify-between p-2.5 rounded-2xl border transition-all ${
                    isCompleted
                      ? "bg-white/90 border-emerald-200 text-emerald-900"
                      : "bg-white border-divider hover:border-emerald-300 shadow-2xs"
                  }`}
                >
                  <div className="space-y-0.5 min-w-0 flex-1 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-text-primary truncate">{product.name}</span>
                      {product.dosageForm && (
                        <span className="text-[10px] bg-gray-100 text-text-muted px-1.5 py-0.2 rounded">
                          {product.unitName || "剂"}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-text-muted truncate">
                      {product.brand ? `${product.brand} · ` : ""}
                      推荐剂量: {item.targetDose || product.defaultDose || 1.0} {product.unitName || "剂"}
                    </p>
                  </div>

                  <div>
                    {isCompleted ? (
                      <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold shadow-2xs">
                        <Check size={13} strokeWidth={3} />
                        {isToday ? "今日已服" : "当日已服"}
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => handleCheckIn(product, false)}
                        className="px-3.5 py-1.5 rounded-full bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white text-xs font-bold flex items-center gap-1 shadow-button transition-all disabled:opacity-50 cursor-pointer"
                      >
                        {isSubmitting ? (
                          <RefreshCw size={12} className="animate-spin" />
                        ) : (
                          <Plus size={13} strokeWidth={2.5} />
                        )}
                        {isToday ? "打卡" : "补录"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-3 bg-white/60 rounded-2xl border border-dashed border-emerald-200">
            <p className="text-xs text-text-muted">暂未添加补剂档案或计划</p>
            <p className="text-[10px] text-emerald-700 mt-0.5">
              前往「营养素分析」页面可一键添加伊可新AD、星鲨D3或液体乳钙
            </p>
          </div>
        )}
      </CuteCard>

      {/* ⚠️ 补剂冲突与过量拦截弹窗 */}
      {conflictModal.isOpen && conflictModal.product && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/65 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white dark:bg-[#1E171E] text-text-primary dark:text-gray-100 rounded-3xl p-4 sm:p-5 max-w-sm w-full max-h-[90dvh] flex flex-col shadow-2xl border border-amber-400 overflow-hidden">
            {/* Header */}
            <div className="flex items-start justify-between pb-3 border-b border-divider shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-2xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                  <ShieldAlert size={22} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text-primary dark:text-white">补剂冲突与过量警示</h3>
                  <p className="text-[11px] text-amber-700 dark:text-amber-400 font-semibold">Conflict Guard 拦截提醒</p>
                </div>
              </div>
              <button
                onClick={() => setConflictModal({ isOpen: false, product: null, warnings: [], details: [] })}
                className="p-1 rounded-full text-text-muted hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <X size={16} />
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="flex-1 min-h-0 overflow-y-auto space-y-3 py-2 pr-0.5 overscroll-contain">
              {/* 警告消息 */}
              <div className="p-3 bg-amber-50 dark:bg-amber-950/40 rounded-2xl border border-amber-200 dark:border-amber-900 text-xs text-amber-900 dark:text-amber-200 space-y-1.5">
                {conflictModal.warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-1.5 leading-relaxed">
                    <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>

              {/* 详细指标叠加 */}
              {conflictModal.details.length > 0 && (
                <div className="space-y-1.5 bg-gray-50 dark:bg-[#251D25] p-2.5 rounded-2xl border border-gray-200 dark:border-gray-800">
                  <span className="text-[10px] font-bold text-text-secondary uppercase block">
                    预计叠加摄入总量
                  </span>
                  {conflictModal.details.map((d) => (
                    <div key={d.nutrientId} className="flex items-center justify-between text-xs py-0.5">
                      <span className="text-text-secondary dark:text-gray-300">{d.nutrientName}</span>
                      <span className={d.isExceeded ? "text-red-600 font-bold" : "text-text-primary dark:text-white font-medium"}>
                        {d.projectedTotal} {d.unit}
                        {d.ul ? ` (上限 ${d.ul})` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 按钮 */}
            <div className="flex gap-2 pt-3 border-t border-divider shrink-0">
              <button
                type="button"
                onClick={() => setConflictModal({ isOpen: false, product: null, warnings: [], details: [] })}
                className="flex-1 py-2.5 rounded-full border border-gray-300 dark:border-gray-700 text-xs text-text-secondary dark:text-gray-300 font-bold hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                取消打卡
              </button>
              <CuteButton
                variant="primary"
                className="flex-1 text-xs shadow-button"
                onClick={() => {
                  if (conflictModal.product) {
                    handleCheckIn(conflictModal.product, true);
                  }
                }}
              >
                遵医嘱强制打卡
              </CuteButton>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
