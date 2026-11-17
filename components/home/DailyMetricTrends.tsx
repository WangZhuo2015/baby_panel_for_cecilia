"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { RefreshCw, TrendingUp } from "lucide-react";
import { useNutritionScopeKey, useScopedNutritionRequest } from "@/lib/hooks/useScopedNutritionRequest";
import { NutritionScopeChanged } from "@/lib/nutrition/scoped-request";

export type HomeMetricKey = "milk" | "sleep" | "diaper" | "food";
type TrendPeriod = 7 | 30;

interface DailyTrendDay {
  date: string;
  recordedMilkMl: number | null;
  feedingCount: number;
  breastMinutes: number;
  sleepMinutes: number | null;
  diaperCount: number;
  foodCount: number;
  hasRecords: boolean;
}

interface DailyTrendResponse {
  babyId: string;
  timeZone: string;
  startDate: string;
  endDate: string;
  today: string;
  days: DailyTrendDay[];
}

interface DailyMetricTrendsProps {
  babyId?: string;
  metric: HomeMetricKey;
  onMetricChange: (metric: HomeMetricKey) => void;
}

const METRICS: Array<{
  key: HomeMetricKey;
  label: string;
  color: string;
  activeStyle: string;
}> = [
  { key: "milk", label: "记录奶量", color: "#0284C7", activeStyle: "bg-sky-50 text-sky-700" },
  { key: "sleep", label: "睡眠", color: "#8B5CF6", activeStyle: "bg-violet-50 text-violet-700" },
  { key: "diaper", label: "尿布", color: "#059669", activeStyle: "bg-emerald-50 text-emerald-700" },
  { key: "food", label: "辅食", color: "#EA580C", activeStyle: "bg-orange-50 text-orange-700" },
];

function isTrendResponse(value: unknown): value is DailyTrendResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<DailyTrendResponse>;
  return typeof response.babyId === "string" &&
    typeof response.timeZone === "string" &&
    typeof response.startDate === "string" &&
    typeof response.endDate === "string" &&
    typeof response.today === "string" &&
    Array.isArray(response.days) &&
    response.days.every((day) => day && typeof day.date === "string" &&
      (day.recordedMilkMl === null || typeof day.recordedMilkMl === "number") &&
      (day.sleepMinutes === null || typeof day.sleepMinutes === "number") &&
      typeof day.diaperCount === "number" &&
      typeof day.foodCount === "number");
}

function valueForMetric(day: DailyTrendDay, metric: HomeMetricKey): number | null {
  switch (metric) {
    case "milk":
      return day.recordedMilkMl;
    case "sleep":
      return day.sleepMinutes === null ? null : day.sleepMinutes / 60;
    case "diaper":
      return day.diaperCount > 0 ? day.diaperCount : null;
    case "food":
      return day.foodCount > 0 ? day.foodCount : null;
  }
}

function formatSleepMinutes(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return hours > 0 ? `${hours}小时${remainder}分` : `${remainder}分钟`;
}

function formatValue(metric: HomeMetricKey, value: number): string {
  if (metric === "sleep") return formatSleepMinutes(value * 60);
  const formatted = value.toLocaleString("zh-CN", { maximumFractionDigits: 1 });
  if (metric === "milk") return `${formatted} ml`;
  return `${formatted}${metric === "diaper" ? " 次" : " 顿"}`;
}

