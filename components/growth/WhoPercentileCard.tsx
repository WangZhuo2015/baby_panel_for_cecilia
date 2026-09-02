import React from "react";
import {
  WhoMetricResult,
  getWhoMetricsForBaby,
  extractReportGrowthMetrics,
} from "@/lib/who-growth-standards";
import { TrendingUp, ShieldCheck } from "lucide-react";

interface WhoPercentileChipsProps {
  metrics: WhoMetricResult[];
  className?: string;
  showValue?: boolean;
}

export function WhoPercentileChips({
  metrics,
  className = "",
  showValue = true,
}: WhoPercentileChipsProps) {
  if (!metrics || metrics.length === 0) return null;

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {metrics.map((m) => (
        <span
          key={m.key}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold border ${m.evaluation.badgeBg} ${m.evaluation.badgeColor} shadow-2xs whitespace-nowrap shrink-0`}
          title={`${m.name} ${m.value}${m.unit} · WHO P${m.percentile} (${m.evaluation.label})`}
        >
          <span>{m.icon}</span>
          <span>{m.name}</span>
          {showValue && <span className="font-bold">{m.value}{m.unit}</span>}
          <span className="font-black px-1 py-0.2 rounded bg-white/80 dark:bg-black/40 text-[10px]">
            P{m.percentile}
          </span>
        </span>
      ))}
    </div>
  );
}

interface WhoPercentileBreakdownProps {
  metrics: WhoMetricResult[];
  ageLabel?: string;
  title?: string;
  className?: string;
}

export function WhoPercentileBreakdown({
  metrics,
  ageLabel,
  title = "WHO 生长发育标准对照 (0~3岁)",
  className = "",
}: WhoPercentileBreakdownProps) {
  if (!metrics || metrics.length === 0) return null;

  return (
    <div className={`rounded-2xl bg-gradient-to-br from-primary-light/40 via-lavender/10 to-pink-50/20 dark:from-primary/10 dark:via-transparent dark:to-transparent border border-primary/20 p-3.5 space-y-3 ${className}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-bold text-primary">
          <TrendingUp size={14} className="animate-pulse" />
          <span>{title}</span>
        </div>
        {ageLabel && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary-soft/80 text-primary font-semibold">
            {ageLabel}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {metrics.map((m) => {
          const diffStr = m.diff >= 0 ? `+${m.diff}` : `${m.diff}`;
          const gaugePercent = Math.min(100, Math.max(0, m.percentile));

          return (
            <div
              key={m.key}
              className="p-3 rounded-xl bg-white/90 dark:bg-card border border-primary/15 shadow-2xs space-y-2 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-text-secondary flex items-center gap-1">
                    <span>{m.icon}</span>
                    <span>{m.name}</span>
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-bold border ${m.evaluation.badgeBg} ${m.evaluation.badgeColor}`}>
                    {m.evaluation.label}
                  </span>
                </div>

                <div className="flex items-baseline justify-between mt-1.5">
                  <p className="text-base font-black text-text-primary">
                    {m.value} <span className="text-xs font-normal text-text-muted">{m.unit}</span>
                  </p>
                  <div className="text-right">
                    <span className="text-sm font-black text-primary">
                      P{m.percentile}
                    </span>
                    <span className="text-[10px] text-text-muted ml-0.5">/ P100</span>
                  </div>
                </div>
              </div>

              {/* Percentile visual bar */}
              <div className="space-y-1">
                <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-zinc-800 relative overflow-hidden">
                  <div className="absolute top-0 bottom-0 left-[15%] right-[15%] bg-emerald-100/80 dark:bg-emerald-950/40" />
                  <div className="absolute top-0 bottom-0 left-[50%] w-0.5 bg-primary/40 z-1" />
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary to-pink-500 relative transition-all duration-500"
                    style={{ width: `${gaugePercent}%` }}
                  />
                </div>

                <div className="flex justify-between text-[9px] text-text-muted">
                  <span>P3</span>
                  <span className="text-primary font-bold">P50中位</span>
                  <span>P97</span>
                </div>
              </div>

              {/* Benchmark comparison details */}
              <div className="pt-2 border-t border-divider/50 text-[10px] space-y-0.5 text-text-secondary">
                <div className="flex justify-between">
                  <span>WHO中位基线:</span>
                  <span className="font-semibold text-text-primary">{m.median} {m.unit}</span>
                </div>
                <div className="flex justify-between">
                  <span>与中位差值:</span>
                  <span className={`font-semibold ${m.diff >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                    {diffStr} {m.unit}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="text-[10px] text-text-muted/80 flex items-center gap-1 pt-0.5">
        <ShieldCheck size={11} className="text-primary shrink-0" />
        <span>依据世界卫生组织 (WHO) 儿童生长发育标准，P15~P85 属正常体格发育区间</span>
      </div>
    </div>
  );
}

export function ReportWhoSection({
  report,
  baby,
}: {
  report: {
    date: string;
    growthData?: { weightKg?: number; heightCm?: number; headCircumferenceCm?: number } | null;
    items?: { name: string; value: string | number }[] | null;
  };
  baby: { gender?: string; birthDate?: string | null } | null | undefined;
}) {
  if (!baby?.birthDate) return null;
  const metrics = extractReportGrowthMetrics(report);
  const whoResults = getWhoMetricsForBaby(baby, report.date, metrics);

  if (whoResults.length === 0) return null;

  return <WhoPercentileBreakdown metrics={whoResults} />;
}
