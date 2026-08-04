"use client";
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Baby } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useBabyStore } from '@/stores/useBabyStore';
import { calculateAge } from '@/lib/age';
import { SegmentControl } from '@/components/ui/SegmentControl';
import { CuteCard } from '@/components/ui/CuteCard';

type GrowthTab = 'weight' | 'height' | 'head' | 'bmi';

export default function GrowthPage() {
  const router = useRouter();
  const baby = useBabyStore((s) => s.baby);
  const age = baby ? calculateAge(baby.birthDate) : { months: 0, days: 0, label: "0月0天" };
  const measurements = useBabyStore((s) => s.growthMeasurements);
  const fetchGrowthMeasurements = useBabyStore((s) => s.fetchGrowthMeasurements);

  const [activeTab, setActiveTab] = useState<GrowthTab>('weight');
  const [whoPercentiles, setWhoPercentiles] = useState<Record<string, Record<string, number[]>>>({ weight: {} });
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

  const latest = measurements[measurements.length - 1];

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
    const babyData = measurements.find((m) => Math.abs(m.ageInMonths - month) < 0.6);
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

  return (
    <div className="px-4 pt-12 pb-4">
      {/* Baby header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-soft to-primary/30 flex items-center justify-center shadow-soft">
          <Baby size={24} className="text-primary" />
        </div>
        <div>
          <p className="text-lg font-bold text-text-primary">{baby?.nickname ?? ""}</p>
          <p className="text-sm text-text-secondary">{age.label}</p>
        </div>
      </div>

      {/* Current stats */}
      <CuteCard className="mb-4 bg-gradient-to-br from-primary-light to-lavender/5">
        <div className="text-center">
          <p className="text-xs text-text-secondary mb-1">当前体重</p>
          <p className="text-3xl font-bold text-primary">{latest?.weightKg ?? '--'} kg</p>
          <div className="flex items-center justify-center gap-2 mt-2">
            <span className="px-3 py-1 rounded-full bg-mint/15 text-xs font-medium text-mint">
              P{latest?.percentile ?? '--'}
            </span>
            <span className="text-xs text-text-muted">中等水平</span>
          </div>
        </div>
      </CuteCard>

      {/* Tabs */}
      <div className="mb-4">
        <SegmentControl options={tabs} value={activeTab} onChange={(v) => setActiveTab(v as GrowthTab)} />
      </div>

      {/* Chart */}
      <CuteCard className="mb-5">
        <div className="h-[240px] -mx-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#FFD9E6" opacity={0.5} />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#B6A0A5' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#B6A0A5' }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  background: 'white',
                  border: '1px solid #FFD9E6',
                  borderRadius: '16px',
                  boxShadow: '0 4px 16px rgba(180, 100, 125, 0.1)',
                  fontSize: '12px',
                }}
              />
              {/* Percentile lines */}
              <Line type="monotone" dataKey="P97" stroke="#FFD9E6" strokeWidth={1} dot={false} strokeDasharray="4 4" />
              <Line type="monotone" dataKey="P85" stroke="#FFD9E6" strokeWidth={1} dot={false} strokeDasharray="4 4" />
              <Line type="monotone" dataKey="P50" stroke="#FFB5D0" strokeWidth={1} dot={false} strokeDasharray="4 4" />
              <Line type="monotone" dataKey="P15" stroke="#FFD9E6" strokeWidth={1} dot={false} strokeDasharray="4 4" />
              <Line type="monotone" dataKey="P3" stroke="#FFD9E6" strokeWidth={1} dot={false} strokeDasharray="4 4" />
              {/* Baby's data */}
              <Line type="monotone" dataKey="baby" stroke="#FF6F9F" strokeWidth={2.5} dot={{ fill: '#FF6F9F', r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center justify-center gap-4 mt-2">
          <span className="flex items-center gap-1.5 text-[10px] text-text-muted">
            <span className="w-4 h-0.5 bg-primary rounded" /> 宝宝
          </span>
          <span className="flex items-center gap-1.5 text-[10px] text-text-muted">
            <span className="w-4 h-0.5 bg-primary-soft rounded" style={{ borderTop: '1px dashed #FFB5D0' }} /> 百分位
          </span>
        </div>
      </CuteCard>

      {/* Measurement history */}
      <h3 className="text-sm font-semibold text-text-secondary mb-3 px-1">体重测量记录</h3>
      <CuteCard className="mb-5">
        <div className="space-y-3">
          {[...measurements].reverse().slice(0, 5).map((m) => (
            <div key={m.id} className="flex items-center justify-between py-1.5 border-b border-primary-soft/30 last:border-0">
              <div>
                <p className="text-xs text-text-muted">{m.date}</p>
                <p className="text-sm font-medium text-text-primary">{m.ageLabel}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-primary">{m.weightKg} kg</p>
                <p className="text-xs text-text-muted">P{m.percentile}</p>
              </div>
            </div>
          ))}
        </div>
      </CuteCard>

      {/* Add button */}
      <button
        onClick={() => router.push('/growth/add')}
        className="w-full flex items-center justify-center gap-2 py-3.5 rounded-[20px] bg-primary text-white font-medium shadow-button btn-press mb-5"
      >
        <Plus size={18} />
        记录体重
      </button>

      {/* AI card */}
      <CuteCard className="bg-gradient-to-br from-primary-light to-lavender/5 border border-lavender/20">
        <div className="flex gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-lavender/15 flex items-center justify-center">
            <span className="text-xl">🤖</span>
          </div>
          <div className="flex-1">
            <p className="text-sm text-text-primary leading-relaxed">
              小糖果的体重增长趋势整体稳定，目前处于中等水平。
            </p>
          </div>
        </div>
        <p className="text-[10px] text-text-muted mt-2">AI 建议仅供参考，如有疑问请咨询专业医生。</p>
      </CuteCard>
    </div>
  );
}
