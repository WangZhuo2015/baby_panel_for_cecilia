"use client";

import React, { useState, useEffect, useCallback } from "react";
import { X, Droplets, Moon, Wind, UtensilsCrossed, TrendingUp } from "lucide-react";
import { useBabyStore } from "@/stores/useBabyStore";
import { calculateAge } from "@/lib/age";
import { useToast } from "@/components/ui/Toast";
import type { RecordDrawerType, RecordDrawerOpenDetail } from "@/lib/drawer-bus";
import { FeedingForm } from "@/components/records/FeedingForm";
import { SleepForm } from "@/components/records/SleepForm";
import { DiaperForm } from "@/components/records/DiaperForm";
import { FoodLogForm } from "@/components/records/FoodLogForm";
import { GrowthForm } from "@/components/records/GrowthForm";

const TYPE_META: Record<
  RecordDrawerType,
  { title: string; emoji: string; icon: React.ComponentType<{ size: number; className?: string }> }
> = {
  feeding: { title: "记录喂奶与饮水", emoji: "🍼", icon: Droplets },
  sleep: { title: "记录睡眠与作息", emoji: "🌙", icon: Moon },
  diaper: { title: "换尿布与排便记录", emoji: "💩", icon: Wind },
  food: { title: "记录辅食餐点", emoji: "🥣", icon: UtensilsCrossed },
  growth: { title: "添加生长发育测量", emoji: "📈", icon: TrendingUp },
};

export const RecordDrawerHost: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [drawerType, setDrawerType] = useState<RecordDrawerType>("feeding");
  const [customTitle, setCustomTitle] = useState<string | undefined>(undefined);
  const [initialData, setInitialData] = useState<any>(undefined);
  const [saving, setSaving] = useState(false);

  const baby = useBabyStore((s) => s.baby);
  const age = baby ? calculateAge(baby.birthDate) : { label: "0月0天" };
  const { showToast } = useToast();

  const addFeedingRecord = useBabyStore((s) => s.addFeedingRecord);
  const addSleepRecord = useBabyStore((s) => s.addSleepRecord);
  const addDiaperRecord = useBabyStore((s) => s.addDiaperRecord);
  const addFoodLogRecord = useBabyStore((s) => s.addFoodLogRecord);
  const addGrowthMeasurement = useBabyStore((s) => s.addGrowthMeasurement);
  const refreshAll = useBabyStore((s) => s.refreshAll);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setInitialData(undefined);
    setCustomTitle(undefined);
    setSaving(false);
  }, []);

  useEffect(() => {
    const handleOpen = (e: Event) => {
      const detail = (e as CustomEvent<RecordDrawerOpenDetail>).detail;
      if (detail && detail.type) {
        setDrawerType(detail.type);
        setCustomTitle(detail.title);
        setInitialData(detail.initialData);
        setIsOpen(true);
      }
    };

    const handleCloseEvent = () => {
      handleClose();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        handleClose();
      }
    };

    window.addEventListener("record-drawer:open", handleOpen);
    window.addEventListener("record-drawer:close", handleCloseEvent);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("record-drawer:open", handleOpen);
      window.removeEventListener("record-drawer:close", handleCloseEvent);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, handleClose]);

  const handleSubmitFeeding = async (data: any) => {
    setSaving(true);
    try {
      await addFeedingRecord(data);
      await refreshAll();
      showToast("喂养记录已保存 ✨");
      handleClose();
    } catch (err: any) {
      showToast(err?.message || "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitSleep = async (data: any) => {
    setSaving(true);
    try {
      await addSleepRecord(data);
      await refreshAll();
      showToast("睡眠记录已保存 🌙");
      handleClose();
    } catch (err: any) {
      showToast(err?.message || "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitDiaper = async (data: any) => {
    setSaving(true);
    try {
      await addDiaperRecord(data);
      await refreshAll();
      showToast("尿布记录已保存 ✨");
      handleClose();
    } catch (err: any) {
      showToast(err?.message || "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitFood = async (data: any) => {
    setSaving(true);
    try {
      await addFoodLogRecord(data);
      await refreshAll();
      showToast("辅食记录已保存 🥣");
      handleClose();
    } catch (err: any) {
      showToast(err?.message || "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitGrowth = async (data: any) => {
    if (!baby?.birthDate) {
      showToast("请先设置宝宝生日");
      return;
    }
    setSaving(true);
    try {
      const { months, label } = calculateAge(baby.birthDate, data.date);
      await addGrowthMeasurement({
        ...data,
        ageInMonths: months,
        ageLabel: label,
      });
      await refreshAll();
      showToast("生长记录已保存 📈");
      handleClose();
    } catch (err: any) {
      showToast(err?.message || "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const meta = TYPE_META[drawerType] || TYPE_META.feeding;
  const displayTitle = customTitle || meta.title;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="record-drawer-title"
      className="fixed inset-0 z-[90] flex justify-end animate-fade-in"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity duration-200"
        onClick={handleClose}
      />

      {/* Slide-over Drawer Panel */}
      <div className="relative w-full sm:w-[480px] max-w-full h-full bg-card shadow-2xl flex flex-col border-l border-primary/15 animate-slide-in-right z-10">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 pt-[max(16px,env(safe-area-inset-top))] bg-white/95 dark:bg-card/95 backdrop-blur-md border-b border-primary/10 shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-primary to-pink-500 text-white flex items-center justify-center text-xl shadow-sm shadow-primary/25 shrink-0 animate-float">
              {meta.emoji}
            </div>
            <div className="min-w-0 flex-1">
              <h3 id="record-drawer-title" className="font-bold text-text-primary text-base truncate">
                {displayTitle}
              </h3>
              <p className="text-xs text-text-muted flex items-center gap-1.5 mt-0.5">
                <span className="font-medium text-text-secondary">{baby?.nickname || "宝宝"}</span>
                <span>·</span>
                <span>{age.label}</span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleClose}
            aria-label="关闭抽屉"
            className="w-10 h-10 rounded-full bg-primary-soft/40 hover:bg-primary-soft text-text-muted hover:text-text-primary flex items-center justify-center transition-colors cursor-pointer tap-hotzone btn-press"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form Body - Scrollable */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 pb-[max(24px,env(safe-area-inset-bottom))]">
          {drawerType === "feeding" && (
            <FeedingForm
              initialData={initialData}
              onSubmit={handleSubmitFeeding}
              onCancel={handleClose}
              saving={saving}
            />
          )}

          {drawerType === "sleep" && (
            <SleepForm
              initialData={initialData}
              onSubmit={handleSubmitSleep}
              onCancel={handleClose}
              saving={saving}
            />
          )}

          {drawerType === "diaper" && (
            <DiaperForm
              initialData={initialData}
              onSubmit={handleSubmitDiaper}
              onCancel={handleClose}
              saving={saving}
            />
          )}

          {drawerType === "food" && (
            <FoodLogForm
              initialData={initialData}
              onSubmit={handleSubmitFood}
              onCancel={handleClose}
              saving={saving}
            />
          )}

          {drawerType === "growth" && (
            <GrowthForm
              initialData={initialData}
              onSubmit={handleSubmitGrowth}
              onCancel={handleClose}
              saving={saving}
            />
          )}
        </div>
      </div>
    </div>
  );
};
