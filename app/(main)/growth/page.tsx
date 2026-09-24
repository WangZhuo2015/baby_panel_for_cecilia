"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Baby,
  Sparkles,
  RefreshCw,
  Trash2,
  Scale,
  Ruler,
  CircleDot,
  Calendar,
  Activity,
  Info,
  Camera,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  Pencil,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useBabyStore } from "@/stores/useBabyStore";
import { calculateAge } from "@/lib/age";
import { SegmentControl } from "@/components/ui/SegmentControl";
import { AgentBadge } from "@/components/ui/AgentBadge";
import { CuteCard } from "@/components/ui/CuteCard";
import { QuickAiButton } from "@/components/ui/QuickAiButton";
import { openRecordDrawer } from "@/lib/drawer-bus";
import { WhoPercentileChips } from "@/components/growth/WhoPercentileCard";
import { getWhoMetricsForBaby } from "@/lib/who-growth-standards";
import { BabyAvatar } from "@/components/ui/BabyAvatar";
import { isWorkbenchViewport } from "@/lib/responsive";
import { useToast } from "@/components/ui/Toast";
import { GrowthForm } from "@/components/records/GrowthForm";
import type { GrowthMeasurement } from "@/types";

const GrowthLineChart = dynamic(() => import("@/components/growth/GrowthLineChart"), {
  ssr: false,
  loading: () => (
    <div className="h-[260px] sm:h-[320px] lg:h-[360px] flex items-center justify-center text-xs text-text-muted">
      加载生长曲线图表...
    </div>
  ),
});

type GrowthTab = "weight" | "height" | "head";

type GrowthEditScope = {
  userId: string;
  familyId: string;
  babyId: string;
};

function hasObservedGrowthVersion(measurement: GrowthMeasurement): boolean {
  const version = measurement.baseVersion ?? measurement.version;
  return (typeof version === "string" && /^[1-9]\d*$/.test(version))
    || (typeof version === "number" && Number.isSafeInteger(version) && version > 0);
}

