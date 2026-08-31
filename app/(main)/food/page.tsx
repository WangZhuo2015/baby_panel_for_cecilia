"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { CuteCard } from "@/components/ui/CuteCard";
import { CuteButton } from "@/components/ui/CuteButton";
import { SegmentControl } from "@/components/ui/SegmentControl";
import { QuickAiButton } from "@/components/ui/QuickAiButton";
import { useBabyStore } from "@/stores/useBabyStore";
import { calculateAge } from "@/lib/age";
import { getLocalDateStr, addDays, getWeekdayStr } from "@/lib/date";
import { Baby, Plus, Utensils, AlertCircle, Trash2, Heart, Smile, Meh, Frown, RefreshCw } from "lucide-react";
import type { FoodLogRecord } from "@/types";
import { openRecordDrawer } from "@/lib/drawer-bus";

function generateWeeklyDates() {
  const todayStr = getLocalDateStr();
  return Array.from({ length: 7 }, (_, i) => {
    const dateStr = addDays(todayStr, i - 3);
    const weekday = getWeekdayStr(dateStr).replace(/^周/, "");
    return {
      date: dateStr,
      day: Number(dateStr.slice(8, 10)),
      weekday,
      isToday: dateStr === todayStr,
    };
  });
}

const PORTION_LABELS: Record<string, string> = {
  little: "少量",
  half: "半碗",
  most: "大部分",
  all: "全部",
};

const STATE_ICONS: Record<string, { label: string; icon: typeof Smile; color: string }> = {
  happy: { label: "开心", icon: Smile, color: "text-emerald-500" },
  neutral: { label: "一般", icon: Meh, color: "text-amber-500" },
  rejected: { label: "抗拒", icon: Frown, color: "text-red-500" },
};

