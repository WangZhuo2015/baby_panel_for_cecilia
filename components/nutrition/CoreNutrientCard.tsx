"use client";

import type { NutrientIntakeItem } from "@/types/nutrition";
import { CuteCard } from "@/components/ui/CuteCard";
import { AlertCircle, CheckCircle2, ShieldAlert } from "lucide-react";

export interface CoreNutrientCardProps {
  item?: NutrientIntakeItem;
  icon?: string;
  className?: string;
}

export function CoreNutrientCard({ item, icon = "✨", className = "" }: CoreNutrientCardProps) {
  if (!item) return null;

  const rate = item.achievementRate || 0;
  const isOver = item.isOverLimit;
  const isNear = item.isNearLimit;
  const isMet = rate >= 100 && !isOver;

  // 状态颜色
  let barColor = "bg-primary";
  let badgeText = `${rate}%`;
  let badgeClass = "bg-primary/10 text-primary";

  if (isOver) {
    barColor = "bg-red-500";
    badgeText = "⚠️ 超过上限";
    badgeClass = "bg-red-100 text-red-700";
  } else if (isNear) {
    barColor = "bg-amber-500";
    badgeText = "接近上限";
    badgeClass = "bg-amber-100 text-amber-700";
  } else if (isMet) {
    barColor = "bg-emerald-500";
    badgeText = `达标 ${rate}%`;
    badgeClass = "bg-emerald-100 text-emerald-700";
  } else if (rate < 50) {
    barColor = "bg-sky-400";
    badgeText = `${rate}% 待补充`;
    badgeClass = "bg-sky-100 text-sky-700";
  }

  return (
    <CuteCard className={`p-3 border border-primary/15 hover:border-primary/30 transition-all ${className}`}>
      <div className="flex items-start justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">{icon}</span>
          <span className="text-xs font-bold text-text-primary">{item.name}</span>
        </div>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${badgeClass}`}>
          {badgeText}
        </span>
      </div>

      {/* 数值与参考目标 */}
      <div className="flex items-baseline justify-between mb-2">
        <div className="flex items-baseline gap-1">
          <span className="text-lg font-black text-text-primary tracking-tight">
            {item.totalAmount}
          </span>
          <span className="text-[10px] font-semibold text-text-muted">{item.unit}</span>
        </div>
        {item.targetAmount && (
          <span className="text-[10px] text-text-muted">
            目标 {item.targetAmount} {item.unit} ({item.targetType || "AI"})
          </span>
        )}
      </div>

      {/* 进度条 */}
      <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${Math.min(100, Math.max(0, rate))}%` }}
        />
      </div>

      {/* 多源构成简报 */}
      <div className="mt-2 pt-1.5 border-t border-divider/40 flex items-center justify-between text-[9px] text-text-muted">
        <span>配方: {item.formulaAmount}</span>
        <span>补剂: {item.supplementAmount}</span>
        <span>母乳: {item.breastmilkAmount}</span>
      </div>
    </CuteCard>
  );
}