export default function GrowthPage() {
  const router = useRouter();
  const baby = useBabyStore((s) => s.baby);
  const fetchUser = useBabyStore((s) => s.fetchUser);
  const selectedBabyId = useBabyStore((s) => s.selectedBabyId);
  const userId = useBabyStore((s) => s.user?.id ?? null);
  const familyId = useBabyStore((s) => s.family?.id ?? null);
  const babyIdsKey = useBabyStore((s) => s.babies.map((item) => item.id).join(","));
  const age = baby ? calculateAge(baby.birthDate) : { months: 0, days: 0, label: "0月0天" };
  const measurements = useBabyStore((s) => s.growthMeasurements);
  const fetchGrowthMeasurements = useBabyStore((s) => s.fetchGrowthMeasurements);
  const updateGrowthMeasurement = useBabyStore((s) => s.updateGrowthMeasurement);
  const deleteGrowthMeasurement = useBabyStore((s) => s.deleteGrowthMeasurement);
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<GrowthTab>("weight");
  const [showAllMeasurements, setShowAllMeasurements] = useState(false);
  const [whoPercentiles, setWhoPercentiles] = useState<Record<string, Record<string, number[]>>>({
    weight: {},
    height: {},
    headCircumference: {},
  });
  const [monthLabels, setMonthLabels] = useState<number[]>([]);

  const [chartError, setChartError] = useState<string | null>(null);

  useEffect(() => {
    void fetchUser();
  }, [fetchUser]);

  const loadChart = useCallback(async () => {
    if (!selectedBabyId) return;
    try {
      const query = new URLSearchParams({ babyId: selectedBabyId });
      const res = await fetch(`/api/growth/chart?${query}`, {
        headers: { "x-growdesk-representation": "extended" },
      });
      if (!res.ok) throw new Error("生长曲线加载失败，请重试");
      const data = await res.json();
      // A late response for a previous baby must not replace the active chart.
      if (useBabyStore.getState().selectedBabyId !== selectedBabyId) return;
      if (data.whoPercentiles) setWhoPercentiles(data.whoPercentiles);
      if (data.monthLabels) setMonthLabels(data.monthLabels);
      setChartError(null);
    } catch {
      if (useBabyStore.getState().selectedBabyId !== selectedBabyId) return;
      setMonthLabels([]);
      setChartError("生长曲线加载失败，请重试");
    }
  }, [selectedBabyId]);

  useEffect(() => {
    setWhoPercentiles({ weight: {}, height: {}, headCircumference: {} });
    setMonthLabels([]);
    setChartError(null);
    if (!selectedBabyId) return;
    fetchGrowthMeasurements();
    void loadChart();
  }, [fetchGrowthMeasurements, selectedBabyId, loadChart]);

  const tabs = [
    { value: "weight", label: "⚖️ 体重" },
    { value: "height", label: "📏 身长" },
    { value: "head", label: "👶 头围" },
  ];

  const tabPercentileKey: Record<GrowthTab, string> = {
    weight: "weight",
    height: "height",
    head: "headCircumference",
  };

  const percentiles = whoPercentiles[tabPercentileKey[activeTab]];

  // 1. 各指标回溯查找最新一条有效测量记录（避免最新单次只测体重导致身高头围展示为--）
  const latestWeightRec = useMemo(
    () => measurements.find((m) => m.weightKg != null),
    [measurements]
  );
  const latestHeightRec = useMemo(
    () => measurements.find((m) => m.heightCm != null),
    [measurements]
  );
  const latestHeadRec = useMemo(
    () => measurements.find((m) => m.headCircumferenceCm != null),
    [measurements]
  );

  const activeRecord =
    activeTab === "weight"
      ? latestWeightRec
      : activeTab === "height"
      ? latestHeightRec
      : latestHeadRec;

  const currentTabLabel = tabs.find((t) => t.value === activeTab)?.label || "生长";
  const currentUnit =
    activeTab === "weight" ? "kg" : activeTab === "height" ? "cm" : activeTab === "head" ? "cm" : "";

  const currentLatestValue =
    activeTab === "weight"
      ? activeRecord?.weightKg
      : activeTab === "height"
      ? activeRecord?.heightCm
      : activeRecord?.headCircumferenceCm;

  // 2. 针对当前选中的指标和测量日期，使用 WHO 权威曲线精准计算百分位
  const activeWhoMetrics = useMemo(() => {
    if (!activeRecord || !baby) return null;
    const res = getWhoMetricsForBaby(baby, activeRecord.date, {
      weightKg: activeTab === "weight" ? activeRecord.weightKg ?? undefined : undefined,
      heightCm: activeTab === "height" ? activeRecord.heightCm ?? undefined : undefined,
      headCircumferenceCm: activeTab === "head" ? activeRecord.headCircumferenceCm ?? undefined : undefined,
    });
    return res[0] ?? null;
  }, [activeRecord, baby, activeTab]);

  // 3. 计算三项指标各自的最新 WHO 评估结果（用于三项指标快览）
  const allLatestMetrics = useMemo(() => {
    if (!baby) return [];
    return [
      {
        tab: "weight" as GrowthTab,
        name: "体重",
        icon: "⚖️",
        unit: "kg",
        record: latestWeightRec,
        value: latestWeightRec?.weightKg,
        who: latestWeightRec
          ? getWhoMetricsForBaby(baby, latestWeightRec.date, { weightKg: latestWeightRec.weightKg ?? undefined })[0]
          : null,
      },
      {
        tab: "height" as GrowthTab,
        name: "身长",
        icon: "📏",
        unit: "cm",
        record: latestHeightRec,
        value: latestHeightRec?.heightCm,
        who: latestHeightRec
          ? getWhoMetricsForBaby(baby, latestHeightRec.date, { heightCm: latestHeightRec.heightCm ?? undefined })[0]
          : null,
      },
      {
        tab: "head" as GrowthTab,
        name: "头围",
        icon: "👶",
        unit: "cm",
        record: latestHeadRec,
        value: latestHeadRec?.headCircumferenceCm,
        who: latestHeadRec
          ? getWhoMetricsForBaby(baby, latestHeadRec.date, { headCircumferenceCm: latestHeadRec.headCircumferenceCm ?? undefined })[0]
          : null,
      },
    ];
  }, [baby, latestWeightRec, latestHeightRec, latestHeadRec]);

  // 4. 生成曲线图数据：根据当前 Tab 精准采点，避免被无该指标的记录截断
  const chartData = useMemo(() => {
    return monthLabels.map((month, i) => {
      const point: Record<string, any> = { month: `${month}月` };
      if (percentiles?.P97 && i < percentiles.P97.length) {
        point.P97 = percentiles.P97[i];
        point.P85 = percentiles.P85[i];
        point.P50 = percentiles.P50[i];
        point.P15 = percentiles.P15[i];
        point.P3 = percentiles.P3[i];
      }
      // 查找该月龄区间且该指标有实际数值的记录
      const babyData = measurements.find((m) => {
        if (Math.abs((m.ageInMonths ?? 0) - month) >= 0.6) return false;
        if (activeTab === "weight") return m.weightKg != null;
        if (activeTab === "height") return m.heightCm != null;
        if (activeTab === "head") return m.headCircumferenceCm != null;
        return false;
      });

      if (babyData) {
        point.date = babyData.date;
        point.ageLabel = babyData.ageLabel;
        const whoRes = getWhoMetricsForBaby(baby, babyData.date, {
          weightKg: activeTab === "weight" ? babyData.weightKg ?? undefined : undefined,
          heightCm: activeTab === "height" ? babyData.heightCm ?? undefined : undefined,
          headCircumferenceCm: activeTab === "head" ? babyData.headCircumferenceCm ?? undefined : undefined,
        });
        point.percentile = whoRes[0]?.percentile ?? babyData.percentile;
        if (activeTab === "weight" && babyData.weightKg != null) {
          point.baby = babyData.weightKg;
        } else if (activeTab === "height" && babyData.heightCm != null) {
          point.baby = babyData.heightCm;
        } else if (activeTab === "head" && babyData.headCircumferenceCm != null) {
          point.baby = babyData.headCircumferenceCm;
        }
      }
      return point;
    });
  }, [monthLabels, percentiles, measurements, activeTab, baby]);

  const getPercentileLevelText = (p?: number | null) => {
    if (p == null) return "暂无分位数据";
    if (p >= 97) return "处于高百分位区间 (>P97)";
    if (p >= 85) return "偏大/偏重 (P85-P97)";
    if (p >= 50) return "处于标准中等水平 (P50-P85)";
    if (p >= 15) return "处于标准中等水平 (P15-P50)";
    if (p >= 3) return "偏小/偏轻 (P3-P15)";
    return "处于低百分位区间 (<P3)";
  };


  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([
        fetchGrowthMeasurements(true),
        loadChart(),
      ]);
    } finally {
      setTimeout(() => setRefreshing(false), 500);
    }
  };

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingMeasurement, setEditingMeasurement] = useState<GrowthMeasurement | null>(null);
  const [editingScope, setEditingScope] = useState<GrowthEditScope | null>(null);
  const [editingSaving, setEditingSaving] = useState(false);

  useEffect(() => {
    // Closing an editor on scope changes prevents a previous baby's record or
    // photo from remaining visible while the new baby's list is loading.
    setEditingMeasurement(null);
    setEditingScope(null);
    setEditingSaving(false);
  }, [selectedBabyId, userId, familyId, babyIdsKey]);

  useEffect(() => {
    if (!editingMeasurement) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !editingSaving) {
        setEditingMeasurement(null);
        setEditingScope(null);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [editingMeasurement, editingSaving]);

  const handleDeleteMeasurement = async (id: string, date: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`确定要删除 ${date} 的这条生长测量记录吗？`)) return;
    setDeletingId(id);
    try {
      await deleteGrowthMeasurement(id);
      await loadChart();
    } catch {
      alert("删除失败，请重试");
    } finally {
      setDeletingId(null);
    }
  };

  const handleOpenEditMeasurement = (measurement: GrowthMeasurement, e: React.MouseEvent) => {
    e.stopPropagation();
    const scope = useBabyStore.getState();
    if (!selectedBabyId || !scope.user?.id || !scope.family?.id || !hasObservedGrowthVersion(measurement)) {
      showToast("当前模式暂不支持编辑这条生长记录");
      return;
    }
    if ((measurement.babyId && measurement.babyId !== selectedBabyId)
      || (measurement.familyId && measurement.familyId !== scope.family.id)) {
      showToast("生长记录不属于当前宝宝，请刷新后重试");
      return;
    }
    setEditingScope({ userId: scope.user.id, familyId: scope.family.id, babyId: selectedBabyId });
    setEditingMeasurement(measurement);
  };

  const handleSaveEdit = async (data: {
    date: string;
    weightKg?: number;
    heightCm?: number;
    headCircumferenceCm?: number;
    imageUrl?: string | null;
  }) => {
    const measurement = editingMeasurement;
    const editScope = editingScope;
    if (!measurement || !editScope) {
      showToast("宝宝信息尚未加载完成，请刷新后重试");
      return;
    }
    const currentBeforeSave = useBabyStore.getState();
    if (currentBeforeSave.user?.id !== editScope.userId
      || currentBeforeSave.family?.id !== editScope.familyId
      || currentBeforeSave.baby?.id !== editScope.babyId
      || currentBeforeSave.selectedBabyId !== editScope.babyId) {
      setEditingMeasurement(null);
      setEditingScope(null);
      showToast("宝宝或账号正在切换，请稍后重试");
      return;
    }
    const snapshotBabyId = measurement.babyId ?? editScope.babyId;
    const snapshotBaseVersion = measurement.baseVersion ?? measurement.version;
    if (snapshotBabyId !== editScope.babyId || !hasObservedGrowthVersion(measurement) || snapshotBaseVersion == null) {
      showToast("请刷新记录后重试，缺少原记录版本");
      return;
    }
    setEditingSaving(true);
    try {
      await updateGrowthMeasurement(measurement.id, {
        ...data,
        babyId: snapshotBabyId,
        familyId: editScope.familyId,
        baseVersion: snapshotBaseVersion,
      });
      const scope = useBabyStore.getState();
      if (scope.user?.id !== editScope.userId
        || scope.family?.id !== editScope.familyId
        || scope.selectedBabyId !== editScope.babyId
        || scope.baby?.id !== editScope.babyId) {
        setEditingMeasurement(null);
        setEditingScope(null);
        return;
      }
      await loadChart();
      setEditingMeasurement(null);
      setEditingScope(null);
      showToast("生长记录已更新 📈");
    } catch (error) {
      const scope = useBabyStore.getState();
      if (scope.user?.id !== editScope.userId
        || scope.family?.id !== editScope.familyId
        || scope.selectedBabyId !== editScope.babyId
        || scope.baby?.id !== editScope.babyId) {
        setEditingMeasurement(null);
        setEditingScope(null);
        return;
      }
      const message = error instanceof Error ? error.message : "保存失败，请重试";
      showToast(message === "请求失败 (501)" ? "当前本地模式暂不支持编辑生长记录" : message);
    } finally {
      setEditingSaving(false);
    }
  };

  const handleOpenAddGrowth = () => {
    if (isWorkbenchViewport()) {
      openRecordDrawer("growth");
    } else {
      router.push("/growth/add");
    }
  };

  return (
    <div className="px-4 pt-safe-6 pb-36 workbench:pb-12 max-w-md md:max-w-xl workbench:max-w-none lg:max-w-7xl mx-auto space-y-5">
      {chartError && <p role="alert" className="text-sm text-text-secondary">{chartError}</p>}
      {/* Baby Header / Desktop Title */}
      <div className="flex items-center justify-between">
        {/* 移动端宝宝头像与信息卡片，PC与平板横屏工作台由左侧边栏统一承载 */}
        <div
          className="flex items-center gap-3 cursor-pointer group workbench:hidden"
          onClick={() => router.push("/onboarding")}
          title="点击修改宝宝资料与头像"
        >
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-soft to-primary/30 flex items-center justify-center shadow-soft overflow-hidden group-hover:ring-2 group-hover:ring-primary/40 transition-all">
            {baby?.avatarUrl ? (
              <BabyAvatar src={baby.avatarUrl} alt={baby.nickname} size={48} />
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

        {/* PC / 平板横屏端主标题 */}
        <div className="hidden workbench:block">
          <h1 className="text-xl font-bold text-text-primary">WHO 生长曲线</h1>
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
              percentile: activeWhoMetrics?.percentile != null ? `P${activeWhoMetrics.percentile}` : undefined,
              evaluation: activeWhoMetrics?.evaluation?.label,
              measuredDate: activeRecord?.date,
            }}
          />
        </div>
      </div>

      {/* 🌟 iPad / PC / 小型平板横屏 左图右表双栏响应式工作台网格 */}
      <div className="grid grid-cols-1 workbench:grid-cols-12 gap-5 items-start">
        {/* ===== 左栏：生长曲线图与标准对照 (Col 7) ===== */}
        <div className="workbench:col-span-7 space-y-4">
          {/* Tabs */}
          <SegmentControl options={tabs} value={activeTab} onChange={(v) => setActiveTab(v as GrowthTab)} />

          {/* Chart Card */}
          <CuteCard className="p-4">
            <GrowthLineChart
              data={chartData}
              unit={currentUnit}
              defaultRange={age.months > 24 ? "36" : age.months > 12 ? "24" : "12"}
            />
          </CuteCard>

          {/* Reference Note */}
          <CuteCard className="bg-gradient-to-br from-primary-light to-lavender/5 border border-lavender/20 p-4">
            <div className="flex gap-3">
              <div className="shrink-0 w-9 h-9 rounded-xl bg-lavender/15 flex items-center justify-center mt-0.5 text-primary">
                <Info size={16} />
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
        <div className="workbench:col-span-5 space-y-4">
          {/* Current Stats */}
          <CuteCard className="bg-gradient-to-br from-primary-light to-lavender/10 border border-primary/15 p-4.5">
            <div className="text-center">
              <div className="flex items-center justify-center gap-1.5 text-xs text-text-secondary font-medium mb-1">
                {activeTab === "weight" && <Scale size={14} className="text-primary" />}
                {activeTab === "height" && <Ruler size={14} className="text-primary" />}
                {activeTab === "head" && <CircleDot size={14} className="text-primary" />}
                <span>最新{currentTabLabel.replace(/^[^\s]+ /, "")}</span>
                {activeRecord?.date && (
                  <span className="text-[10px] text-text-muted">({activeRecord.date} 测)</span>
                )}
              </div>
              <p className="text-3xl font-black text-primary">
                {currentLatestValue != null ? `${currentLatestValue} ${currentUnit}` : "--"}
              </p>
              <div className="flex items-center justify-center gap-2 mt-2.5">
                <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                  activeWhoMetrics?.evaluation
                    ? `${activeWhoMetrics.evaluation.badgeBg} ${activeWhoMetrics.evaluation.badgeColor}`
                    : "bg-mint/15 text-mint"
                }`}>
                  {activeWhoMetrics?.percentile != null ? `P${activeWhoMetrics.percentile}` : "标准曲线对照"}
                </span>
                <span className="text-xs text-text-secondary">
                  {activeWhoMetrics?.evaluation?.label || getPercentileLevelText(activeWhoMetrics?.percentile)}
                </span>
              </div>
            </div>

            {/* 三项最新指标快览 (点击可切换 Tab) */}
            <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-primary/15">
              {allLatestMetrics.map((item) => {
                const isSelected = activeTab === item.tab;
                return (
                  <button
                    key={item.tab}
                    type="button"
                    onClick={() => setActiveTab(item.tab)}
                    className={`p-2 rounded-xl text-center transition-all cursor-pointer border ${
                      isSelected
                        ? "bg-white dark:bg-card shadow-sm border-primary ring-2 ring-primary/20"
                        : "bg-primary-light/30 dark:bg-card/40 border-transparent hover:border-primary/20"
                    }`}
                    title={`点击切换至${item.name}`}
                  >
                    <div className="text-[10px] text-text-muted font-medium flex items-center justify-center gap-0.5 mb-0.5">
                      <span>{item.icon}</span>
                      <span>{item.name}</span>
                    </div>
                    <div className="text-xs font-black text-text-primary">
                      {item.value != null ? `${item.value} ${item.unit}` : "--"}
                    </div>
                    <div className="text-[10px] font-bold mt-0.5">
                      {item.who?.percentile != null ? (
                        <span className={item.who.evaluation.badgeColor}>
                          P{item.who.percentile}
                        </span>
                      ) : (
                        <span className="text-text-muted font-normal">--</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </CuteCard>

          {/* Add Button */}
          <button
            type="button"
            onClick={handleOpenAddGrowth}
            className="w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-[20px] bg-gradient-to-r from-primary to-pink-500 text-white font-bold shadow-button btn-press text-sm cursor-pointer hover:opacity-95 transition-all"
          >
            <Plus size={18} />
            <span>添加生长记录</span>
            <span className="text-[11px] font-medium opacity-90 px-2 py-0.5 rounded-full bg-white/20 flex items-center gap-1">
              <Camera size={12} /> 拍照识别
            </span>
          </button>

          {/* Measurement History */}
          <CuteCard className="p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-primary/10">
              <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wider flex items-center gap-1.5">
                <TrendingUp size={14} className="text-primary" />
                <span>测量历史明细 ({measurements.length})</span>
              </h3>
              <span className="text-[10px] text-text-muted">倒序排列</span>
            </div>

            {measurements.length === 0 ? (
              <div className="text-center py-6">
                <div className="w-10 h-10 rounded-full bg-primary-light flex items-center justify-center mx-auto mb-2 text-primary">
                  <Activity size={18} />
                </div>
                <p className="text-xs text-text-muted">暂无生长测量记录，点击上方按钮添加</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {(showAllMeasurements ? measurements : measurements.slice(0, 8)).map((m) => {
                  const whoRes = getWhoMetricsForBaby(baby, m.date, {
                    weightKg: m.weightKg ?? undefined,
                    heightCm: m.heightCm ?? undefined,
                    headCircumferenceCm: m.headCircumferenceCm ?? undefined,
                  });
                  const whoMap = Object.fromEntries(whoRes.map((w) => [w.key, w]));

                  return (
                    <div
                      key={m.id}
                      className="p-3 rounded-2xl bg-white dark:bg-card border border-primary/15 hover:border-primary/30 transition-all shadow-2xs space-y-2 group/item"
                    >
                      {/* Top Header: Date & Age on Left, Notes / Delete on Right */}
                      <div className="flex items-center justify-between gap-2 border-b border-divider/30 pb-1.5">
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          <div className="w-5 h-5 rounded-md bg-primary-light/60 flex items-center justify-center text-primary shrink-0">
                            <TrendingUp size={11} />
                          </div>
                          <span className="text-xs font-bold text-text-primary whitespace-nowrap">{m.date}</span>
                          {m.ageLabel && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-primary-soft text-primary font-semibold truncate max-w-[130px]">
                              {m.ageLabel}
                            </span>
                          )}
                          {m.sourceAgent && <AgentBadge name={m.sourceAgent} size="xs" />}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {m.imageUrl && (
                            <span className="text-[10px] text-primary bg-primary-soft px-1.5 py-0.2 rounded flex items-center gap-0.5">
                              <Camera size={10} /> 有图
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => handleOpenEditMeasurement(m, e)}
                            disabled={!hasObservedGrowthVersion(m)}
                            aria-label={`编辑 ${m.date} 生长记录`}
                            data-testid={`growth-history-edit-${m.id}`}
                            title={hasObservedGrowthVersion(m) ? "编辑此条记录" : "当前模式暂不支持编辑"}
                            className="p-1 rounded-lg text-text-muted hover:text-primary hover:bg-primary-soft/60 transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleDeleteMeasurement(m.id, m.date, e)}
                            disabled={deletingId === m.id}
                            aria-label={`删除 ${m.date} 生长记录`}
                            title="删除此条记录"
                            className="p-1 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer disabled:opacity-40"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>

                      {/* Metric Values & WHO Percentiles Grid */}
                      <div className={`grid ${
                        ((m.weightKg != null ? 1 : 0) + (m.heightCm != null ? 1 : 0) + (m.headCircumferenceCm != null ? 1 : 0)) === 2
                          ? "grid-cols-2"
                          : ((m.weightKg != null ? 1 : 0) + (m.heightCm != null ? 1 : 0) + (m.headCircumferenceCm != null ? 1 : 0)) === 1
                          ? "grid-cols-1 max-w-[180px]"
                          : "grid-cols-3"
                      } gap-1.5 pt-0.5`}>
                        {/* Weight */}
                        {m.weightKg != null && (
                          <div className="flex flex-col items-center justify-center p-1.5 rounded-xl bg-primary-light/25 border border-primary/15 text-center">
                            <span className="text-[11px] text-text-muted flex items-center gap-0.5 mb-0.5">
                              <span>⚖️</span>
                              <span>体重</span>
                            </span>
                            <span className="text-xs font-black text-text-primary whitespace-nowrap">
                              {m.weightKg} <span className="text-[10px] font-normal text-text-muted">kg</span>
                            </span>
                            {whoMap.weight && (
                              <span className={`mt-1 text-[10px] font-bold px-1.5 py-0.2 rounded border ${whoMap.weight.evaluation.badgeBg} ${whoMap.weight.evaluation.badgeColor}`}>
                                P{whoMap.weight.percentile}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Height */}
                        {m.heightCm != null && (
                          <div className="flex flex-col items-center justify-center p-1.5 rounded-xl bg-primary-light/25 border border-primary/15 text-center">
                            <span className="text-[11px] text-text-muted flex items-center gap-0.5 mb-0.5">
                              <span>📏</span>
                              <span>身长</span>
                            </span>
                            <span className="text-xs font-black text-text-primary whitespace-nowrap">
                              {m.heightCm} <span className="text-[10px] font-normal text-text-muted">cm</span>
                            </span>
                            {whoMap.height && (
                              <span className={`mt-1 text-[10px] font-bold px-1.5 py-0.2 rounded border ${whoMap.height.evaluation.badgeBg} ${whoMap.height.evaluation.badgeColor}`}>
                                P{whoMap.height.percentile}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Head Circumference */}
                        {m.headCircumferenceCm != null && (
                          <div className="flex flex-col items-center justify-center p-1.5 rounded-xl bg-primary-light/25 border border-primary/15 text-center">
                            <span className="text-[11px] text-text-muted flex items-center gap-0.5 mb-0.5">
                              <span>👶</span>
                              <span>头围</span>
                            </span>
                            <span className="text-xs font-black text-text-primary whitespace-nowrap">
                              {m.headCircumferenceCm} <span className="text-[10px] font-normal text-text-muted">cm</span>
                            </span>
                            {whoMap.head && (
                              <span className={`mt-1 text-[10px] font-bold px-1.5 py-0.2 rounded border ${whoMap.head.evaluation.badgeBg} ${whoMap.head.evaluation.badgeColor}`}>
                                P{whoMap.head.percentile}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {measurements.length > 8 && (
                  <button
                    type="button"
                    onClick={() => setShowAllMeasurements((prev) => !prev)}
                    className="w-full py-2.5 mt-2 rounded-xl text-xs font-semibold text-primary bg-primary-light/40 hover:bg-primary-light flex items-center justify-center gap-1 transition-all cursor-pointer btn-press border border-primary/20"
                  >
                    <span>{showAllMeasurements ? "收起部分记录" : `展开更多历史记录 (共 ${measurements.length} 条)`}</span>
                    {showAllMeasurements ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                )}
              </div>
            )}
          </CuteCard>
        </div>
      </div>

      {editingMeasurement && (
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-xs animate-fade-in"
          onClick={() => {
            if (!editingSaving) {
              setEditingMeasurement(null);
              setEditingScope(null);
            }
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="growth-edit-title"
        >
          <div
            className="w-full sm:max-w-md bg-white dark:bg-card text-text-primary rounded-t-[28px] sm:rounded-[28px] max-h-[92dvh] flex flex-col shadow-2xl border border-primary/20 animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-divider/60 shrink-0">
              <div>
                <h2 id="growth-edit-title" className="text-base font-bold text-text-primary">编辑生长记录</h2>
                <p className="text-[11px] text-text-muted mt-0.5">{editingMeasurement.date} · {baby?.nickname || "宝宝"}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingMeasurement(null);
                  setEditingScope(null);
                }}
                disabled={editingSaving}
                autoFocus
                aria-label="关闭生长记录编辑"
                className="w-8 h-8 rounded-full flex items-center justify-center text-text-muted hover:bg-primary-soft/40 btn-press disabled:opacity-40"
              >
                <X size={18} />
              </button>
            </div>
            <div className="px-5 py-4 overflow-y-auto overscroll-contain flex-1 pb-[max(20px,env(safe-area-inset-bottom))]">
              <GrowthForm
                key={`${editingMeasurement.id}:${editingMeasurement.version ?? editingMeasurement.baseVersion ?? ""}`}
                mode="edit"
                initialData={editingMeasurement}
                onSubmit={handleSaveEdit}
                onCancel={() => {
                  setEditingMeasurement(null);
                  setEditingScope(null);
                }}
                saving={editingSaving}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
