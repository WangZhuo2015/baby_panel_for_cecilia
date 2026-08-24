"use client";

import React from "react";
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
  data: Record<string, number | string>[];
}

export default function GrowthLineChart({ data }: GrowthLineChartProps) {
  return (
    <div className="h-[240px] -mx-2">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#FFD9E6" opacity={0.5} />
          <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#B6A0A5" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: "#B6A0A5" }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{
              background: "white",
              border: "1px solid #FFD9E6",
              borderRadius: "16px",
              boxShadow: "0 4px 16px rgba(180, 100, 125, 0.1)",
              fontSize: "12px",
            }}
          />
          {/* WHO Percentile reference lines */}
          <Line type="monotone" dataKey="P97" stroke="#FFD9E6" strokeWidth={1} dot={false} strokeDasharray="4 4" name="P97" />
          <Line type="monotone" dataKey="P85" stroke="#FFD9E6" strokeWidth={1} dot={false} strokeDasharray="4 4" name="P85" />
          <Line type="monotone" dataKey="P50" stroke="#FFB5D0" strokeWidth={1.5} dot={false} strokeDasharray="4 4" name="P50 (中位线)" />
          <Line type="monotone" dataKey="P15" stroke="#FFD9E6" strokeWidth={1} dot={false} strokeDasharray="4 4" name="P15" />
          <Line type="monotone" dataKey="P3" stroke="#FFD9E6" strokeWidth={1} dot={false} strokeDasharray="4 4" name="P3" />
          {/* Baby's real data line */}
          <Line type="monotone" dataKey="baby" stroke="#FF6F9F" strokeWidth={2.5} dot={{ fill: "#FF6F9F", r: 4 }} name="宝宝实测" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
