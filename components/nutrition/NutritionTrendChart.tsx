"use client";

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from "recharts";
import { CuteCard } from "@/components/ui/CuteCard";
import { TrendingUp } from "lucide-react";
import { nutritionTrendValue, summarizeTrend } from "@/lib/nutrition/trends";
import type { MultiDayNutritionSummary, NutrientIntakeItem } from "@/types/nutrition";

export interface NutritionTrendChartProps {
  summary: MultiDayNutritionSummary;
  metric: string;
  onMetricChange: (metric: string) => void;
  references?: NutrientIntakeItem[];
}
const coreIds = ["vitamin_d", "calcium", "iron", "vitamin_a", "zinc", "dha"];
const format = (value: number | null) => value === null ? "—" : Number(value.toFixed(2)).toLocaleString();

export function NutritionTrendChart({ summary, metric, onMetricChange, references = [] }: NutritionTrendChartProps) {
  const options = [
    { id: "milk", name: "总奶量", unit: "ml" },
    ...Object.entries(summary.averageIntakes).map(([id, item]) => ({ id, name: item.name, unit: item.unit })),
  ];
  const selected = options.find(item => item.id === metric) ?? options[0];
  const activeMetric = selected.id;
  const reference = references.find(item => item.nutrientId === activeMetric);
  const target = summary.averageIntakes[activeMetric]?.targetAmount;
  const chart = summary.dailyTrends.map(day => ({
    ...day, displayDate: day.date.slice(5), value: nutritionTrendValue(day, activeMetric),
    formula: day.hasRecords === false ? null : day.formulaMl,
    breast: day.hasRecords === false ? null : day.breastMl,
  }));
  const stats = summarizeTrend(chart.map(day => day.value));
  const quickOptions = options.filter(item => item.id === "milk" || coreIds.includes(item.id));

  return <CuteCard className="p-4 space-y-4 border border-primary/20">
    <div className="flex flex-wrap items-center gap-1.5">
      <TrendingUp size={16} className="text-primary" />
      <h3 className="text-sm font-bold text-text-primary">{selected.name}趋势</h3>
      <span className="ml-auto text-[10px] text-text-muted">{summary.startDate} 至 {summary.endDate}</span>
    </div>
    <div className="flex flex-wrap gap-1.5" aria-label="营养趋势指标">
      {quickOptions.map(item => <button type="button" key={item.id} aria-pressed={activeMetric === item.id}
        onClick={() => onMetricChange(item.id)}
        className={`px-3 py-2 rounded-xl text-xs font-bold cursor-pointer ${activeMetric === item.id ? "bg-primary text-white" : "bg-primary/5 text-text-secondary"}`}>
        {item.name}
      </button>)}
    </div>
    <label className="flex items-center gap-3 text-xs text-text-secondary">
      全部营养指标
      <select aria-label="选择营养趋势指标" value={activeMetric} onChange={event => onMetricChange(event.target.value)}
        className="flex-1 min-w-0 rounded-xl border border-divider bg-card px-3 py-2 text-text-primary">
        {options.map(item => <option key={item.id} value={item.id}>{item.name} ({item.unit})</option>)}
      </select>
    </label>
    <div className="flex justify-between gap-2 text-xs">
      <span>有记录日均 <strong className="text-text-primary">{format(stats.average)} {selected.unit}</strong></span>
      <span className="text-text-muted">{stats.recordedDays} / {summary.daysCount} 天有数据</span>
    </div>
    {stats.recordedDays === 0 ? <p className="py-8 text-center text-xs text-text-muted">这段时间还没有该指标的记录</p> :
      <div className="h-60 w-full min-w-0" role="img" aria-label={`${selected.name}每日趋势，逐日数据见下方明细`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chart} margin={{ top: 18, right: 12, left: -15, bottom: 0 }} accessibilityLayer>
            <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
            <XAxis dataKey="displayDate" tick={{ fontSize: 10 }} minTickGap={18} />
            <YAxis tick={{ fontSize: 10 }} domain={[0, "auto"]} />
            <Tooltip formatter={value => value == null ? "未记录" : `${format(Number(value))} ${selected.unit}`} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
            {target != null && <ReferenceLine y={target} ifOverflow="extendDomain" stroke="#10b981" strokeDasharray="4 4" label={{ value: `适龄参考 ${target} ${selected.unit}`, fontSize: 10, position: "insideTopRight" }} />}
            {reference?.ul != null && <ReferenceLine y={reference.ul} ifOverflow="extendDomain" stroke="#ef4444" strokeDasharray="4 4" label={{ value: `上限 ${reference.ul} ${selected.unit}`, fontSize: 10, position: "insideTopRight" }} />}
            <Line type="linear" dataKey="value" name={selected.name} stroke="#0284c7" strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
            {activeMetric === "milk" && <Line type="linear" dataKey="formula" name="配方奶" stroke="#38bdf8" strokeDasharray="3 3" dot={false} connectNulls={false} isAnimationActive={false} />}
            {activeMetric === "milk" && <Line type="linear" dataKey="breast" name="母乳（含亲喂估算）" stroke="#f472b6" strokeDasharray="3 3" dot={false} connectNulls={false} isAnimationActive={false} />}
            <Legend wrapperStyle={{ fontSize: 10 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>}
    <p className="text-[10px] leading-relaxed text-text-muted">按已有喂养、辅食与补剂记录计算，亲喂奶量和食物营养含估算。未记录日留空，日均不含未记录日；今天仍在累计，不能直接与完整一天比较。</p>
    <details className="text-xs">
      <summary className="cursor-pointer text-primary py-1">查看逐日明细</summary>
      <div className="max-h-60 overflow-auto mt-2"><table className="w-full text-right">
        <thead><tr><th className="text-left p-2">日期</th><th className="p-2">{selected.name} ({selected.unit})</th></tr></thead>
        <tbody>{[...chart].reverse().map(day => <tr key={day.date} className="border-t border-divider"><td className="text-left p-2">{day.date}</td><td className="p-2">{format(day.value)}</td></tr>)}</tbody>
      </table></div>
    </details>
  </CuteCard>;
}
