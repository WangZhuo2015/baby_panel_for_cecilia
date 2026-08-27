"use client";
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Baby, Sparkles, RefreshCw } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useBabyStore } from '@/stores/useBabyStore';
import { calculateAge } from '@/lib/age';
import { SegmentControl } from '@/components/ui/SegmentControl';
import { CuteCard } from '@/components/ui/CuteCard';
import { QuickAiButton } from '@/components/ui/QuickAiButton';

const GrowthLineChart = dynamic(() => import('@/components/growth/GrowthLineChart'), {
  ssr: false,
  loading: () => (
    <div className="h-[240px] flex items-center justify-center text-xs text-text-muted">
      加载生长曲线图表...
    </div>
  ),
});

type GrowthTab = 'weight' | 'height' | 'head' | 'bmi';

export default function GrowthPage() {
  const router = useRouter();
  const baby = useBabyStore((s) => s.baby);
  const age = baby ? calculateAge(baby.birthDate) : { months: 0, days: 0, label: "0月0天" };
  const measurements = useBabyStore((s) => s.growthMeasurements);
  const fetchGrowthMeasurements = useBabyStore((s) => s.fetchGrowthMeasurements);

  const [activeTab, setActiveTab] = useState<GrowthTab>('weight');
  const [whoPercentiles, setWhoPercentiles] = useState<Record<string, Record<string, number[]>>>({ weight: {}, height: {}, headCircumference: {} });
  const [monthLabels, setMonthLabels] = useState<number[]>([]);

  useEffect(() => {
    fetchGrowthMeasurements();
    fetch('/api/growth/chart')
      .then((res) => res.json())
      .then((data) => {
        if (data.whoPercentiles) setWhoPercentiles(data.whoPercentiles);
        if (data.monthLabels) setMonthLabels(data.monthLabels);
      })
      .catch(() => {});
  }, [fetchGrowthMeasurements]);

  const latest = measurements[0];

  const tabs = [
    { value: 'weight', label: '体重' },
    { value: 'height', label: '身长' },
    { value: 'head', label: '头围' },
    { value: 'bmi', label: 'BMI' },
  ];

  const tabPercentileKey: Record<GrowthTab, string> = {
    weight: 'weight',
    height: 'height',
    head: 'headCircumference',
    bmi: 'bmi',
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
      if (activeTab === 'weight' && babyData.weightKg !== undefined) {
        point.baby = babyData.weightKg;
      } else if (activeTab === 'height' && babyData.heightCm !== undefined) {
        point.baby = babyData.heightCm;
      } else if (activeTab === 'head' && babyData.headCircumferenceCm !== undefined) {
        point.baby = babyData.headCircumferenceCm;
      } else if (activeTab === 'bmi' && babyData.weightKg !== undefined && babyData.heightCm !== undefined) {
        const h = babyData.heightCm / 100;
        point.baby = Number((babyData.weightKg / (h * h)).toFixed(2));
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
  const currentUnit = activeTab === "weight" ? "kg" : activeTab === "height" ? "cm" : activeTab === "head" ? "cm" : "";
  const currentLatestValue = activeTab === "weight"
    ? latest?.weightKg
    : activeTab === "height"
    ? latest?.heightCm
    : activeTab === "head"
    ? latest?.headCircumferenceCm
    : (latest?.weightKg && latest?.heightCm)
    ? Number((latest.weightKg / ((latest.heightCm / 100) ** 2)).toFixed(1))
    : undefined;

  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([
        fetchGrowthMeasurements(true),
        fetch('/api/growth/chart')
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

  return (
    <div className="px-4 pt-safe-12 pb-36 max-w-md mx-auto">
      {/* Baby header */}
      <div className="flex items-center justify-between mb-5">
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
            <p className="text-lg font-bold text-text-primary group-hover:text-primary transition-colors">{baby?.nickname ?? "宝宝"}</p>
            <p className="text-sm text-text-secondary">{age.label} · WHO 0-36月生长曲线</p>
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

      {/* Current stats */}
      <CuteCard className="mb-4 bg-gradient-to-br from-primary-light to-lavender/5">
        <div className="text-center">
          <p className="text-xs text-text-secondary mb-1">最新{currentTabLabel}</p>
          <p className="text-3xl font-bold text-primary">
            {currentLatestValue != null ? `${currentLatestValue} ${currentUnit}` : "--"}
          </p>
          <div className="flex items-center justify-center gap-2 mt-2">
            <span className="px-3 py-1 rounded-full bg-mint/15 text-xs font-medium text-mint">
              {latest?.percentile != null ? `P${latest.percentile}` : "标准曲线对照"}
            </span>
            <span className="text-xs text-text-muted">
              {getPercentileLevelText(latest?.percentile)}
            </span>
          </div>
        </div>
      </CuteCard>

      {/* Tabs */}
      <div className="mb-4">
        <SegmentControl options={tabs} value={activeTab} onChange={(v) => setActiveTab(v as GrowthTab)} />
      </div>

      {/* Chart */}
      <CuteCard className="mb-5">
        <GrowthLineChart data={chartData} />
        <div className="flex items-center justify-center gap-4 mt-2">
          <span className="flex items-center gap-1.5 text-[10px] text-text-muted">
            <span className="w-4 h-0.5 bg-primary rounded" /> 宝宝实测
          </span>
          <span className="flex items-center gap-1.5 text-[10px] text-text-muted">
            <span className="w-4 h-0.5 bg-primary-soft rounded" style={{ borderTop: '1px dashed #FFB5D0' }} /> WHO 百分位
          </span>
        </div>
      </CuteCard>

      {/* Measurement history */}
      <h3 className="text-sm font-semibold text-text-secondary mb-3 px-1">测量历史记录</h3>
      <CuteCard className="mb-5">
        {measurements.length === 0 ? (
          <p className="text-xs text-text-muted text-center py-4">暂无生长测量记录，点击下方按钮添加</p>
        ) : (
          <div className="space-y-3">
            {measurements.slice(0, 8).map((m) => (
              <div key={m.id} className="flex items-center justify-between py-1.5 border-b border-primary-soft/30 last:border-0">
                <div>
                  <p className="text-xs text-text-muted">{m.date}</p>
                  <p className="text-sm font-medium text-text-primary">{m.ageLabel}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-primary">
                    {m.weightKg != null ? `${m.weightKg}kg` : ''}
                    {m.heightCm != null ? ` · ${m.heightCm}cm` : ''}
                    {m.headCircumferenceCm != null ? ` · 头围${m.headCircumferenceCm}cm` : ''}
                  </p>
                  {m.percentile != null && (
                    <p className="text-xs text-text-muted">P{m.percentile}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CuteCard>

      {/* Add button */}
      <button
        onClick={() => router.push('/growth/add')}
        className="w-full flex items-center justify-center gap-2 py-3.5 rounded-[20px] bg-primary text-white font-medium shadow-button btn-press mb-5 whitespace-nowrap text-sm"
      >
        <Plus size={18} />
        添加生长记录（支持拍照识别）
      </button>

      {/* Reference note */}
      <CuteCard className="bg-gradient-to-br from-primary-light to-lavender/5 border border-lavender/20">
        <div className="flex gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-lavender/15 flex items-center justify-center">
            <Sparkles size={18} className="text-primary" />
          </div>
          <div className="flex-1">
            <p className="text-xs text-text-primary leading-relaxed font-medium">
              WHO 儿童生长标准说明
            </p>
            <p className="text-[11px] text-text-secondary mt-1 leading-normal">
              图表基于世界卫生组织 (WHO) 0-36 个月儿童生长标准曲线对照。P3-P97 均属正常发育区间，重点在于生长曲线趋势平稳增长。
            </p>
          </div>
        </div>
      </CuteCard>
    </div>
  );
}