function formatFullDate(date: string): string {
  const [year, month, day] = date.split("-");
  if (!year || !month || !day) return date;
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function MetricTrendsContent({ babyId, metric, onMetricChange }: DailyMetricTrendsProps) {
  const scopedRequest = useScopedNutritionRequest(babyId);
  const [period, setPeriod] = useState<TrendPeriod>(7);
  const [retryVersion, setRetryVersion] = useState(0);
  const [trends, setTrends] = useState<DailyTrendResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    setTrends(null);

    const load = async () => {
      try {
        if (!babyId) throw new Error("请先选择宝宝，再查看趋势。");
        const response = await scopedRequest(
          `/api/records/trends?babyId=${encodeURIComponent(babyId)}&days=${period}`,
          { signal: controller.signal },
        );
        const payload: unknown = await response.json();
        if (controller.signal.aborted || version !== requestVersion.current) return;
        if (!isTrendResponse(payload) || payload.babyId !== babyId || payload.days.length !== period) {
          throw new Error("趋势数据暂时无法识别，请重试。");
        }
        setTrends(payload);
      } catch (requestError) {
        if (controller.signal.aborted || version !== requestVersion.current || requestError instanceof NutritionScopeChanged) return;
        setError(requestError instanceof Error ? requestError.message : "趋势数据暂时无法读取，请重试。");
      } finally {
        if (!controller.signal.aborted && version === requestVersion.current) setLoading(false);
      }
    };

    void load();
    return () => {
      controller.abort();
      if (requestVersion.current === version) requestVersion.current += 1;
    };
  }, [babyId, period, retryVersion, scopedRequest]);

  const selectedMetric = METRICS.find((item) => item.key === metric) ?? METRICS[0];
  const chartData = useMemo(() => {
    if (!trends) return [];
    return [...trends.days]
      .sort((left, right) => left.date.localeCompare(right.date))
      .map((day) => ({ ...day, value: valueForMetric(day, metric) }));
  }, [metric, trends]);
  const values = chartData.flatMap((day) => day.value === null ? [] : [day.value]);
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

  return (
    <section
      id="home-daily-trends"
      aria-labelledby="home-daily-trends-title"
      className="mt-3 rounded-2xl border border-primary/15 bg-card p-3 shadow-card sm:p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 id="home-daily-trends-title" className="flex items-center gap-1.5 text-sm font-bold text-text-primary">
            <TrendingUp size={16} className="shrink-0 text-primary" />
            近 {period} 天{selectedMetric.label}趋势
          </h4>
          {trends && (
            <p className="mt-1 text-[11px] text-text-muted">
              {formatFullDate(trends.startDate)} 至 {formatFullDate(trends.endDate)}
            </p>
          )}
        </div>
        <div role="group" aria-label="趋势时间范围" className="flex shrink-0 rounded-xl bg-gray-100/80 p-0.5">
          {([7, 30] as const).map((days) => (
            <button
              key={days}
              type="button"
              aria-pressed={period === days}
              onClick={() => setPeriod(days)}
              className={`min-h-8 rounded-lg px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${period === days ? "bg-white text-primary shadow-xs" : "text-text-secondary hover:text-text-primary"}`}
            >
              近 {days} 天
            </button>
          ))}
        </div>
      </div>

      <button type="button" onClick={() => setRetryVersion(version => version + 1)} disabled={loading}
        className="mt-2 inline-flex items-center gap-1 py-1 text-xs text-primary cursor-pointer disabled:opacity-50">
        <RefreshCw size={12} />刷新趋势
      </button>

      <div role="group" aria-label="趋势指标" className="mt-3 grid grid-cols-4 gap-1 rounded-xl bg-gray-100/80 p-1">
        {METRICS.map((item) => (
          <button
            key={item.key}
            type="button"
            aria-pressed={metric === item.key}
            onClick={() => onMetricChange(item.key)}
            className={`min-h-9 rounded-lg px-1 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:text-xs ${metric === item.key ? `${item.activeStyle} shadow-xs` : "text-text-secondary hover:text-text-primary"}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div role="status" aria-live="polite" className="flex h-44 items-center justify-center gap-2 text-xs text-text-muted">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          正在读取趋势…
        </div>
      ) : error ? (
        <div role="alert" className="my-3 flex min-h-32 flex-col items-center justify-center gap-2 rounded-xl bg-red-50/70 px-4 text-center">
          <p className="text-xs text-red-700">{error}</p>
          <button
            type="button"
            onClick={() => setRetryVersion((version) => version + 1)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-bold text-red-700 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            <RefreshCw size={13} />
            重试
          </button>
        </div>
      ) : trends && average !== null ? (
        <>
          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="text-xs font-bold text-text-primary">日均 {formatValue(metric, average)}</p>
            <p className="text-[10px] text-text-muted">按 {values.length} 个有记录日期计算</p>
          </div>
          <div className="-mx-2 mt-2 h-52 min-w-0 sm:mx-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartData}
                accessibilityLayer
                aria-label={`近 ${period} 天${selectedMetric.label}趋势折线图`}
                margin={{ top: 8, right: 12, left: -16, bottom: 0 }}
              >
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(date: string) => date.slice(5)}
                  tick={{ fontSize: 10, fill: "#737373" }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={16}
                />
                <YAxis
                  domain={[0, "auto"]}
                  allowDecimals={metric === "milk" || metric === "sleep"}
                  tickFormatter={(value: number) => metric === "sleep" ? `${value}h` : String(value)}
                  tick={{ fontSize: 10, fill: "#737373" }}
                  axisLine={false}
                  tickLine={false}
                  width={42}
                />
                <Tooltip
                  labelFormatter={(date) => formatFullDate(String(date))}
                  formatter={(value) => formatValue(metric, Number(value))}
                  contentStyle={{
                    background: "white",
                    border: "1px solid #E5E7EB",
                    borderRadius: "12px",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                    fontSize: "12px",
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  name={selectedMetric.label}
                  stroke={selectedMetric.color}
                  strokeWidth={2.5}
                  dot={{ fill: selectedMetric.color, r: 3 }}
                  activeDot={{ r: 5 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-text-muted">
            折线断开表示当天没有该项记录；日均只计算有记录日期，不把未记录日按 0 计入。记录奶量只合计有毫升数值的喂奶，亲喂不折算。
          </p>
        </>
      ) : (
        <div className="my-3 flex min-h-40 flex-col items-center justify-center rounded-xl bg-gray-50 px-4 text-center">
          <p className="text-sm font-semibold text-text-secondary">这段时间还没有{selectedMetric.label}记录</p>
          <p className="mt-1 max-w-sm text-xs leading-relaxed text-text-muted">
            图表会在出现对应记录后显示；尿布和辅食的未记录日期会留空，不会当作 0 次或 0 顿。
          </p>
        </div>
      )}
    </section>
  );
}

export default function DailyMetricTrends(props: DailyMetricTrendsProps) {
  const scopeKey = useNutritionScopeKey(props.babyId);
  return <MetricTrendsContent key={scopeKey} {...props} />;
}
