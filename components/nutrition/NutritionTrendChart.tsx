"use client";

import { useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import { CuteCard } from "@/components/ui/CuteCard";
import { TrendingUp, Droplets, Sparkles } from "lucide-react";
import type { MultiDayTrendItem } from "@/types/nutrition";

export interface NutritionTrendChartProps {
  trends: MultiDayTrendItem[];
  daysCount?: number;
  className?: string;
}

export function NutritionTrendChart({ trends, daysCount = 7, className = "" }: NutritionTrendChartProps) {
  const [metric, setMetric] = useState<"milk" | "vitaminD" | "calcium" | "iron">("vitaminD");

  if (!trends || trends.length === 0) {
    return (
      <CuteCard className={`p-4 text-center text-text-muted text-xs ${className}`}>
        暂无多日趋势数据
      </CuteCard>
    );
  }

  // 格式化 X 轴日期 (MM-DD)
  const chartData = trends.map((t) => ({
    ...t,
    displayDate: t.date.slice(5),
  }));

  return (
    <CuteCard className={`p-4 space-y-3 bg-white border border-primary/20 shadow-2xs ${className}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <TrendingUp size={16} className="text-primary" />
          <h3 className="text-xs font-bold text-text-primary">
            近 {daysCount} 天摄入趋势与基准线
          </h3>
        </div>
        <span className="text-[10px] text-text-muted">历史追踪</span>
      </div>

      {/* 指标切换 */}
      <div className="flex gap-1.5 bg-gray-100/80 p-1 rounded-2xl">
        <button
          type="button"
          onClick={() => setMetric("vitaminD")}
          className={`flex-1 py-1.5 text-xs font-bold rounded-xl transition-all ${
            metric === "vitaminD" ? "bg-white text-primary shadow-xs" : "text-text-secondary"
          }`}
        >
          维生素D (IU)
        </button>
        <button
          type="button"
          onClick={() => setMetric("milk")}
          className={`flex-1 py-1.5 text-xs font-bold rounded-xl transition-all ${
            metric === "milk" ? "bg-white text-sky-600 shadow-xs" : "text-text-secondary"
          }`}
        >
          奶量 (ml)
        </button>
        <button
          type="button"
          onClick={() => setMetric("calcium")}
          className={`flex-1 py-1.5 text-xs font-bold rounded-xl transition-all ${
            metric === "calcium" ? "bg-white text-emerald-600 shadow-xs" : "text-text-secondary"
          }`}
        >
          钙 (mg)
        </button>
        <button
          type="button"
          onClick={() => setMetric("iron")}
          className={`flex-1 py-1.5 text-xs font-bold rounded-xl transition-all ${
            metric === "iron" ? "bg-white text-amber-600 shadow-xs" : "text-text-secondary"
          }`}
        >
          铁 (mg)
        </button>
      </div>

      {/* 图表展示 */}
      <div className="h-[220px] -mx-2 pt-2">
        <ResponsiveContainer width="100%" height="100%">
          {metric === "vitaminD" ? (
            <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" />
              <XAxis dataKey="displayDate" tick={{ fontSize: 10, fill: "#999" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#999" }} axisLine={false} tickLine={false} domain={[0, "auto"]} />
              <Tooltip
                contentStyle={{
                  background: "white",
                  border: "1px solid #FFE0EB",
                  borderRadius: "16px",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
                  fontSize: "12px",
                }}
              />
              <ReferenceLine y={400} stroke="#10B981" strokeDasharray="4 4" label={{ value: "目标 400 IU", fill: "#10B981", fontSize: 10, position: "insideTopRight" }} />
              <ReferenceLine y={800} stroke="#EF4444" strokeDasharray="4 4" label={{ value: "上限 800 IU", fill: "#EF4444", fontSize: 10, position: "insideTopRight" }} />
              <Line type="monotone" dataKey="vitaminD" stroke="#FF6F9F" strokeWidth={2.5} dot={{ fill: "#FF6F9F", r: 4 }} name="实测维生素D (IU)" />
            </LineChart>
          ) : metric === "milk" ? (
            <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" />
              <XAxis dataKey="displayDate" tick={{ fontSize: 10, fill: "#999" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#999" }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  background: "white",
                  border: "1px solid #E0F2FE",
                  borderRadius: "16px",
                  fontSize: "12px",
                }}
              />
              <Line type="monotone" dataKey="totalFeedingMl" stroke="#0284C7" strokeWidth={2.5} dot={{ fill: "#0284C7", r: 4 }} name="总奶量 (ml)" />
              <Line type="monotone" dataKey="formulaMl" stroke="#38BDF8" strokeWidth={1.5} dot={false} strokeDasharray="3 3" name="配方奶 (ml)" />
              <Line type="monotone" dataKey="breastMl" stroke="#F472B6" strokeWidth={1.5} dot={false} strokeDasharray="3 3" name="母乳 (ml)" />
              <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
            </LineChart>
          ) : metric === "calcium" ? (
            <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" />
              <XAxis dataKey="displayDate" tick={{ fontSize: 10, fill: "#999" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#999" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: "white", borderRadius: "16px", fontSize: "12px" }} />
              <ReferenceLine y={250} stroke="#10B981" strokeDasharray="4 4" label={{ value: "参考 250mg", fill: "#10B981", fontSize: 10 }} />
              <Line type="monotone" dataKey="calcium" stroke="#10B981" strokeWidth={2.5} dot={{ fill: "#10B981", r: 4 }} name="钙摄入 (mg)" />
            </LineChart>
          ) : (
            <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" />
              <XAxis dataKey="displayDate" tick={{ fontSize: 10, fill: "#999" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#999" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: "white", borderRadius: "16px", fontSize: "12px" }} />
              <ReferenceLine y={10} stroke="#F59E0B" strokeDasharray="4 4" label={{ value: "参考 10mg", fill: "#F59E0B", fontSize: 10 }} />
              <Line type="monotone" dataKey="iron" stroke="#F59E0B" strokeWidth={2.5} dot={{ fill: "#F59E0B", r: 4 }} name="铁摄入 (mg)" />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </CuteCard>
  );
}
