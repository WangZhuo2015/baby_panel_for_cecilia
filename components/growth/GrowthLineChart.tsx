"use client";

import React, { useState, useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface GrowthLineChartProps {
  data: Record<string, any>[];
  unit?: string;
  defaultRange?: "12" | "24" | "36";
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: Record<string, any>;
    value: number | string;
    dataKey: string;
  }>;
  label?: string;
  unit?: string;
}

function CustomGrowthTooltip({ active, payload, label, unit }: CustomTooltipProps) {
  if (!active || !payload || !payload.length) return null;

  const dataPoint = payload[0]?.payload || {};
  const babyVal = dataPoint.baby;
  const p50Val = dataPoint.P50;
  const p97Val = dataPoint.P97;
  const p3Val = dataPoint.P3;
  const dateStr = dataPoint.date;
  const ageLabel = dataPoint.ageLabel;

  const diff =
    babyVal != null && p50Val != null ? Number(babyVal) - Number(p50Val) : null;

  return (
    <div className="bg-white/95 dark:bg-card/95 backdrop-blur-md px-3.5 py-3 rounded-2xl border border-primary/25 shadow-xl text-xs space-y-2 min-w-[190px] pointer-events-none transition-all animate-in fade-in zoom-in-95 duration-150">
      <div className="flex items-center justify-between border-b border-primary/10 pb-1.5 gap-2">
        <span className="font-bold text-text-primary text-xs flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-primary" />
          <span>{label}</span>
          {ageLabel && (
            <span className="text-[10px] text-text-muted font-normal">
              ({ageLabel})
            </span>
          )}
        </span>
        {dateStr && <span className="text-[10px] text-text-muted">{dateStr}</span>}
      </div>

      {babyVal !== undefined && babyVal !== null ? (
        <div className="bg-primary-light/50 dark:bg-primary-dark/20 p-2 rounded-xl border border-primary/20 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-text-secondary font-semibold">
            <span className="w-2 h-2 rounded-full bg-primary ring-2 ring-primary/30" />
            宝宝实测:
          </span>
          <span className="font-black text-primary text-sm tracking-tight">
            {babyVal}{" "}
            <span className="text-xs font-normal text-text-secondary">{unit}</span>
          </span>
        </div>
      ) : (
        <div className="text-[11px] text-text-muted italic py-0.5 text-center">
          本月龄暂无实测记录
        </div>
      )}

      {p50Val !== undefined && (
        <div className="flex items-center justify-between text-[11px] text-text-secondary px-1">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-1 rounded-full bg-rose-400" />
            WHO 中位线 (P50):
          </span>
          <span className="font-bold text-text-primary">
            {p50Val} {unit}
          </span>
        </div>
      )}

      {p3Val !== undefined && p97Val !== undefined && (
        <div className="flex items-center justify-between text-[10px] text-text-muted px-1">
          <span>WHO 正常区间:</span>
          <span className="font-medium text-text-secondary">
            {p3Val} ~ {p97Val} {unit}
          </span>
        </div>
      )}

      {diff !== null && (
        <div className="pt-1.5 border-t border-primary/10 text-[10px] flex items-center justify-between px-1">
          <span className="text-text-muted">与标准中位对比:</span>
          <span
            className={`font-bold ${
              diff >= 0 ? "text-mint" : "text-amber-500"
            }`}
          >
            {diff >= 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)} {unit}
          </span>
        </div>
      )}
    </div>
  );
}

