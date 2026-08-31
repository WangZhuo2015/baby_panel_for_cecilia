"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Baby,
  RefreshCw,
  Package,
  AlertTriangle,
  AlertCircle,
  ChevronRight,
  Info,
} from "lucide-react";
import { useBabyStore } from "@/stores/useBabyStore";
import { calculateAge } from "@/lib/age";
import { getLocalDateStr, addDays, getWeekdayStr } from "@/lib/date";
import { CuteCard } from "@/components/ui/CuteCard";
import { CuteButton } from "@/components/ui/CuteButton";
import { SegmentControl } from "@/components/ui/SegmentControl";
import { QuickAiButton } from "@/components/ui/QuickAiButton";
import { CoreNutrientCard } from "@/components/nutrition/CoreNutrientCard";
import { CompoundSourceBreakdown } from "@/components/nutrition/CompoundSourceBreakdown";
import { FullNutrientTable } from "@/components/nutrition/FullNutrientTable";
import { NutritionTrendChart } from "@/components/nutrition/NutritionTrendChart";
import { SupplementQuickCheckIn } from "@/components/nutrition/SupplementQuickCheckIn";
import { ProductCatalogModal } from "@/components/nutrition/ProductCatalogModal";
import type { DailyNutritionAnalysis, MultiDayNutritionSummary } from "@/types/nutrition";

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

