"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  X,
  Plus,
  Check,
  Star,
  Trash2,
  Search,
  Sparkles,
  Milk,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { CuteButton } from "@/components/ui/CuteButton";
import { CuteInput } from "@/components/ui/CuteInput";
import type { FormulaProduct } from "@/types/nutrition";

export interface QuickFormulaManageModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedFormulaId?: string | null;
  onSelectFormula?: (formulaId: string) => void;
  onFormulasChanged?: (newSelectedFormulaId?: string) => void;
}

export function QuickFormulaManageModal({
  isOpen,
  onClose,
  selectedFormulaId,
  onSelectFormula,
  onFormulasChanged,
}: QuickFormulaManageModalProps) {
  const [activeTab, setActiveTab] = useState<"current" | "presets" | "custom">("current");
  const [formulas, setFormulas] = useState<FormulaProduct[]>([]);
  const [presets, setPresets] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 预置库搜索与分类
  const [presetSearch, setPresetSearch] = useState<string>("");
  const [presetCategory, setPresetCategory] = useState<string>("all");

  // 自定义表单
  const [customForm, setCustomForm] = useState({
    brand: "",
    name: "",
    stage: 1 as number | null,
    scoopWeightG: 4.3,
    waterPerScoopMl: 30.0,
    reconstitutionRatio: 0.135,
    isDefault: false,
    notes: "",
  });
  const [submittingCustom, setSubmittingCustom] = useState(false);

  // 加载家庭奶粉列表与预置库
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/nutrition/products?type=formula&includeInactive=true");
      if (res.ok) {
        const data = await res.json();
        setFormulas(data.formulas || []);
        setPresets(data.presets?.formulas || []);
        // 如果当前没有任何活跃奶粉，默认引导到预置库
        const activeList = (data.formulas || []).filter((f: any) => f.isActive !== false);
        if (activeList.length === 0) {
          setActiveTab("presets");
        }
      } else {
        setError("获取奶粉产品库失败");
      }
    } catch {
      setError("网络异常，无法获取奶粉信息");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, loadData]);

  const activeFormulas = useMemo(() => {
    return formulas.filter((f) => f.isActive !== false);
  }, [formulas]);

  // 设为主力默认奶粉
  const handleSetDefault = async (formula: FormulaProduct) => {
    try {
      setActionLoadingId(formula.id);
      const res = await fetch("/api/nutrition/products", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: formula.id,
          type: "formula",
          isDefault: true,
          isActive: true,
        }),
      });
      if (res.ok) {
        await loadData();
        onFormulasChanged?.(formula.id);
      } else {
        const err = await res.json();
        alert(err.error || "设为主力失败");
      }
    } catch {
      alert("网络异常，设为主力失败");
    } finally {
      setActionLoadingId(null);
    }
  };

  // 归档或删除奶粉
  const handleDeleteOrArchive = async (formula: FormulaProduct) => {
    const confirmMsg = `确定要移除奶粉「${formula.name}」吗？\n若已有历史记录，将自动转为归档（历史分析保留，新记录不再显示）。`;
    if (!window.confirm(confirmMsg)) return;

    try {
      setActionLoadingId(formula.id);
      const res = await fetch(`/api/nutrition/products?id=${formula.id}&type=formula`, {
        method: "DELETE",
      });
      if (res.ok) {
        await loadData();
        // 如果删除的是当前选中的奶粉，切换选中其他主力（若无其他奶粉则清空选中）
        const remaining = activeFormulas.filter((f) => f.id !== formula.id);
        const nextSelected = remaining.find((f) => f.isDefault) || remaining[0];
        onFormulasChanged?.(nextSelected?.id);
        if (selectedFormulaId === formula.id) {
          onSelectFormula?.(nextSelected ? nextSelected.id : "");
        }
      } else {
        const err = await res.json();
        alert(err.error || "移除奶粉失败");
      }
    } catch {
      alert("网络异常，移除失败");
    } finally {
      setActionLoadingId(null);
    }
  };

  // 从预置库一键添加
  const handleAddPreset = async (preset: any) => {
    try {
      setActionLoadingId(preset.name);
      const isFirst = activeFormulas.length === 0;
      const res = await fetch("/api/nutrition/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "formula",
          name: preset.name,
          brand: preset.brand,
          stage: preset.stage,
          scoopWeightG: preset.scoopWeightG,
          waterPerScoopMl: preset.waterPerScoopMl,
          reconstitutionRatio: preset.reconstitutionRatio,
          servingSizeUnit: preset.servingSizeUnit || "per_100g",
          nutrients: preset.nutrients || {},
          notes: preset.notes,
          isDefault: isFirst,
        }),
      });

      if (res.ok) {
        const created = await res.json();
        await loadData();
        onFormulasChanged?.(created.id);
        onSelectFormula?.(created.id);
        onClose();
      } else {
        const err = await res.json();
        alert(err.error || "添加奶粉失败");
      }
    } catch {
      alert("网络异常，添加奶粉失败");
    } finally {
      setActionLoadingId(null);
    }
  };

  // 自定义表单提交
  const handleCustomSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customForm.name.trim()) {
      alert("请填写奶粉名称");
      return;
    }
    if (customForm.scoopWeightG <= 0 || customForm.waterPerScoopMl <= 0) {
      alert("单勺克重与加水量必须大于 0");
      return;
    }
    try {
      setSubmittingCustom(true);
      const isFirst = activeFormulas.length === 0;
      const computedRatio =
        customForm.waterPerScoopMl > 0
          ? Number((customForm.scoopWeightG / (customForm.waterPerScoopMl + customForm.scoopWeightG * 0.7)).toFixed(4))
          : customForm.reconstitutionRatio || 0.135;

      const res = await fetch("/api/nutrition/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "formula",
          name: customForm.name.trim(),
          brand: (customForm.brand || customForm.name).trim(),
          stage: typeof customForm.stage === "number" ? customForm.stage : null,
          scoopWeightG: Number(customForm.scoopWeightG) || 4.3,
          waterPerScoopMl: Number(customForm.waterPerScoopMl) || 30.0,
          reconstitutionRatio: computedRatio,
          notes: customForm.notes ? customForm.notes.trim() : null,
          isDefault: isFirst || customForm.isDefault,
        }),
      });

      if (res.ok) {
        const created = await res.json();
        await loadData();
        onFormulasChanged?.(created.id);
        onSelectFormula?.(created.id);
        onClose();
      } else {
        const err = await res.json();
        alert(err.error || "保存自定义奶粉失败");
      }
    } catch {
      alert("网络异常，保存失败");
    } finally {
      setSubmittingCustom(false);
    }
  };

  // 预置库筛选过滤
  const filteredPresets = useMemo(() => {
    return presets.filter((p) => {
      // 分类过滤
      if (presetCategory === "aptamil_de" && !p.brand.includes("德")) return false;
      if (presetCategory === "aptamil_au" && !p.brand.includes("澳")) return false;
      if (presetCategory === "aptamil_cn" && !p.brand.includes("国内") && !p.name.includes("卓萃") && !p.name.includes("奇迹白金")) return false;
      if (presetCategory === "special" && !p.name.includes("纽荃星") && !p.name.includes("纽康特") && !p.name.includes("纽太特") && !p.name.includes("百肽") && !p.brand.includes("纽迪希亚")) return false;
      if (presetCategory === "domestic" && !p.brand.includes("飞鹤") && !p.brand.includes("美素佳儿") && !p.brand.includes("启赋") && !p.brand.includes("美赞臣")) return false;

      // 关键词搜索
      if (presetSearch.trim()) {
        const q = presetSearch.trim().toLowerCase();
        const matchName = p.name.toLowerCase().includes(q);
        const matchBrand = p.brand.toLowerCase().includes(q);
        const matchNotes = (p.notes || "").toLowerCase().includes(q);
        const matchStage = String(p.stage || "").includes(q);
        return matchName || matchBrand || matchNotes || matchStage;
      }
      return true;
    });
  }, [presets, presetCategory, presetSearch]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white dark:bg-[#1E171E] text-text-primary dark:text-gray-100 rounded-3xl p-4 sm:p-5 max-w-lg w-full max-h-[92dvh] flex flex-col shadow-2xl border border-primary/20 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-divider shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">
              <Milk size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-text-primary flex items-center gap-1.5">
                管理宝宝正在喝的奶粉
              </h2>
              <p className="text-[11px] text-text-muted">
                支持添加多款奶粉并随顿选择，可设置常用默认款
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-gray-100 dark:hover:bg-white/10 text-text-secondary flex items-center justify-center transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-gray-100 dark:bg-card p-1 rounded-2xl my-3 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab("current")}
            className={`flex-1 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 cursor-pointer ${
              activeTab === "current"
                ? "bg-white dark:bg-white/10 text-primary shadow-2xs"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            <span>正在喝的奶粉</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-primary-soft text-primary font-bold">
              {activeFormulas.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("presets")}
            className={`flex-1 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 cursor-pointer ${
              activeTab === "presets"
                ? "bg-white dark:bg-white/10 text-primary shadow-2xs"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            <Sparkles size={12} className="text-amber-500" />
            <span>热门预置库</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("custom")}
            className={`flex-1 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 cursor-pointer ${
              activeTab === "custom"
                ? "bg-white dark:bg-white/10 text-primary shadow-2xs"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            <Plus size={12} />
            <span>手动录入</span>
          </button>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-3 p-2.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-600 flex items-center gap-2">
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        {/* Body (Scrollable) */}
        <div className="overflow-y-auto overscroll-contain flex-1 pr-1 space-y-3 pb-2">
          {/* TAB 1: 正在喝的奶粉列表 */}
          {activeTab === "current" && (
            <div className="space-y-2.5">
              {loading ? (
                <div className="py-12 text-center text-text-muted text-xs flex flex-col items-center gap-2">
                  <Loader2 size={20} className="animate-spin text-primary" />
                  <span>正在加载奶粉档案...</span>
                </div>
              ) : activeFormulas.length === 0 ? (
                <div className="py-8 px-4 rounded-2xl bg-primary-light/30 border border-dashed border-primary/30 text-center space-y-2.5">
                  <span className="text-3xl">🍼</span>
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-text-primary">尚未添加宝宝正在喝的奶粉</p>
                    <p className="text-[11px] text-text-muted max-w-xs mx-auto">
                      可从常见德国/澳洲/国行爱他美、纽荃星特医、飞鹤等预置库一键添加，也可手动输入自定义品牌
                    </p>
                  </div>
                  <div className="flex justify-center gap-2 pt-1">
                    <CuteButton
                      type="button"
                      size="sm"
                      variant="primary"
                      onClick={() => setActiveTab("presets")}
                    >
                      <Sparkles size={13} className="mr-1" />
                      从热门预置库挑选
                    </CuteButton>
                    <CuteButton
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => setActiveTab("custom")}
                    >
                      手动录入
                    </CuteButton>
                  </div>
                </div>
              ) : (
                <>
                  <div className="text-[11px] text-text-muted px-1">
                    宝宝可在多款奶粉间随顿切换；标为「主力」的奶粉将作为默认选项。
                  </div>
                  {activeFormulas.map((f) => {
                    const isSelected = selectedFormulaId === f.id;
                    const isDefault = Boolean(f.isDefault);
                    const isLoading = actionLoadingId === f.id;

                    return (
                      <div
                        key={f.id}
                        className={`p-3 rounded-2xl border transition-all ${
                          isSelected
                            ? "bg-primary-soft/50 border-primary shadow-xs"
                            : "bg-white dark:bg-card border-divider/80 hover:border-primary/40"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-bold text-text-primary truncate">
                                {f.name}
                              </span>
                              {isDefault && (
                                <span className="text-[10px] bg-primary/10 text-primary border border-primary/30 px-1.5 py-0.2 rounded-full font-bold flex items-center gap-0.5">
                                  <Star size={10} className="fill-primary text-primary" />
                                  主力默认
                                </span>
                              )}
                              {isSelected && (
                                <span className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400 border border-emerald-300 px-1.5 py-0.2 rounded-full font-bold flex items-center gap-0.5">
                                  <Check size={10} />
                                  本顿选中
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-1 text-[11px] text-text-muted flex-wrap">
                              <span>品牌: {f.brand}</span>
                              {f.stage !== null && f.stage !== undefined && (
                                <span>{f.stage === 0 ? "Pre段" : `${f.stage}段`}</span>
                              )}
                              <span>冲调比: {((f.reconstitutionRatio || 0.135) * 100).toFixed(1)}%</span>
                              {f.waterPerScoopMl && <span>({f.waterPerScoopMl}ml/勺)</span>}
                            </div>
                            {f.notes && (
                              <p className="text-[10px] text-text-muted mt-1 line-clamp-1">
                                {f.notes}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-1 shrink-0 pt-0.5">
                            {/* 选择此款 */}
                            {!isSelected ? (
                              <button
                                type="button"
                                onClick={() => {
                                  onSelectFormula?.(f.id);
                                  onClose();
                                }}
                                disabled={isLoading}
                                className="px-2.5 py-1 rounded-xl text-xs font-bold bg-primary text-white hover:bg-primary/90 btn-press cursor-pointer"
                              >
                                选用此款
                              </button>
                            ) : null}

                            {/* 设为主力 */}
                            {!isDefault && (
                              <button
                                type="button"
                                onClick={() => handleSetDefault(f)}
                                disabled={isLoading}
                                title="设为主力默认奶粉"
                                className="px-2 py-1 rounded-xl text-xs font-semibold text-text-secondary hover:text-primary hover:bg-primary-soft border border-divider btn-press cursor-pointer"
                              >
                                {isLoading ? <Loader2 size={12} className="animate-spin" /> : "设为主力"}
                              </button>
                            )}

                            {/* 移除 / 归档 */}
                            <button
                              type="button"
                              onClick={() => handleDeleteOrArchive(f)}
                              disabled={isLoading}
                              title="移除或归档"
                              className="w-7 h-7 rounded-xl flex items-center justify-center text-text-muted hover:text-red-600 hover:bg-red-50 border border-divider/60 transition-colors cursor-pointer"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  <div className="pt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveTab("presets")}
                      className="flex-1 py-2 px-3 rounded-xl border border-primary/30 bg-primary-light/40 text-primary text-xs font-bold hover:bg-primary-soft transition-all flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Sparkles size={13} />
                      + 从预置库挑选新奶粉
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab("custom")}
                      className="py-2 px-3 rounded-xl border border-divider hover:border-primary/40 bg-white dark:bg-card text-text-secondary text-xs font-bold hover:text-primary transition-all flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Plus size={13} />
                      手动录入
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* TAB 2: 热门预置库 */}
          {activeTab === "presets" && (
            <div className="space-y-3">
              {/* Search input */}
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <CuteInput
                  value={presetSearch}
                  onChange={(e) => setPresetSearch(e.target.value)}
                  placeholder="搜索奶粉品牌、名称、段位..."
                  className="pl-8 text-xs h-9"
                />
              </div>

              {/* Category Pills */}
              <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs">
                {[
                  { id: "all", label: "全部" },
                  { id: "aptamil_de", label: "德国爱他美" },
                  { id: "aptamil_au", label: "澳洲爱他美" },
                  { id: "aptamil_cn", label: "国行爱他美" },
                  { id: "special", label: "纽荃星/小百肽特医" },
                  { id: "domestic", label: "飞鹤/启赋/美素佳儿" },
                ].map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setPresetCategory(c.id)}
                    className={`px-2.5 py-1 rounded-xl whitespace-nowrap text-xs font-bold transition-all cursor-pointer ${
                      presetCategory === c.id
                        ? "bg-primary text-white shadow-button"
                        : "bg-gray-100 dark:bg-card text-text-secondary hover:bg-primary-soft"
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>

              {/* Preset Cards */}
              <div className="space-y-2">
                {filteredPresets.map((preset, idx) => {
                  const alreadyAdded = activeFormulas.some(
                    (f) => f.name.trim().toLowerCase() === preset.name.trim().toLowerCase()
                  );
                  const isAdding = actionLoadingId === preset.name;

                  return (
                    <div
                      key={idx}
                      className="p-3 rounded-2xl bg-white dark:bg-card border border-divider/80 hover:border-primary/40 transition-all flex items-center justify-between gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-bold text-text-primary">
                            {preset.name}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-primary-soft text-primary font-medium">
                            {preset.brand}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-[10px] text-text-muted">
                          <span>标准单勺 {preset.scoopWeightG}g</span>
                          <span>兑水 {preset.waterPerScoopMl}ml</span>
                          <span>冲调浓度 {((preset.reconstitutionRatio || 0.135) * 100).toFixed(1)}%</span>
                        </div>
                        {preset.notes && (
                          <p className="text-[10px] text-text-muted mt-0.5 line-clamp-1">
                            {preset.notes}
                          </p>
                        )}
                      </div>

                      <div className="shrink-0">
                        {alreadyAdded ? (
                          <span className="px-2.5 py-1 rounded-xl text-xs font-bold text-text-muted bg-gray-100 dark:bg-white/5 cursor-not-allowed">
                            已添加
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleAddPreset(preset)}
                            disabled={isAdding}
                            className="px-3 py-1.5 rounded-xl text-xs font-bold bg-primary text-white hover:bg-primary/90 btn-press flex items-center gap-1 cursor-pointer"
                          >
                            {isAdding ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : (
                              <>
                                <Plus size={13} />
                                <span>添加选用</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {filteredPresets.length === 0 && (
                  <div className="py-8 text-center text-xs text-text-muted">
                    未找到匹配的预置奶粉，您可切换分类或尝试“手动录入”
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: 手动录入 */}
          {activeTab === "custom" && (
            <form onSubmit={handleCustomSubmit} className="space-y-3">
              <div className="p-3 bg-amber-50/60 dark:bg-amber-950/30 rounded-2xl border border-amber-200/60 text-[11px] text-amber-800 dark:text-amber-300 flex items-start gap-2">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>
                  录入奶粉罐上的冲调说明（例如 1平勺配30ml温开水），系统将自动准确核算宝宝干粉量与微量营养素摄入。
                </span>
              </div>

              <div>
                <label className="text-xs font-bold text-text-secondary block mb-1">
                  奶粉品牌 <span className="text-red-500">*</span>
                </label>
                <CuteInput
                  value={customForm.brand}
                  onChange={(e) => setCustomForm({ ...customForm, brand: e.target.value })}
                  placeholder="例如：爱他美、飞鹤、惠氏、纽荃星"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-bold text-text-secondary block mb-1">
                  奶粉完整名称 <span className="text-red-500">*</span>
                </label>
                <CuteInput
                  value={customForm.name}
                  onChange={(e) => setCustomForm({ ...customForm, name: e.target.value })}
                  placeholder="例如：德国爱他美白金版 Pre段 (0-6个月)"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-bold text-text-secondary block mb-1">
                    适用段位
                  </label>
                  <select
                    value={customForm.stage ?? ""}
                    onChange={(e) =>
                      setCustomForm({
                        ...customForm,
                        stage: e.target.value !== "" ? Number(e.target.value) : null,
                      })
                    }
                    className="w-full text-xs rounded-2xl border border-divider px-3 py-2 bg-white dark:bg-card text-text-primary"
                  >
                    <option value="">特医 / 无特定段位</option>
                    <option value="0">Pre段 (0-3/6个月)</option>
                    <option value="1">1段 (0-6个月)</option>
                    <option value="2">2段 (6-12个月)</option>
                    <option value="3">3段 (12-36个月)</option>
                    <option value="4">4段 (3岁以上)</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-text-secondary block mb-1">
                    每勺加水量 (ml)
                  </label>
                  <CuteInput
                    type="number"
                    step="0.5"
                    min="0.1"
                    value={customForm.waterPerScoopMl}
                    onChange={(e) =>
                      setCustomForm({ ...customForm, waterPerScoopMl: Number(e.target.value) })
                    }
                    placeholder="默认 30"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-bold text-text-secondary block mb-1">
                    单勺奶粉克重 (g)
                  </label>
                  <CuteInput
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={customForm.scoopWeightG}
                    onChange={(e) =>
                      setCustomForm({ ...customForm, scoopWeightG: Number(e.target.value) })
                    }
                    placeholder="默认 4.3"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-text-secondary block mb-1">
                    冲调浓度 (折算)
                  </label>
                  <div className="px-3 py-2 rounded-2xl bg-gray-100 dark:bg-white/5 border border-divider text-xs font-bold text-primary flex items-center justify-between">
                    <span>
                      {(
                        (customForm.waterPerScoopMl > 0
                          ? customForm.scoopWeightG /
                            (customForm.waterPerScoopMl + customForm.scoopWeightG * 0.7)
                          : 0.135) * 100
                      ).toFixed(1)}
                      %
                    </span>
                    <span className="text-[10px] text-text-muted">自动计算</span>
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-text-secondary block mb-1">
                  备注说明 (可选)
                </label>
                <CuteInput
                  value={customForm.notes}
                  onChange={(e) => setCustomForm({ ...customForm, notes: e.target.value })}
                  placeholder="如：早产追赶高能量配方、白天喝款等"
                />
              </div>

              <div className="pt-1">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={customForm.isDefault}
                    onChange={(e) =>
                      setCustomForm({ ...customForm, isDefault: e.target.checked })
                    }
                    className="w-4 h-4 rounded text-primary accent-primary"
                  />
                  <span className="text-xs font-medium text-text-primary">
                    设为宝宝的主力奶粉（记录时优先默认推荐）
                  </span>
                </label>
              </div>

              <div className="pt-2">
                <CuteButton
                  type="submit"
                  size="md"
                  variant="primary"
                  className="w-full"
                  disabled={submittingCustom}
                >
                  {submittingCustom ? (
                    <span className="flex items-center gap-1.5 justify-center">
                      <Loader2 size={14} className="animate-spin" />
                      <span>正在保存...</span>
                    </span>
                  ) : (
                    "保存并立即选用"
                  )}
                </CuteButton>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