export default function FoodPage() {
  const router = useRouter();
  const user = useBabyStore((s) => s.user);
  const baby = useBabyStore((s) => s.baby);
  const fetchUser = useBabyStore((s) => s.fetchUser);
  const age = baby ? calculateAge(baby.birthDate) : { months: 0, days: 0, label: "0月0天" };
  const foodPlans = useBabyStore((s) => s.foodPlans);
  const fetchFoodPlans = useBabyStore((s) => s.fetchFoodPlans);
  const foodLogRecords = useBabyStore((s) => s.foodLogRecords);
  const fetchFoodLogRecords = useBabyStore((s) => s.fetchFoodLogRecords);
  const deleteTimelineRecord = useBabyStore((s) => s.deleteTimelineRecord);

  const weeklyDates = generateWeeklyDates();
  const [selectedDate, setSelectedDate] = useState(() => getLocalDateStr());
  const [activeTab, setActiveTab] = useState("today");

  // Ensure user and baby profile are loaded
  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const loadData = useCallback(() => {
    fetchFoodPlans(selectedDate, true);
    fetchFoodLogRecords(selectedDate, true);
  }, [selectedDate, fetchFoodPlans, fetchFoodLogRecords]);

  useEffect(() => {
    loadData();
  }, [loadData, baby?.id, user?.id]);

  // Auto-refresh when tab becomes visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        loadData();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [loadData]);

  // Get food plan for selected date
  const todayFoodPlan = foodPlans?.find((plan) => plan.date === selectedDate);
  // Filter food log records for selected date
  const dateFoodLogs = (foodLogRecords || []).filter((record) => record.date === selectedDate);

  const handleDeleteRecord = async (record: FoodLogRecord) => {
    const foodNames = Array.isArray(record.foods) ? record.foods.join("、") : "辅食";
    if (window.confirm(`确定删除「${foodNames}」这条辅食记录吗？`)) {
      try {
        await deleteTimelineRecord("food", record.id);
        fetchFoodLogRecords(selectedDate);
      } catch {
        alert("删除失败，请重试");
      }
    }
  };

  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([
        fetchFoodPlans(selectedDate, true),
        fetchFoodLogRecords(selectedDate, true),
      ]);
    } finally {
      setTimeout(() => setRefreshing(false), 500);
    }
  };

  const handleOpenFoodLog = () => {
    if (typeof window !== "undefined" && window.innerWidth >= 1024) {
      openRecordDrawer("food");
    } else {
      router.push("/food/log");
    }
  };

  return (
    <div className="min-h-[100dvh] bg-bg pb-36 px-4 max-w-md md:max-w-xl lg:max-w-6xl mx-auto space-y-5">
      {/* Baby info header */}
      <div className="pt-safe-4 flex items-center justify-between">
        <div
          className="flex items-center gap-3 cursor-pointer group"
          onClick={() => router.push("/onboarding")}
          title="点击修改宝宝资料与头像"
        >
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-light to-primary-soft flex items-center justify-center overflow-hidden shadow-soft group-hover:ring-2 group-hover:ring-primary/40 transition-all">
            {baby?.avatarUrl ? (
              <img src={baby.avatarUrl} alt={baby.nickname} className="w-full h-full object-cover" />
            ) : (
              <Baby size={24} className="text-primary" />
            )}
          </div>
          <div>
            <h2 className="text-base font-bold text-text-primary group-hover:text-primary transition-colors">
              {baby?.nickname ?? "宝宝"}
            </h2>
            <p className="text-xs text-text-secondary">{age.label}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="w-9 h-9 rounded-full bg-white shadow-soft flex items-center justify-center btn-press text-text-secondary hover:text-primary transition-colors cursor-pointer disabled:opacity-60"
            title="刷新辅食数据"
            aria-label="刷新辅食数据"
          >
            <RefreshCw size={15} className={refreshing ? "animate-spin text-primary" : ""} />
          </button>
          <QuickAiButton
            contextType="food"
            label="辅食问答"
            contextTitle="辅食与营养顾问"
          />
        </div>
      </div>

      {/* 7-day date picker */}
      <div>
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {weeklyDates.map((dateItem) => {
            const isSelected = dateItem.date === selectedDate;
            return (
              <button
                key={dateItem.date}
                type="button"
                onClick={() => setSelectedDate(dateItem.date)}
                className={`flex-shrink-0 flex flex-col items-center justify-center w-14 h-18 rounded-2xl transition-all btn-press cursor-pointer ${
                  isSelected
                    ? "bg-primary text-white shadow-button ring-2 ring-primary/30 font-bold"
                    : dateItem.isToday
                    ? "bg-primary-light text-primary border border-primary/40 font-semibold"
                    : "bg-card text-text-secondary hover:bg-card/80"
                }`}
              >
                <span className="text-xs font-medium mb-1">周{dateItem.weekday}</span>
                <span className="text-xl font-bold">{dateItem.day}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tabs */}
      <div>
        <SegmentControl
          options={[
            { value: "today", label: "🥣 辅食日记" },
            { value: "library", label: "🥕 食材库" },
            { value: "nutrition", label: "🍼 全量营养" },
          ]}
          value={activeTab}
          onChange={(v) => {
            if (v === "library") {
              router.push("/food/library");
            } else if (v === "nutrition") {
              router.push("/nutrition");
            } else {
              setActiveTab("today");
            }
          }}
        />
      </div>

      {/* 🌟 iPad / PC 双栏响应式布局 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* ===== 左栏：已吃辅食记录 (Col 7) ===== */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-1.5">
              <Utensils size={15} className="text-primary" />
              <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wider">
                进食打卡日志 ({dateFoodLogs.length})
              </h3>
            </div>
            <button
              type="button"
              onClick={handleOpenFoodLog}
              className="text-xs text-primary font-bold hover:underline flex items-center gap-0.5 cursor-pointer"
            >
              <Plus size={14} />
              <span>记辅食</span>
            </button>
          </div>

          {dateFoodLogs.length > 0 ? (
            <div className="space-y-3">
              {dateFoodLogs.map((log) => {
                const foods = Array.isArray(log.foods) ? log.foods : [];
                const stateObj = STATE_ICONS[log.babyState] || STATE_ICONS.happy;
                const StateIcon = stateObj.icon;

                return (
                  <CuteCard key={log.id} className="p-4 border border-primary/15 hover:border-primary/30 transition-all">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-2 flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="px-2.5 py-0.5 rounded-full bg-primary/10 text-primary font-bold text-xs">
                            🥣 {log.time}
                          </span>
                          <div className="flex items-center gap-1 text-[11px] text-text-muted">
                            <span>分量:</span>
                            <span className="font-semibold text-text-secondary">
                              {PORTION_LABELS[log.portion] || log.portion}
                            </span>
                          </div>
                        </div>

                        {/* 食材列表 */}
                        <div className="flex flex-wrap gap-1.5 pt-0.5">
                          {foods.map((food, idx) => (
                            <span
                              key={idx}
                              className="px-2.5 py-1 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 border border-amber-200/60 text-xs font-bold rounded-xl"
                            >
                              {food}
                            </span>
                          ))}
                        </div>

                        {/* 喜欢程度与状态 */}
                        <div className="flex items-center gap-3 pt-0.5 text-xs text-text-secondary">
                          <div className="flex items-center gap-1">
                            <Heart size={12} className="text-red-500 fill-red-500" />
                            <span className="text-[11px]">{log.acceptance} / 5 星</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <StateIcon size={13} className={stateObj.color} />
                            <span className="text-[11px]">{stateObj.label}</span>
                          </div>
                        </div>

                        {/* 异常提示 */}
                        {log.hasAbnormal && (
                          <div className="mt-2 p-2.5 bg-red-50 dark:bg-red-950/40 rounded-xl border border-red-100 dark:border-red-900/40 flex items-start gap-1.5 text-xs text-red-700 dark:text-red-300">
                            <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
                            <div>
                              <p className="font-bold">有异常反馈</p>
                              {log.abnormalNotes && <p className="text-[11px] mt-0.5">{log.abnormalNotes}</p>}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* 删除操作 */}
                      <button
                        type="button"
                        onClick={() => handleDeleteRecord(log)}
                        className="p-2 text-text-muted hover:text-red-500 rounded-xl hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer tap-hotzone"
                        title="删除该条辅食记录"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </CuteCard>
                );
              })}
            </div>
          ) : (
            <div className="bg-card rounded-2xl p-6 text-center border border-dashed border-primary/20 space-y-2.5">
              <p className="text-3xl">🥣</p>
              <p className="text-xs text-text-muted">该日期暂无辅食进食记录</p>
              <CuteButton size="sm" onClick={handleOpenFoodLog}>
                + 记录本餐辅食
              </CuteButton>
            </div>
          )}
        </div>

        {/* ===== 右栏：推荐食谱与制作 (Col 5) ===== */}
        <div className="lg:col-span-5 space-y-4">
          <div className="px-1">
            <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wider">
              推荐食谱与制作指南
            </h3>
          </div>

          {todayFoodPlan ? (
            <CuteCard variant="gradient" className="p-4 space-y-3">
              <div>
                <h3 className="text-base font-bold text-text-primary mb-2">
                  {todayFoodPlan.name}
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {todayFoodPlan.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2.5 py-0.5 bg-white dark:bg-card border border-primary/15 text-primary text-xs font-medium rounded-full shadow-2xs"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              {/* Nutrition */}
              <div className="bg-white dark:bg-card rounded-2xl p-3.5 border border-primary/15 shadow-xs">
                <p className="text-xs text-text-secondary font-bold mb-1">营养价值</p>
                <p className="text-xs font-medium text-text-primary leading-relaxed">
                  {todayFoodPlan.nutrition}
                </p>
              </div>

              {/* Ingredients */}
              <div>
                <p className="text-xs font-bold text-text-secondary mb-1.5">食材清单</p>
                <div className="flex flex-wrap gap-1.5">
                  {todayFoodPlan.ingredients.map((ingredient) => (
                    <span
                      key={ingredient}
                      className="px-2.5 py-1 bg-white dark:bg-card border border-primary/15 text-xs font-medium text-text-primary rounded-xl shadow-2xs"
                    >
                      {ingredient}
                    </span>
                  ))}
                </div>
              </div>

              {/* Steps */}
              <div>
                <p className="text-xs font-bold text-text-secondary mb-1.5">制作步骤</p>
                <ol className="flex flex-col gap-2">
                  {todayFoodPlan.steps.map((step, idx) => (
                    <li key={idx} className="flex gap-2 text-xs text-text-primary leading-relaxed">
                      <span className="shrink-0 w-4 h-4 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center mt-0.5">
                        {idx + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </CuteCard>
          ) : (
            <CuteCard className="p-6 text-center">
              <p className="text-3xl mb-1.5">🍽️</p>
              <p className="text-xs text-text-secondary">该日期暂无推荐食谱计划</p>
            </CuteCard>
          )}

          {/* Action buttons */}
          <div className="flex flex-col gap-2.5 pt-1">
            <CuteButton fullWidth onClick={handleOpenFoodLog}>
              记录辅食餐点
            </CuteButton>
            <CuteButton fullWidth variant="secondary" onClick={() => router.push("/food/library")}>
              查看食材库
            </CuteButton>
          </div>

          {/* Tip */}
          <div className="bg-primary-light/30 rounded-2xl p-4">
            <p className="text-xs text-text-secondary leading-relaxed">
              💡 首次添加新食材，建议持续观察 3 天排便与过敏反应。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
