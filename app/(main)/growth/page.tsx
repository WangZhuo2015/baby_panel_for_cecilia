"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus, Baby, Sparkles, RefreshCw } from "lucide-react";
import dynamic from "next/dynamic";
import { useBabyStore } from "@/stores/useBabyStore";
import { calculateAge } from "@/lib/age";
import { SegmentControl } from "@/components/ui/SegmentControl";
import { CuteCard } from "@/components/ui/CuteCard";
import { QuickAiButton } from "@/components/ui/QuickAiButton";
import { openRecordDrawer } from "@/lib/drawer-bus";

const GrowthLineChart = dynamic(() => import("@/components/growth/GrowthLineChart"), {
  ssr: false,
  loading: () => (
    <div className="h-[260px] sm:h-[320px] lg:h-[360px] flex items-center justify-center text-xs text-text-muted">
      加载生长曲线图表...
    </div>
  ),
});

type GrowthTab = "weight" | "height" | "head";

export default function GrowthPage() {
  const router = useRouter();
  const baby = useBabyStore((s) => s.baby);
  const age = baby ? calculateAge(baby.birthDate) : { months: 0, days: 0, label: "0月0天" };
  const measurements = useBabyStore((s) => s.growthMeasurements);
  const fetchGrowthMeasurements = useBabyStore((s) => s.fetchGrowthMeasurements);

  const [activeTab, setActiveTab] = useState<GrowthTab>("weight");
  const [whoPercentiles, setWhoPercentiles] = useState<Record<string, Record<string, number[]>>>({
    weight: {},
    height: {},
    headCircumference: {},
  });
  const [monthLabels, setMonthLabels] = useState<number[]>([]);

  useEffect(() => {
    fetchGrowthMeasurements();
    fetch("/api/growth/chart")
      .then((res) => res.json())
      .then((data) => {
        if (data.whoPercentiles) setWhoPercentiles(data.whoPercentiles);
        if (data.monthLabels) setMonthLabels(data.monthLabels);
      })
      .catch(() => {});
  }, [fetchGrowthMeasurements]);

  const latest = measurements[0];

  const tabs = [
    { value: "weight", label: "体重" },
    { value: "height", label: "身长" },
    { value: "head", label: "头围" },
  ];

  const tabPercentileKey: Record<GrowthTab, string> = {
    weight: "weight",
    height: "height",
    head: "headCircumference",
  };


  const percentiles = whoPercentiles[tabPercentileKey[activeTab]];

  // Build chart data with percentile lines
  const chartData = monthLabels.map((month, i) => {
    const point: Record<string, number | string> = { month: `${month}月` };
    if (percentiles?.P97 && i < percentiles.P97.length) {
      point.P97 = percentiles.P97[i];
      point.P85 = percentiles.P85[i];
      point.P50 = percentiles.P50[i];
      point.P15 = percentiles.P15[i];
      point.P3 = percentiles.P3[i];
    }
    // Add baby's data point
    const babyData = measurements.find((m) => Math.abs((m.ageInMonths ?? 0) - month) < 0.6);
    if (babyData) {
      if (activeTab === "weight" && babyData.weightKg !== undefined) {
        point.baby = babyData.weightKg;
      } else if (activeTab === "height" && babyData.heightCm !== undefined) {
        point.baby = babyData.heightCm;
      } else if (activeTab === "head" && babyData.headCircumferenceCm !== undefined) {
        point.baby = babyData.headCircumferenceCm;
      }
    }
    return point;
  });

  const getPercentileLevelText = (p?: number | null) => {
    if (p == null) return "暂无分位数据";
    if (p >= 97) return "处于高百分位区间 (>P97)";
    if (p >= 85) return "处于偏高百分位区间 (P85-P97)";
    if (p >= 50) return "处于标准中等水平 (P50-P85)";
    if (p >= 15) return "处于标准中等水平 (P15-P50)";
    if (p >= 3) return "处于偏低水平 (P3-P15)";
    return "处于低百分位区间 (<P3)";
  };

  const currentTabLabel = tabs.find((t) => t.value === activeTab)?.label || "生长";
  const currentUnit =
    activeTab === "weight" ? "kg" : activeTab === "height" ? "cm" : activeTab === "head" ? "cm" : "";
  const currentLatestValue =
    activeTab === "weight"
      ? latest?.weightKg
      : activeTab === "height"
      ? latest?.heightCm
      : activeTab === "head"
      ? latest?.headCircumferenceCm
      : undefined;


  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([
        fetchGrowthMeasurements(true),
        fetch("/api/growth/chart")
          .then((res) => res.json())
          .then((data) => {
            if (data.whoPercentiles) setWhoPercentiles(data.whoPercentiles);
            if (data.monthLabels) setMonthLabels(data.monthLabels);
          })
          .catch(() => {}),
      ]);
    } finally {
      setTimeout(() => setRefreshing(false), 500);
    }
  };

  const handleOpenAddGrowth = () => {
    if (typeof window !== "undefined" && window.innerWidth >= 1024) {
      openRecordDrawer("growth");
    } else {
      router.push("/growth/add");
    }
  };

  return (
    <div className="px-4 pt-safe-6 pb-36 max-w-md md:max-w-xl lg:max-w-6xl mx-auto space-y-5">
      {/* Baby Header */}
      <div className="flex items-center justify-between">
        <div
          className="flex items-center gap-3 cursor-pointer group"
          onClick={() => router.push("/onboarding")}
          title="点击修改宝宝资料与头像"
        >
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-soft to-primary/30 flex items-center justify-center shadow-soft overflow-hidden group-hover:ring-2 group-hover:ring-primary/40 transition-all">
            {baby?.avatarUrl ? (
              <img src={baby.avatarUrl} alt={baby.nickname} className="w-full h-full object-cover" />
            ) : (
              <Baby size={24} className="text-primary" />
            )}
          </div>
          <div>
            <p className="text-base font-bold text-text-primary group-hover:text-primary transition-colors">
              {baby?.nickname ?? "宝宝"}
            </p>
            <p className="text-xs text-text-secondary">{age.label} · WHO 0-36月生长曲线</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="w-9 h-9 rounded-full bg-white shadow-soft flex items-center justify-center btn-press text-text-secondary hover:text-primary transition-colors cursor-pointer disabled:opacity-60"
            title="刷新生长曲线数据"
            aria-label="刷新生长曲线数据"
          >
            <RefreshCw size={15} className={refreshing ? "animate-spin text-primary" : ""} />
          </button>
          <QuickAiButton
            contextType="growth"
            label="曲线解读"
            contextTitle="生长发育曲线顾问"
            contextDetail={{
              latestTab: currentTabLabel,
              latestValue: currentLatestValue != null ? `${currentLatestValue} ${currentUnit}` : undefined,
              percentile: latest?.percentile != null ? `P${latest.percentile}` : undefined,
            }}
          />
        </div>
      </div>

      {/* 🌟 iPad / PC 左图右表双栏响应式工作台网格 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* ===== 左栏：生长曲线图与标准对照 (Col 7) ===== */}
        <div className="lg:col-span-7 space-y-4">
          {/* Tabs */}
          <SegmentControl options={tabs} value={activeTab} onChange={(v) => setActiveTab(v as GrowthTab)} />

          {/* Chart Card */}
          <CuteCard className="p-4">
            <GrowthLineChart data={chartData} />
            <div className="flex items-center justify-center gap-4 mt-3 pt-2 border-t border-primary/10">
              <span className="flex items-center gap-1.5 text-[11px] text-text-secondary font-medium">
                <span className="w-3.5 h-1 bg-primary rounded-full" /> 宝宝实测
              </span>
              <span className="flex items-center gap-1.5 text-[11px] text-text-muted">
                <span className="w-3.5 h-0.5 bg-primary-soft rounded-full" style={{ borderTop: "1px dashed #FFB5D0" }} /> WHO 百分位
              </span>
            </div>
          </CuteCard>

          {/* Reference Note */}
          <CuteCard className="bg-gradient-to-br from-primary-light to-lavender/5 border border-lavender/20 p-4">
            <div className="flex gap-3">
              <div className="shrink-0 w-9 h-9 rounded-xl bg-lavender/15 flex items-center justify-center mt-0.5">
                <Sparkles size={16} className="text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-text-primary leading-relaxed font-bold">
                  WHO 儿童生长标准说明
                </p>
                <p className="text-[11px] text-text-secondary mt-1 leading-relaxed">
                  图表基于世界卫生组织 (WHO) 0-36 个月儿童生长标准曲线对照。P3-P97 均属正常发育区间，重点在于生长曲线趋势是否平稳增长。
                </p>
              </div>
            </div>
          </CuteCard>
        </div>

        {/* ===== 右栏：最新评估与测量历史记录 (Col 5) ===== */}
        <div className="lg:col-span-5 space-y-4">
          {/* Current Stats */}
          <CuteCard className="bg-gradient-to-br from-primary-light to-lavender/10 border border-primary/15 p-4.5">
            <div className="text-center">
              <p className="text-xs text-text-secondary font-medium mb-1">最新{currentTabLabel}</p>
              <p className="text-3xl font-black text-primary">
                {currentLatestValue != null ? `${currentLatestValue} ${currentUnit}` : "--"}
              </p>
              <div className="flex items-center justify-center gap-2 mt-2.5">
                <span className="px-3 py-1 rounded-full bg-mint/15 text-xs font-bold text-mint">
                  {latest?.percentile != null ? `P${latest.percentile}` : "标准曲线对照"}
                </span>
                <span className="text-xs text-text-secondary">
                  {getPercentileLevelText(latest?.percentile)}
                </span>
              </div>
            </div>
          </CuteCard>

          {/* Add Button */}
          <button
            type="button"
            onClick={handleOpenAddGrowth}
            className="w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-[20px] bg-gradient-to-r from-primary to-pink-500 text-white font-bold shadow-button btn-press text-sm cursor-pointer hover:opacity-95"
          >
            <Plus size={18} />
            <span>添加生长记录（支持拍照识别）</span>
          </button>

          {/* Measurement History */}
          <CuteCard className="p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-primary/10">
              <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wider">
                测量历史明细 ({measurements.length})
              </h3>
              <span className="text-[10px] text-text-muted">倒序排列</span>
            </div>

            {measurements.length === 0 ? (
              <p className="text-xs text-text-muted text-center py-6">暂无生长测量记录，点击上方按钮添加</p>
            ) : (
              <div className="space-y-2.5 max-h-[360px] overflow-y-auto pr-1">
                {measurements.slice(0, 15).map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-white/60 dark:bg-card/60 border border-primary/10 hover:border-primary/30 transition-all"
                  >
                    <div>
                      <p className="text-[11px] text-text-muted">{m.date}</p>
                      <p className="text-xs font-bold text-text-primary mt-0.5">{m.ageLabel}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-black text-primary">
                        {m.weightKg != null ? `${m.weightKg}kg` : ""}
                        {m.heightCm != null ? ` · ${m.heightCm}cm` : ""}
                        {m.headCircumferenceCm != null ? ` · 头围${m.headCircumferenceCm}cm` : ""}
                      </p>
                      {m.percentile != null && (
                        <p className="text-[10px] text-text-muted mt-0.5">WHO P{m.percentile}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CuteCard>
        </div>
      </div>
    </div>
  );
}
