"use client";

import React, { useRef } from "react";
import { ChevronUp, ChevronDown, Check } from "lucide-react";
import { clampFoodGrams } from "@/lib/food-log-limits";

export interface SpinnerItem {
  id: string;
  name: string;
  icon: string;
  tried?: boolean;
}

export interface WheelSpinnerColumnProps {
  role: "staple" | "protein" | "vegetable";
  title: string;
  sublabel: string;
  icon: string;
  items: SpinnerItem[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  grams: number;
  onUpdateGrams: (grams: number) => void;
  gramOptions: number[];
  colorTheme: {
    accent: string;
    border: string;
    bg: string;
    badge: string;
  };
  isSpinning?: boolean;
}

export const WheelSpinnerColumn: React.FC<WheelSpinnerColumnProps> = ({
  role,
  title,
  icon,
  items,
  selectedIndex,
  onSelectIndex,
  grams,
  onUpdateGrams,
  gramOptions,
  colorTheme,
  isSpinning = false,
}) => {
  const roleLabel = role === "staple" ? "主食" : role === "protein" ? "蛋白" : "蔬菜";
  const currentItem = items[selectedIndex] || items[0] || { id: "none", name: "（无）", icon: "⚪" };
  const isNone = currentItem.id === "none";

  const prevItem = selectedIndex > 0 ? items[selectedIndex - 1] : null;
  const nextItem = selectedIndex < items.length - 1 ? items[selectedIndex + 1] : null;

  const handlePrev = () => {
    if (selectedIndex > 0) {
      onSelectIndex(selectedIndex - 1);
    } else {
      // Loop around
      onSelectIndex(items.length - 1);
    }
  };

  const handleNext = () => {
    if (selectedIndex < items.length - 1) {
      onSelectIndex(selectedIndex + 1);
    } else {
      // Loop around
      onSelectIndex(0);
    }
  };

  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef<number | null>(null);

  // Handle mouse wheel scrolling directly on the wheel
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY > 0) {
      handleNext();
    } else if (e.deltaY < 0) {
      handlePrev();
    }
  };

  // Handle touch swiping for mobile / tablet
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current === null) return;
    const deltaY = e.touches[0].clientY - touchStartY.current;
    if (deltaY > 28) {
      handlePrev();
      touchStartY.current = e.touches[0].clientY;
    } else if (deltaY < -28) {
      handleNext();
      touchStartY.current = e.touches[0].clientY;
    }
  };

  const handleTouchEnd = () => {
    touchStartY.current = null;
  };

  return (
      <div className={`flex min-w-0 flex-col rounded-2xl border p-2.5 transition-all ${colorTheme.border} ${colorTheme.bg}`}>
      {/* 栏目标题 */}
      <div className="flex min-w-0 items-center justify-between border-b border-primary/10 pb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-base shrink-0">{icon}</span>
          <span className="text-xs font-bold text-text-primary truncate">{title}</span>
        </div>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${colorTheme.badge}`}>
          {isNone ? "不选" : `${grams}g`}
        </span>
      </div>

      {/* 滚轮主体 (3D 滚轮选择器) */}
      <div
        ref={containerRef}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="relative my-1 flex h-36 min-w-0 select-none flex-col items-center justify-center overflow-hidden rounded-xl border border-primary/15 bg-card shadow-inner touch-pan-y"
      >
        {/* 上滚按钮 */}
        <button
          type="button"
          onClick={handlePrev}
          disabled={isSpinning}
          aria-label={`${roleLabel}上一个`}
          className="absolute top-0 z-20 flex h-11 w-11 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-gray-100 hover:text-text-primary dark:hover:bg-gray-800"
          title="上一个"
        >
          <ChevronUp size={16} />
        </button>

        {/* 顶部半透明渐变遮罩 (打造滚轮 3D 景深) */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-card via-card/60 to-transparent z-10" />

        {/* 滚轮中间选框聚焦透镜 */}
        <div className={`pointer-events-none absolute inset-x-1.5 top-1/2 -translate-y-1/2 h-11 rounded-xl border-2 ${colorTheme.accent} bg-primary/5 z-0 shadow-xs`} />

        {/* 滚轮内容列表 */}
        <div className={`w-full flex flex-col items-center justify-center space-y-1 z-10 transition-transform ${isSpinning ? "animate-pulse blur-[1px]" : ""}`}>
          {/* 上一项 (淡化) */}
          <div
            onClick={handlePrev}
            className="h-8 flex items-center justify-center gap-1 text-[11px] text-text-muted/60 opacity-60 hover:opacity-100 cursor-pointer transition-all transform scale-90 truncate px-2 max-w-full"
          >
            {prevItem ? (
              <>
                <span>{prevItem.icon}</span>
                <span className="truncate">{prevItem.name}</span>
              </>
            ) : (
              <span className="text-[10px] text-transparent">占位</span>
            )}
          </div>

          {/* 当前选中的正中项 (高亮放大) */}
          <div className="flex min-h-11 max-w-full items-center justify-center gap-1.5 px-2 py-1 text-center text-xs font-bold text-text-primary transition-all">
            <span className="text-base shrink-0">{currentItem.icon}</span>
            <span className="break-words">{currentItem.name}</span>
            {currentItem.tried && (
              <span className="shrink-0 text-[10px] font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 px-1 py-0.2 rounded-full border border-emerald-200">
                <Check size={9} className="inline mr-0.5" />尝过
              </span>
            )}
          </div>

          {/* 下一项 (淡化) */}
          <div
            onClick={handleNext}
            className="h-8 flex items-center justify-center gap-1 text-[11px] text-text-muted/60 opacity-60 hover:opacity-100 cursor-pointer transition-all transform scale-90 truncate px-2 max-w-full"
          >
            {nextItem ? (
              <>
                <span>{nextItem.icon}</span>
                <span className="truncate">{nextItem.name}</span>
              </>
            ) : (
              <span className="text-[10px] text-transparent">占位</span>
            )}
          </div>
        </div>

        {/* 底部半透明渐变遮罩 */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card via-card/60 to-transparent z-10" />

        {/* 下滚按钮 */}
        <button
          type="button"
          onClick={handleNext}
          disabled={isSpinning}
          aria-label={`${roleLabel}下一个`}
          className="absolute bottom-0 z-20 flex h-11 w-11 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-gray-100 hover:text-text-primary dark:hover:bg-gray-800"
          title="下一个"
        >
          <ChevronDown size={16} />
        </button>
      </div>

      {/* 克数设定面板 */}
      {!isNone ? (
        <div className="mt-1 space-y-1.5 rounded-xl border border-primary/10 bg-card/90 p-1.5">
          {/* 常用克数快捷药丸 */}
          <div className="grid grid-cols-4 gap-1">
            {gramOptions.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => onUpdateGrams(g)}
                className={`min-h-9 rounded-lg py-1 text-xs font-bold transition-all ${
                  grams === g
                    ? "bg-primary text-white shadow-xs"
                    : "bg-gray-100 dark:bg-gray-800 text-text-secondary hover:bg-gray-200"
                }`}
              >
                {g}g
              </button>
            ))}
          </div>

          {/* 微调克数数字输入 */}
          <div className="flex items-center justify-between gap-1 px-1 text-[11px]">
            <span className="text-[10px] text-text-muted">精准克数:</span>
            <div className="flex items-center gap-0.5">
              <input
                type="number"
                aria-label={`${title}精准克数`}
                min={0}
                max={300}
                value={grams || ""}
                onChange={(e) => onUpdateGrams(clampFoodGrams(Number(e.target.value)))}
                className="h-9 w-14 rounded-md border border-primary/15 bg-bg py-0.5 text-center text-xs font-bold focus:outline-hidden focus:ring-1 focus:ring-primary"
              />
              <span className="text-[10px] text-text-muted">g</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-1 rounded-xl border border-primary/10 bg-card/60 py-2 text-center text-xs text-text-muted">
          本餐不添加此类
        </div>
      )}
    </div>
  );
};
