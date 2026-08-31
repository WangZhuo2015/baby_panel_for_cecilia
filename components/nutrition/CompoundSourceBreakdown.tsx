"use client";

import type { NutrientIntakeItem } from "@/types/nutrition";
import { CuteCard } from "@/components/ui/CuteCard";
import { Layers, ShieldCheck } from "lucide-react";

export interface CompoundSourceBreakdownProps {
  items: NutrientIntakeItem[];
  className?: string;
}

export function CompoundSourceBreakdown({ items, className = "" }: CompoundSourceBreakdownProps) {
  // 选取主要有来源贡献的指标（如 维生素D、钙、铁、维生素A、DHA、蛋白质等）
  const multiSourceItems = items.filter((item) => item.sources && item.sources.length > 0 && item.totalAmount > 0);

  if (multiSourceItems.length === 0) return null;

  return (
    <CuteCard className={`p-4 space-y-3 bg-gradient-to-br from-white to-gray-50/50 border border-primary/20 ${className}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Layers size={16} className="text-primary" />
          <h3 className="text-xs font-bold text-text-primary">复合营养素来源穿透</h3>
        </div>
        <span className="text-[10px] text-text-muted flex items-center gap-1">
          <ShieldCheck size={12} className="text-emerald-500" />
          原子级累加
        </span>
      </div>

      <div className="space-y-2.5">
        {multiSourceItems.slice(0, 5).map((item) => (
          <div key={item.nutrientId} className="p-2.5 bg-white rounded-2xl border border-divider/60 space-y-1.5 shadow-2xs">
            <div className="flex items-center justify-between text-xs font-bold text-text-primary">
              <span>{item.name}</span>
              <span className="text-primary">
                总计 {item.totalAmount} {item.unit}
              </span>
            </div>

            {/* 来源构成列表 */}
            <div className="space-y-1">
              {item.sources.map((src, idx) => {
                const percent = item.totalAmount > 0 ? ((src.amount / item.totalAmount) * 100).toFixed(0) : "0";
                const typeIcon =
                  src.sourceType === "formula" ? "🍼" : src.sourceType === "supplement" ? "💊" : "🤱";

                return (
                  <div key={idx} className="flex items-center justify-between text-[11px] text-text-secondary pl-1">
                    <span className="truncate flex items-center gap-1">
                      <span>{typeIcon}</span>
                      <span className="truncate max-w-[190px]">{src.sourceName}</span>
                    </span>
                    <span className="font-semibold text-text-primary shrink-0">
                      +{src.amount} {src.unit} ({percent}%)
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </CuteCard>
  );
}
