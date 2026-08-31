"use client";

import { useState } from "react";
import type { NutrientIntakeItem, NutrientCategory } from "@/types/nutrition";
import { CuteCard } from "@/components/ui/CuteCard";
import { ChevronDown, ChevronUp, Table, Search, CheckCircle2, AlertTriangle, AlertCircle } from "lucide-react";

export interface FullNutrientTableProps {
  items: NutrientIntakeItem[];
  className?: string;
}

const CATEGORY_NAMES: Record<NutrientCategory, string> = {
  macro: "能量与宏量营养素",
  fatty_acid: "优质脂肪酸 (DHA/ARA)",
  vitamin: "全量维生素谱 (脂溶性+水溶性)",
  mineral: "矿物质与微量元素",
  other: "其它有益发育成分",
};

export function FullNutrientTable({ items, className = "" }: FullNutrientTableProps) {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const filteredItems = items.filter((item) => {
    const matchesSearch =
      !searchQuery.trim() ||
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.nutrientId.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCat = selectedCategory === "all" || item.category === selectedCategory;
    return matchesSearch && matchesCat;
  });

  const displayedItems = isExpanded ? filteredItems : filteredItems.slice(0, 8);

  return (
    <CuteCard className={`p-4 space-y-3 bg-white border border-primary/20 shadow-2xs ${className}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Table size={16} className="text-primary" />
          <h3 className="text-xs font-bold text-text-primary">全量营养素摄入明细表 (30+项)</h3>
        </div>
        <span className="text-[10px] text-text-muted">中国 DRIs 2023</span>
      </div>

      {/* 搜索与分类切换 (展开后展示) */}
      {isExpanded && (
        <div className="space-y-2 pt-1 border-t border-divider/50">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="搜索营养素名称 (如 维生素D, 钙, DHA, 铁)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-gray-50 rounded-xl text-xs border border-divider focus:outline-hidden focus:border-primary"
            />
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide text-[11px]">
            <button
              type="button"
              onClick={() => setSelectedCategory("all")}
              className={`px-2.5 py-1 rounded-full whitespace-nowrap font-medium transition-colors ${
                selectedCategory === "all" ? "bg-primary text-white font-bold" : "bg-gray-100 text-text-secondary"
              }`}
            >
              全部 ({items.length})
            </button>
            {Object.entries(CATEGORY_NAMES).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedCategory(key)}
                className={`px-2.5 py-1 rounded-full whitespace-nowrap font-medium transition-colors ${
                  selectedCategory === key ? "bg-primary text-white font-bold" : "bg-gray-100 text-text-secondary"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 表格 */}
      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full text-left border-collapse min-w-[340px]">
          <thead>
            <tr className="border-b border-divider text-[10px] text-text-muted uppercase">
              <th className="py-2 pr-2 font-bold">营养素</th>
              <th className="py-2 px-1 font-bold">今日摄入</th>
              <th className="py-2 px-1 font-bold">参考目标</th>
              <th className="py-2 px-1 font-bold">达标率</th>
              <th className="py-2 pl-1 font-bold text-right">安全上限(UL)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-xs">
            {displayedItems.map((item) => {
              const rate = item.achievementRate;
              const isOver = item.isOverLimit;
              const isNear = item.isNearLimit;

              let statusBadge = null;
              if (isOver) {
                statusBadge = <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1 py-0.2 rounded">超标</span>;
              } else if (isNear) {
                statusBadge = <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-1 py-0.2 rounded">偏高</span>;
              } else if (rate && rate >= 100) {
                statusBadge = <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1 py-0.2 rounded">达标</span>;
              }

              return (
                <tr key={item.nutrientId} className="hover:bg-gray-50/80 transition-colors">
                  <td className="py-2 pr-2 font-medium text-text-primary">
                    <div className="flex items-center gap-1">
                      <span>{item.name}</span>
                      {statusBadge}
                    </div>
                  </td>
                  <td className="py-2 px-1 font-bold text-text-primary">
                    {item.totalAmount} <span className="text-[10px] font-normal text-text-muted">{item.unit}</span>
                  </td>
                  <td className="py-2 px-1 text-text-secondary text-[11px]">
                    {item.targetAmount ? `${item.targetAmount} ${item.unit}` : "-"}
                  </td>
                  <td className="py-2 px-1">
                    {rate !== undefined ? (
                      <span className={`font-semibold ${rate >= 100 ? "text-emerald-600" : rate >= 60 ? "text-primary" : "text-amber-600"}`}>
                        {rate}%
                      </span>
                    ) : (
                      <span className="text-text-muted">-</span>
                    )}
                  </td>
                  <td className="py-2 pl-1 text-right text-text-muted text-[11px]">
                    {item.ul ? (
                      <span className={isOver ? "text-red-600 font-bold" : ""}>
                        {item.ul} {item.unit}
                      </span>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 展开/收起按钮 */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full py-2 bg-primary-soft/40 hover:bg-primary-soft text-primary text-xs font-bold rounded-2xl flex items-center justify-center gap-1 transition-colors btn-press cursor-pointer"
      >
        {isExpanded ? (
          <>
            <ChevronUp size={15} />
            <span>收起部分营养素</span>
          </>
        ) : (
          <>
            <ChevronDown size={15} />
            <span>展开查看全部 30+ 项营养素 ({items.length}项)</span>
          </>
        )}
      </button>
    </CuteCard>
  );
}