export default function NutritionPage() {
  const router = useRouter();
  const baby = useBabyStore((s) => s.baby);
  const fetchUser = useBabyStore((s) => s.fetchUser);

  const [selectedDate, setSelectedDate] = useState(() => getLocalDateStr());
  const [timeScale, setTimeScale] = useState<"today" | "7d" | "30d">("today");
  const [dailyAnalysis, setDailyAnalysis] = useState<DailyNutritionAnalysis | null>(null);
  const [multiDaySummary, setMultiDaySummary] = useState<MultiDayNutritionSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isCatalogOpen, setIsCatalogOpen] = useState<boolean>(false);

  const weeklyDates = generateWeeklyDates();

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const loadData = useCallback(async () => {
    if (!baby?.id) return;
    setLoading(true);
    try {
      if (timeScale === "today") {
        const res = await fetch(`/api/nutrition/analysis?babyId=${baby.id}&date=${selectedDate}&days=1`);
        if (res.ok) {
          const data = await res.json();
          setDailyAnalysis(data.analysis);
        }
      } else {
        const days = timeScale === "7d" ? 7 : 30;
        const res = await fetch(`/api/nutrition/analysis?babyId=${baby.id}&date=${selectedDate}&days=${days}`);
        if (res.ok) {
          const data = await res.json();
          setMultiDaySummary(data.summary);
          setDailyAnalysis(data.todayAnalysis);
        }
      }
    } catch (e) {
      console.error("Failed to load nutrition analysis:", e);
    } finally {
      setLoading(false);
    }
  }, [baby?.id, selectedDate, timeScale]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (!baby) {
    return (
      <div className="px-4 pt-safe-12 pb-36 max-w-md mx-auto text-center space-y-4">
        <CuteCard className="p-6 text-center">
          <p className="text-sm text-text-secondary">请先完善宝宝信息</p>
          <CuteButton className="mt-4" onClick={() => router.push("/onboarding")}>
            创建宝宝档案
          </CuteButton>
        </CuteCard>
      </div>
    );
  }

  const age = calculateAge(baby.birthDate);

  return (
    <div className="px-4 pt-safe-6 pb-36 max-w-md mx-auto space-y-4">
      {/* 头部导航与宝宝信息 */}
      <div className="flex items-center justify-between">
        <div
          className="flex items-center gap-3 cursor-pointer group"
          onClick={() => router.push("/onboarding")}
          title="修改宝宝资料"
        >
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-light to-primary/30 flex items-center justify-center overflow-hidden shadow-soft group-hover:ring-2 group-hover:ring-primary/40 transition-all">
            {baby.avatarUrl ? (
              <img src={baby.avatarUrl} alt={baby.nickname} className="w-full h-full object-cover" />
            ) : (
              <Baby size={24} className="text-primary" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-base font-bold text-text-primary group-hover:text-primary transition-colors">
                {baby.nickname}
              </span>
              <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.2 rounded-full font-bold">
                营养分析
              </span>
            </div>
            <span className="text-xs text-text-secondary">{age.label}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="w-9 h-9 rounded-full bg-white shadow-soft flex items-center justify-center btn-press text-text-secondary hover:text-primary transition-colors cursor-pointer disabled:opacity-60"
            title="刷新数据"
          >
            <RefreshCw size={15} className={loading ? "animate-spin text-primary" : ""} />
          </button>
          <button
            type="button"
            onClick={() => setIsCatalogOpen(true)}
            className="w-9 h-9 rounded-full bg-white shadow-soft flex items-center justify-center btn-press text-text-secondary hover:text-primary relative"
            title="配方奶粉与补剂库"
          >
            <Package size={16} />
          </button>
          <QuickAiButton
            contextType="feeding"
            label="营养顾问"
            contextTitle="AI 婴儿营养与补剂顾问"
            variant="compact"
          />
        </div>
      </div>

      {/* 7天快速日期切换 */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {weeklyDates.map((dateItem) => {
          const isSelected = dateItem.date === selectedDate;
          return (
            <button
              key={dateItem.date}
              type="button"
              onClick={() => setSelectedDate(dateItem.date)}
              className={`flex-shrink-0 flex flex-col items-center justify-center w-13 h-16 rounded-2xl transition-all btn-press ${
                isSelected
                  ? "bg-primary text-white shadow-button ring-2 ring-primary/30 font-bold"
                  : dateItem.isToday
                  ? "bg-primary-light text-primary border border-primary/40 font-semibold"
                  : "bg-white text-text-secondary hover:bg-gray-50 border border-divider/60"
              }`}
            >
              <span className="text-[10px] font-medium mb-0.5">周{dateItem.weekday}</span>
              <span className="text-lg font-bold">{dateItem.day}</span>
            </button>
          );
        })}
      </div>

      {/* 时间维度切换 */}
      <SegmentControl
        options={[
          { value: "today", label: "今日全量营养" },
          { value: "7d", label: "近 7 天趋势" },
          { value: "30d", label: "近 30 天周期" },
        ]}
        value={timeScale}
        onChange={(v) => setTimeScale(v as any)}
      />

      {/* ⚠️ 警示消息（如有过量风险或未补充） */}
      {dailyAnalysis?.alerts && dailyAnalysis.alerts.length > 0 && (
        <div className="space-y-2">
          {dailyAnalysis.alerts.map((alert, idx) => (
            <div
              key={idx}
              className={`p-3 rounded-2xl border flex items-start gap-2.5 shadow-2xs ${
                alert.type === "danger"
                  ? "bg-red-50/90 border-red-200 text-red-900"
                  : alert.type === "warning"
                  ? "bg-amber-50/90 border-amber-200 text-amber-900"
                  : "bg-sky-50/90 border-sky-200 text-sky-900"
              }`}
            >
              {alert.type === "danger" ? (
                <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
              ) : alert.type === "warning" ? (
                <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
              ) : (
                <Info size={16} className="text-sky-500 shrink-0 mt-0.5" />
              )}
              <div className="text-xs flex-1">
                <p className="font-bold">{alert.title}</p>
                <p className="text-[11px] mt-0.5 leading-relaxed opacity-90">{alert.message}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 🍼 今日概况横幅 */}
      {dailyAnalysis && (
        <CuteCard className="p-3.5 bg-gradient-to-r from-primary-light via-pink-50/40 to-lavender/20 border border-primary/20">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold text-text-secondary uppercase block">
                {selectedDate === getLocalDateStr() ? "今日累计进食与补给" : `${selectedDate} 营养摄入`}
              </span>
              <p className="text-sm font-black text-text-primary mt-0.5">
                总奶量 {dailyAnalysis.totalFeedingMl} ml · 补剂 {dailyAnalysis.supplementCount} 次
              </p>
            </div>
            <div className="text-right text-[11px] text-text-muted">
              <span>配方奶 {dailyAnalysis.formulaMl}ml</span>
              <span className="block">母乳 {dailyAnalysis.breastMl}ml</span>
            </div>
          </div>
        </CuteCard>
      )}

      {/* 💊 今日补剂快速打卡与安全守护 */}
      <SupplementQuickCheckIn babyId={baby.id} onRecordSuccess={loadData} />

      {/* 🌟 核心指标卡片矩阵 (Progress Rings & Target Rate) */}
      {dailyAnalysis && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wider">
              核心指标达标评估 (DRIs 2023)
            </h3>
            <span className="text-[10px] text-text-muted">
              适龄基准: {dailyAnalysis.ageGroup}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <CoreNutrientCard item={dailyAnalysis.coreMetrics.vitaminD} icon="☀️" />
            <CoreNutrientCard item={dailyAnalysis.coreMetrics.calcium} icon="🦴" />
            <CoreNutrientCard item={dailyAnalysis.coreMetrics.iron} icon="🩸" />
            <CoreNutrientCard item={dailyAnalysis.coreMetrics.vitaminA} icon="🥕" />
            <CoreNutrientCard item={dailyAnalysis.coreMetrics.zinc} icon="🛡️" />
            <CoreNutrientCard item={dailyAnalysis.coreMetrics.dha} icon="🐟" />
          </div>
        </div>
      )}

      {/* 📊 7天 / 30天 周期趋势图 (在切到趋势视图或多日模式时优先呈现) */}
      {multiDaySummary && multiDaySummary.dailyTrends.length > 0 && (
        <NutritionTrendChart
          trends={multiDaySummary.dailyTrends}
          daysCount={timeScale === "30d" ? 30 : 7}
        />
      )}

      {/* 🔬 复合补剂多源穿透分解 */}
      {dailyAnalysis?.allNutrients && (
        <CompoundSourceBreakdown items={dailyAnalysis.allNutrients} />
      )}

      {/* 📋 可展开的全量 30+ 营养素明细表 */}
      {dailyAnalysis?.allNutrients && (
        <FullNutrientTable items={dailyAnalysis.allNutrients} />
      )}

      {/* 快捷产品库与 OCR 管理按钮 */}
      <CuteCard
        className="p-3.5 bg-gradient-to-r from-sky-50 to-blue-50/40 border border-sky-200/80 flex items-center justify-between cursor-pointer hover:shadow-md transition-all"
        onClick={() => setIsCatalogOpen(true)}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-sky-100 text-sky-600 flex items-center justify-center">
            <Package size={20} />
          </div>
          <div>
            <h4 className="text-xs font-bold text-sky-950">配方奶粉与补剂库管理</h4>
            <p className="text-[10px] text-sky-800 mt-0.5">
              支持冲调浓度配置、预置库导入与 📸 拍照 OCR 成分表
            </p>
          </div>
        </div>
        <ChevronRight size={16} className="text-sky-600" />
      </CuteCard>

      {/* 产品库管理弹窗 */}
      <ProductCatalogModal
        isOpen={isCatalogOpen}
        onClose={() => setIsCatalogOpen(false)}
        babyId={baby.id}
        onUpdated={loadData}
      />
    </div>
  );
}