export default function GrowthLineChart({
  data,
  unit = "",
  defaultRange = "12",
}: GrowthLineChartProps) {
  const [range, setRange] = useState<"12" | "24" | "36">(defaultRange);
  const [showWhoStandards, setShowWhoStandards] = useState(true);

  // Filter chart data by range
  const filteredData = useMemo(() => {
    const maxMonth = range === "12" ? 12 : range === "24" ? 24 : 36;
    const sliced = data.slice(0, maxMonth + 1);

    // Identify the latest baby measurement point index
    let lastBabyIndex = -1;
    for (let i = sliced.length - 1; i >= 0; i--) {
      if ((sliced[i] as Record<string, any>).baby != null) {
        lastBabyIndex = i;
        break;
      }
    }

    return sliced.map((item, idx) => ({
      ...item,
      isLatestPoint: idx === lastBabyIndex,
    })) as Array<Record<string, any> & { isLatestPoint: boolean }>;
  }, [data, range]);

  // Count how many baby measurements exist in current view
  const recordedCount = useMemo(() => {
    return filteredData.filter((d) => d.baby != null).length;
  }, [filteredData]);

  // Custom baby dot renderer
  const renderBabyDot = (dotProps: any) => {
    const { cx, cy, payload, index } = dotProps;
    if (cx == null || cy == null || payload?.baby == null) return null;

    const isLatest = payload.isLatestPoint;

    return (
      <g key={`baby-dot-${index}`}>
        {isLatest && (
          <circle
            cx={cx}
            cy={cy}
            r={10}
            fill="#FF3366"
            opacity={0.25}
          />
        )}
        <circle
          cx={cx}
          cy={cy}
          r={isLatest ? 5.5 : 4.5}
          fill="#FF3366"
          stroke="#FFFFFF"
          strokeWidth={2.5}
          className="drop-shadow-sm"
        />
      </g>
    );
  };

  return (
    <div className="space-y-3">
      {/* Chart Top Controls & Range Selector */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowWhoStandards(!showWhoStandards)}
            className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition-all cursor-pointer ${
              showWhoStandards
                ? "bg-primary-light border-primary/30 text-primary font-bold"
                : "bg-gray-50 border-gray-200 text-text-muted"
            }`}
          >
            {showWhoStandards ? "✓ WHO 标准线开启" : "+ 显示 WHO 标准线"}
          </button>
          {recordedCount > 0 && (
            <span className="text-[10px] text-text-muted hidden sm:inline">
              已绘制 {recordedCount} 次实测点
            </span>
          )}
        </div>

        {/* Range Buttons */}
        <div className="flex bg-gray-100 dark:bg-card p-0.5 rounded-xl border border-primary/10">
          {(
            [
              { value: "12", label: "0-1岁" },
              { value: "24", label: "0-2岁" },
              { value: "36", label: "全量3岁" },
            ] as const
          ).map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setRange(item.value)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition-all cursor-pointer ${
                range === item.value
                  ? "bg-white dark:bg-primary dark:text-white text-primary font-bold shadow-xs"
                  : "text-text-muted hover:text-text-primary"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* SVG Chart Container */}
      <div className="h-[270px] sm:h-[320px] lg:h-[360px] -mx-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={filteredData}
            margin={{ top: 12, right: 14, left: -18, bottom: 2 }}
          >
            <CartesianGrid
              strokeDasharray="4 4"
              stroke="#FCE7F3"
              vertical={false}
              opacity={0.7}
            />
            <XAxis
              dataKey="month"
              tick={{ fontSize: 10, fill: "#9CA3AF" }}
              axisLine={{ stroke: "#F3E8EE" }}
              tickLine={false}
              interval={range === "12" ? 1 : range === "24" ? 2 : 3}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#9CA3AF" }}
              axisLine={false}
              tickLine={false}
              domain={["auto", "auto"]}
              tickFormatter={(v) => `${v}`}
            />
            <Tooltip
              content={<CustomGrowthTooltip unit={unit} />}
              cursor={{
                stroke: "#FF6F9F",
                strokeWidth: 1.2,
                strokeDasharray: "3 3",
              }}
            />

            {/* WHO Percentile Reference Curves */}
            {showWhoStandards && (
              <>
                <Line
                  type="monotone"
                  dataKey="P97"
                  stroke="#F472B6"
                  strokeWidth={1}
                  dot={false}
                  strokeDasharray="4 4"
                  name="P97 (高位)"
                  isAnimationActive={false}
                  opacity={0.65}
                />
                <Line
                  type="monotone"
                  dataKey="P85"
                  stroke="#FBCFE8"
                  strokeWidth={1}
                  dot={false}
                  strokeDasharray="3 3"
                  name="P85"
                  isAnimationActive={false}
                  opacity={0.5}
                />
                <Line
                  type="monotone"
                  dataKey="P50"
                  stroke="#F43F5E"
                  strokeWidth={1.8}
                  dot={false}
                  strokeDasharray="5 3"
                  name="P50 (中位线)"
                  isAnimationActive={false}
                  opacity={0.75}
                />
                <Line
                  type="monotone"
                  dataKey="P15"
                  stroke="#FBCFE8"
                  strokeWidth={1}
                  dot={false}
                  strokeDasharray="3 3"
                  name="P15"
                  isAnimationActive={false}
                  opacity={0.5}
                />
                <Line
                  type="monotone"
                  dataKey="P3"
                  stroke="#F472B6"
                  strokeWidth={1}
                  dot={false}
                  strokeDasharray="4 4"
                  name="P3 (低位)"
                  isAnimationActive={false}
                  opacity={0.65}
                />
              </>
            )}

            {/* Baby's Real Measurement Line */}
            <Line
              type="monotone"
              dataKey="baby"
              stroke="#FF3366"
              strokeWidth={3.2}
              connectNulls={true}
              dot={renderBabyDot}
              activeDot={{
                r: 7,
                fill: "#FF1744",
                stroke: "#FFFFFF",
                strokeWidth: 3,
              }}
              name="宝宝实测"
              isAnimationActive={true}
              animationDuration={250}
              animationEasing="ease-out"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Chart Legend & Explanation */}
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 pt-2 border-t border-primary/10 text-[11px]">
        <div className="flex items-center gap-1.5 text-text-primary font-bold">
          <span className="w-3 h-3 rounded-full bg-[#FF3366] border-2 border-white shadow-xs inline-block" />
          <span>宝宝实测曲线</span>
        </div>
        {showWhoStandards && (
          <>
            <div className="flex items-center gap-1.5 text-rose-600 font-medium">
              <span
                className="w-4 h-0.5 bg-rose-500 inline-block"
                style={{ borderTop: "2px dashed #F43F5E" }}
              />
              <span>WHO P50 中位线</span>
            </div>
            <div className="flex items-center gap-1.5 text-text-muted">
              <span
                className="w-4 h-0.5 bg-pink-300 inline-block"
                style={{ borderTop: "1px dashed #F472B6" }}
              />
              <span>P3 ~ P97 正常区间</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
