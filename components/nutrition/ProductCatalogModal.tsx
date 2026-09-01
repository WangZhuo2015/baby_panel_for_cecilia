"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  X,
  Plus,
  Camera,
  Layers,
  Sparkles,
  Trash2,
  Check,
  Package,
  Calendar,
  AlertCircle,
  RefreshCw,
  Search,
} from "lucide-react";
import { CuteButton } from "@/components/ui/CuteButton";
import { CuteInput } from "@/components/ui/CuteInput";
import { CuteCard } from "@/components/ui/CuteCard";
import { SegmentControl } from "@/components/ui/SegmentControl";
import { StandardReconstitutionModal } from "./StandardReconstitutionModal";
import type { FormulaProduct, SupplementProduct, SupplementSchedule, ParsedNutritionLabel } from "@/types/nutrition";

export interface ProductCatalogModalProps {
  isOpen: boolean;
  onClose: () => void;
  babyId?: string;
  onUpdated?: () => void;
}

export function ProductCatalogModal({ isOpen, onClose, babyId, onUpdated }: ProductCatalogModalProps) {
  const [activeTab, setActiveTab] = useState<string>("formula");
  const [formulas, setFormulas] = useState<FormulaProduct[]>([]);
  const [supplements, setSupplements] = useState<SupplementProduct[]>([]);
  const [presets, setPresets] = useState<{ formulas: any[]; supplements: any[] }>({ formulas: [], supplements: [] });
  const [schedules, setSchedules] = useState<SupplementSchedule[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // 搜索与过滤筛选
  const [formulaSearch, setFormulaSearch] = useState<string>("");
  const [formulaFilterCategory, setFormulaFilterCategory] = useState<string>("all");

  const [suppSearch, setSuppSearch] = useState<string>("");
  const [suppFilterCategory, setSuppFilterCategory] = useState<string>("all");

  // 冲调浓度确认弹窗状态
  const [reconstitutionModal, setReconstitutionModal] = useState<{
    isOpen: boolean;
    product: FormulaProduct | null;
  }>({
    isOpen: false,
    product: null,
  });

  // OCR 识别中状态
  const [ocrLoading, setOcrLoading] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 手动添加表单状态
  const [isCreatingFormula, setIsCreatingFormula] = useState(false);
  const [formulaForm, setFormulaForm] = useState({
    name: "",
    brand: "",
    stage: 1,
    scoopWeightG: 4.3,
    waterPerScoopMl: 30.0,
    reconstitutionRatio: 0.135,
    notes: "",
  });

  const [isCreatingSupp, setIsCreatingSupp] = useState(false);
  const [suppForm, setSuppForm] = useState({
    name: "",
    brand: "",
    dosageForm: "drops",
    unitName: "滴",
    defaultDose: 1.0,
    calciumAmount: "",
    vitDAmount: "",
    vitAAmount: "",
    ironAmount: "",
    zincAmount: "",
    dhaAmount: "",
    notes: "",
  });

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [prodRes, schedRes] = await Promise.all([
        fetch("/api/nutrition/products"),
        fetch(`/api/nutrition/schedules${babyId ? `?babyId=${babyId}` : ""}`),
      ]);

      if (prodRes.ok) {
        const pData = await prodRes.json();
        setFormulas(pData.formulas || []);
        setSupplements(pData.supplements || []);
        setPresets(pData.presets || { formulas: [], supplements: [] });
      }

      if (schedRes.ok) {
        const sData = await schedRes.json();
        setSchedules(sData.schedules || []);
      }
    } catch (e) {
      console.error("Failed to fetch product catalog:", e);
    } finally {
      setLoading(false);
    }
  }, [babyId]);

  useEffect(() => {
    if (isOpen) {
      fetchData();
    }
  }, [isOpen, fetchData]);

  // 奶粉预置库筛选过滤
  const filteredPresetFormulas = useMemo(() => {
    return presets.formulas.filter((item) => {
      // 类别过滤
      if (formulaFilterCategory === "infatrini" && !item.name.includes("纽荃星") && !item.name.includes("纽太特") && !item.name.includes("纽康特") && !item.brand.includes("纽迪希亚")) return false;
      if (formulaFilterCategory === "de" && !item.name.includes("德") && !item.brand.includes("德")) return false;
      if (formulaFilterCategory === "au" && !item.name.includes("澳") && !item.brand.includes("澳")) return false;
      if (formulaFilterCategory === "sg" && !item.name.includes("新加坡") && !item.brand.includes("新加坡")) return false;
      if (formulaFilterCategory === "cn" && (item.name.includes("德") || item.name.includes("澳") || item.name.includes("新加坡") || item.name.includes("纽荃星") || item.name.includes("纽太特") || item.name.includes("纽康特"))) return false;

      // 关键词搜索
      if (formulaSearch.trim()) {
        const q = formulaSearch.trim().toLowerCase();
        const matchName = item.name.toLowerCase().includes(q);
        const matchBrand = item.brand?.toLowerCase().includes(q);
        const matchNotes = item.notes?.toLowerCase().includes(q);
        const matchStage = String(item.stage || "").includes(q);
        return matchName || matchBrand || matchNotes || matchStage;
      }
      return true;
    });
  }, [presets.formulas, formulaFilterCategory, formulaSearch]);

  // 补剂预置库筛选过滤
  const filteredPresetSupplements = useMemo(() => {
    return presets.supplements.filter((item) => {
      // 分类过滤
      if (suppFilterCategory === "witsbb" && !item.brand.includes("健敏思") && !item.brand.includes("Witsbb") && !item.name.includes("健敏思")) return false;
      if (suppFilterCategory === "vitd" && !item.name.includes("D") && !item.name.includes("AD") && !item.nutrients?.vitamin_d) return false;
      if (suppFilterCategory === "calcium" && !item.name.includes("钙") && !item.nutrients?.calcium) return false;
      if (suppFilterCategory === "iron_zinc" && !item.name.includes("铁") && !item.name.includes("锌") && !item.nutrients?.iron && !item.nutrients?.zinc) return false;
      if (suppFilterCategory === "dha" && !item.name.includes("DHA") && !item.nutrients?.dha) return false;

      // 关键词搜索
      if (suppSearch.trim()) {
        const q = suppSearch.trim().toLowerCase();
        const matchName = item.name.toLowerCase().includes(q);
        const matchBrand = item.brand?.toLowerCase().includes(q);
        const matchNotes = item.notes?.toLowerCase().includes(q);
        return matchName || matchBrand || matchNotes;
      }
      return true;
    });
  }, [presets.supplements, suppFilterCategory, suppSearch]);

  if (!isOpen) return null;

  // 预置导入奶粉
  const handleImportPresetFormula = async (preset: any) => {
    try {
      const res = await fetch("/api/nutrition/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "formula",
          ...preset,
        }),
      });
      if (res.ok) {
        await fetchData();
        if (onUpdated) onUpdated();
        window.dispatchEvent(new CustomEvent("baby:nutrition-updated"));
      }
    } catch (e) {
      console.error("Import preset error:", e);
    }
  };

  // 预置导入补剂 (默认自动加入每日计划)
  const handleImportPresetSupp = async (preset: any, frequency: "daily" | "alternate_day" = "daily") => {
    try {
      const res = await fetch("/api/nutrition/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "supplement",
          ...preset,
        }),
      });
      if (res.ok) {
        const prod = await res.json();
        if (babyId && prod.id) {
          await fetch("/api/nutrition/schedules", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              babyId,
              productId: prod.id,
              frequency,
              targetDose: prod.defaultDose || 1.0,
            }),
          });
        }
        await fetchData();
        if (onUpdated) onUpdated();
        window.dispatchEvent(new CustomEvent("baby:nutrition-updated"));
      }
    } catch (e) {
      console.error("Import preset supplement error:", e);
    }
  };

  // 快捷调整/设置补剂计划频次 (每日 / 隔天 / 暂停)
  const handleSetScheduleFrequency = async (productId: string, frequency: "daily" | "alternate_day" | "none") => {
    try {
      const existingSched = schedules.find((s) => s.productId === productId);
      if (frequency === "none") {
        if (existingSched) {
          await fetch(`/api/nutrition/schedules?id=${existingSched.id}`, {
            method: "DELETE",
          });
        }
      } else {
        await fetch("/api/nutrition/schedules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: existingSched?.id,
            babyId,
            productId,
            frequency,
            targetDose: 1.0,
            isActive: true,
          }),
        });
      }
      await fetchData();
      if (onUpdated) onUpdated();
      window.dispatchEvent(new CustomEvent("baby:nutrition-updated"));
    } catch (e) {
      console.error("Set schedule frequency error:", e);
    }
  };

  // 删除产品
  const handleDeleteProduct = async (type: "formula" | "supplement", id: string, name: string) => {
    if (!window.confirm(`确定删除「${name}」吗？`)) return;
    try {
      const res = await fetch(`/api/nutrition/products?type=${type}&id=${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await fetchData();
        if (onUpdated) onUpdated();
        window.dispatchEvent(new CustomEvent("baby:nutrition-updated"));
      }
    } catch (e) {
      console.error("Delete product error:", e);
    }
  };

  // 删除计划
  const handleDeleteSchedule = async (id: string) => {
    try {
      const res = await fetch(`/api/nutrition/schedules?id=${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await fetchData();
        if (onUpdated) onUpdated();
        window.dispatchEvent(new CustomEvent("baby:nutrition-updated"));
      }
    } catch (e) {
      console.error("Delete schedule error:", e);
    }
  };

  const handleModalClose = () => {
    if (onUpdated) onUpdated();
    window.dispatchEvent(new CustomEvent("baby:nutrition-updated"));
    onClose();
  };

  // OCR 拍照识别处理
  const handleOcrFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setOcrLoading(true);
    try {
      const formData = new FormData();
      formData.append("image", file);

      const res = await fetch("/api/ai/parse-nutrition", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "识别失败，请手动录入或重新拍摄");
        return;
      }

      const data = await res.json();
      const parsed: ParsedNutritionLabel = data.parsed;

      if (parsed.type === "formula") {
        setActiveTab("formula");
        setIsCreatingFormula(true);
        setFormulaForm({
          name: parsed.name || "未命名奶粉",
          brand: parsed.brand || "",
          stage: parsed.stage || 1,
          scoopWeightG: parsed.scoopWeightG || 4.3,
          waterPerScoopMl: parsed.waterPerScoopMl || 30.0,
          reconstitutionRatio: parsed.reconstitutionRatio || 0.135,
          notes: `AI OCR 自动提取于 ${new Date().toLocaleDateString()}`,
        });
      } else {
        setActiveTab("supplement");
        setIsCreatingSupp(true);
        setSuppForm({
          name: parsed.name || "未命名补剂",
          brand: parsed.brand || "",
          dosageForm: parsed.dosageForm || "drops",
          unitName: parsed.unitName || "滴",
          defaultDose: parsed.defaultDose || 1.0,
          calciumAmount: parsed.nutrients?.calcium ? String(parsed.nutrients.calcium.amount) : "",
          vitDAmount: parsed.nutrients?.vitamin_d ? String(parsed.nutrients.vitamin_d.amount) : "",
          vitAAmount: parsed.nutrients?.vitamin_a ? String(parsed.nutrients.vitamin_a.amount) : "",
          ironAmount: parsed.nutrients?.iron ? String(parsed.nutrients.iron.amount) : "",
          zincAmount: parsed.nutrients?.zinc ? String(parsed.nutrients.zinc.amount) : "",
          dhaAmount: parsed.nutrients?.dha ? String(parsed.nutrients.dha.amount) : "",
          notes: "AI OCR 自动识别成分",
        });
      }
    } catch (err) {
      console.error("OCR parse error:", err);
      alert("上传识别失败，请检查网络");
    } finally {
      setOcrLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/65 backdrop-blur-sm animate-fadeIn">
      {/* 确保实体背景为 100% 不透明的 bg-white / dark:bg-[#1E171E] */}
      <div className="bg-white dark:bg-[#1E171E] text-text-primary dark:text-gray-100 rounded-3xl p-4 sm:p-5 max-w-lg w-full max-h-[90dvh] flex flex-col shadow-2xl border border-primary/25 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-divider shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-primary-light text-primary flex items-center justify-center shadow-xs">
              <Package size={20} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-text-primary dark:text-white">配方奶粉与营养补剂库</h3>
              <p className="text-[11px] text-text-secondary dark:text-gray-300">
                添加补剂自动加入计划 · 支持爱他美全版本、Witsbb与拍照OCR
              </p>
            </div>
          </div>
          <button
            onClick={handleModalClose}
            className="w-8 h-8 rounded-full text-text-muted hover:text-text-primary hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="pt-3 pb-2 shrink-0">
          <SegmentControl
            options={[
              { value: "formula", label: `🍼 奶粉库 (${formulas.length})` },
              { value: "supplement", label: `💊 补剂与计划 (${supplements.length})` },
              { value: "schedule", label: `📅 计划汇总 (${schedules.length})` },
            ]}
            value={activeTab}
            onChange={(v) => setActiveTab(v)}
          />
        </div>

        {/* 隐藏的拍照/文件上传 input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleOcrFileChange}
          className="hidden"
        />

        {/* Main Content Area */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1 py-1 overscroll-contain">
          {/* ==================== TAB 1: 奶粉档案 ==================== */}
          {activeTab === "formula" && (
            <div className="space-y-3">
              {/* 操作按钮区 */}
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  disabled={ocrLoading}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 py-2.5 bg-gradient-to-r from-primary to-pink-500 hover:from-primary-dark hover:to-pink-600 text-white rounded-2xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-button btn-press cursor-pointer disabled:opacity-50"
                >
                  <Camera size={15} />
                  {ocrLoading ? "AI 识别中..." : "📸 拍照识别奶粉成分表"}
                </button>
                <button
                  type="button"
                  onClick={() => setIsCreatingFormula(!isCreatingFormula)}
                  className="px-3.5 py-2.5 bg-white dark:bg-card text-primary border border-primary/40 rounded-2xl text-xs font-bold flex items-center gap-1 btn-press hover:bg-primary-light/40"
                >
                  <Plus size={14} />
                  自定义
                </button>
              </div>

              {/* 手动添加奶粉折叠表单 */}
              {isCreatingFormula && (
                <CuteCard className="p-3.5 space-y-2.5 bg-gray-50/80 dark:bg-card border border-primary/30">
                  <h4 className="text-xs font-bold text-text-primary dark:text-white">添加新配方奶粉档案</h4>
                  <div className="space-y-2">
                    <CuteInput
                      placeholder="奶粉品牌与全称 (如 德国爱他美白金Pre段)"
                      value={formulaForm.name}
                      onChange={(e) => setFormulaForm({ ...formulaForm, name: e.target.value })}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <CuteInput
                        placeholder="品牌 (如 爱他美德版)"
                        value={formulaForm.brand}
                        onChange={(e) => setFormulaForm({ ...formulaForm, brand: e.target.value })}
                      />
                      <CuteInput
                        type="number"
                        placeholder="阶段 (1/2/3)"
                        value={String(formulaForm.stage)}
                        onChange={(e) => setFormulaForm({ ...formulaForm, stage: Number(e.target.value) || 1 })}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <CuteInput
                        type="number"
                        step="0.1"
                        placeholder="单勺粉重(g) (如 4.6 或 7.3)"
                        value={String(formulaForm.scoopWeightG)}
                        onChange={(e) => setFormulaForm({ ...formulaForm, scoopWeightG: Number(e.target.value) || 4.3 })}
                      />
                      <CuteInput
                        type="number"
                        step="5"
                        placeholder="加水毫升(ml) (如 30 或 50)"
                        value={String(formulaForm.waterPerScoopMl)}
                        onChange={(e) => setFormulaForm({ ...formulaForm, waterPerScoopMl: Number(e.target.value) || 30.0 })}
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setIsCreatingFormula(false)}
                      className="flex-1 py-1.5 rounded-xl border border-divider text-xs text-text-secondary"
                    >
                      取消
                    </button>
                    <CuteButton
                      size="sm"
                      className="flex-1"
                      onClick={async () => {
                        if (!formulaForm.name.trim()) return alert("请输入奶粉名称");
                        await fetch("/api/nutrition/products", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            type: "formula",
                            ...formulaForm,
                          }),
                        });
                        setIsCreatingFormula(false);
                        await fetchData();
                        if (onUpdated) onUpdated();
                        window.dispatchEvent(new CustomEvent("baby:nutrition-updated"));
                      }}
                    >
                      保存奶粉
                    </CuteButton>
                  </div>
                </CuteCard>
              )}

              {/* 已有奶粉列表 */}
              <div className="space-y-2">
                <span className="text-[11px] font-bold text-text-secondary uppercase block px-1">
                  当前正在使用的配方奶粉 ({formulas.length})
                </span>
                {formulas.length > 0 ? (
                  formulas.map((f) => (
                    <div
                      key={f.id}
                      className="p-3 bg-white dark:bg-[#251D25] rounded-2xl border border-primary/20 shadow-xs flex items-start justify-between gap-2"
                    >
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-text-primary dark:text-white">{f.name}</span>
                          {f.stage && (
                            <span className="px-1.5 py-0.2 bg-primary-soft text-primary text-[10px] rounded font-bold">
                              {f.stage}段
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-text-secondary dark:text-gray-300 mt-0.5">
                          {f.brand} · 标准比例: 1勺({f.scoopWeightG}g):{f.waterPerScoopMl}ml水 ({(f.reconstitutionRatio * 100).toFixed(1)}%)
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => setReconstitutionModal({ isOpen: true, product: f })}
                          className="px-2 py-1 bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300 text-[10px] font-bold rounded-lg border border-sky-200 dark:border-sky-800 hover:bg-sky-100"
                        >
                          调冲调比
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteProduct("formula", f.id, f.name)}
                          className="p-1 text-text-muted hover:text-red-500"
                          title="删除奶粉"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-3 bg-gray-50 dark:bg-[#251D25] rounded-2xl text-center border border-dashed border-divider">
                    <p className="text-xs text-text-muted">暂未添加使用中的奶粉，可在下方预置库一键导入</p>
                  </div>
                )}
              </div>

              {/* 预置奶粉库一键导入与检索 */}
              <div className="space-y-2 pt-2 border-t border-divider">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[11px] font-bold text-text-secondary uppercase block">
                    爱他美各版本及热门预置库 ({filteredPresetFormulas.length})
                  </span>
                </div>

                {/* 搜索框 */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
                  <input
                    type="text"
                    value={formulaSearch}
                    onChange={(e) => setFormulaSearch(e.target.value)}
                    placeholder="搜索版本、段位 (如 德版白金Pre、澳版白金、卓傲)..."
                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-50 dark:bg-[#251D25] border border-divider rounded-xl text-text-primary dark:text-white placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  {formulaSearch && (
                    <button
                      onClick={() => setFormulaSearch("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>

                {/* 版本筛选标签 */}
                <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
                  {[
                    { id: "all", label: "全部" },
                    { id: "infatrini", label: "纽荃星/特医" },
                    { id: "de", label: "德版爱他美" },
                    { id: "au", label: "澳版爱他美" },
                    { id: "cn", label: "国行新国标" },
                    { id: "sg", label: "新加坡版" },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setFormulaFilterCategory(tab.id)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-bold whitespace-nowrap transition-all cursor-pointer ${
                        formulaFilterCategory === tab.id
                          ? "bg-primary text-white shadow-xs"
                          : "bg-gray-100 dark:bg-gray-800 text-text-secondary dark:text-gray-300 hover:bg-gray-200"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* 预置列表 */}
                <div className="grid grid-cols-1 gap-1.5 pr-0.5">
                  {filteredPresetFormulas.map((p, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2.5 rounded-2xl bg-white dark:bg-[#251D25] hover:bg-primary-light/30 border border-gray-200/80 dark:border-gray-800 transition-colors shadow-2xs"
                    >
                      <div className="truncate pr-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-text-primary dark:text-white truncate block">
                            {p.name}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.2 bg-primary/10 text-primary font-bold rounded">
                            {p.scoopWeightG}g:{p.waterPerScoopMl}ml
                          </span>
                        </div>
                        <span className="text-[10px] text-text-secondary dark:text-gray-300 block truncate mt-0.5">
                          {p.notes || p.brand}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleImportPresetFormula(p)}
                        className="px-2.5 py-1 bg-primary hover:bg-primary-dark text-white rounded-xl text-[11px] font-bold shrink-0 shadow-xs transition-colors cursor-pointer"
                      >
                        + 导入
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ==================== TAB 2: 补剂管理与计划 ==================== */}
          {activeTab === "supplement" && (
            <div className="space-y-3">
              {/* 操作按钮区 */}
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  disabled={ocrLoading}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white rounded-2xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-button btn-press cursor-pointer disabled:opacity-50"
                >
                  <Camera size={15} />
                  {ocrLoading ? "AI 识别中..." : "📸 拍照识别补剂成分标签"}
                </button>
                <button
                  type="button"
                  onClick={() => setIsCreatingSupp(!isCreatingSupp)}
                  className="px-3.5 py-2.5 bg-white dark:bg-card text-emerald-700 dark:text-emerald-300 border border-emerald-400 rounded-2xl text-xs font-bold flex items-center gap-1 btn-press hover:bg-emerald-50"
                >
                  <Plus size={14} />
                  自定义
                </button>
              </div>

              {/* 智能计划提示 */}
              <div className="p-2.5 bg-emerald-50/90 dark:bg-emerald-950/40 rounded-2xl border border-emerald-200/80 dark:border-emerald-900 text-xs text-emerald-950 dark:text-emerald-200 flex items-start gap-2">
                <Sparkles size={15} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <div className="leading-relaxed text-[11px]">
                  <span className="font-bold">智能计划自动联动：</span>
                  <span className="text-emerald-800 dark:text-emerald-300">
                    导入或添加补剂将<b>默认自动加入宝宝每日打卡计划</b>。在卡片上可直接一键切换「每日服」、「隔天轮换」或「暂停」。
                  </span>
                </div>
              </div>

              {/* 手动添加补剂折叠表单 */}
              {isCreatingSupp && (
                <CuteCard className="p-3.5 space-y-2.5 bg-gray-50/80 dark:bg-card border border-emerald-300">
                  <h4 className="text-xs font-bold text-text-primary dark:text-white">添加新补剂档案 (自动加入计划)</h4>
                  <div className="space-y-2">
                    <CuteInput
                      placeholder="补剂名称 (如 健敏思液体小蓝盒乳钙)"
                      value={suppForm.name}
                      onChange={(e) => setSuppForm({ ...suppForm, name: e.target.value })}
                    />
                    <div className="grid grid-cols-3 gap-1.5">
                      <CuteInput
                        placeholder="品牌"
                        value={suppForm.brand}
                        onChange={(e) => setSuppForm({ ...suppForm, brand: e.target.value })}
                      />
                      <CuteInput
                        placeholder="剂型(滴/ml/粒)"
                        value={suppForm.unitName}
                        onChange={(e) => setSuppForm({ ...suppForm, unitName: e.target.value })}
                      />
                      <CuteInput
                        type="number"
                        step="0.5"
                        placeholder="单次量"
                        value={String(suppForm.defaultDose)}
                        onChange={(e) => setSuppForm({ ...suppForm, defaultDose: Number(e.target.value) || 1.0 })}
                      />
                    </div>
                    {/* 复合营养素填报 */}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <CuteInput
                        type="number"
                        placeholder="维生素D (IU)"
                        value={suppForm.vitDAmount}
                        onChange={(e) => setSuppForm({ ...suppForm, vitDAmount: e.target.value })}
                      />
                      <CuteInput
                        type="number"
                        placeholder="钙 (mg)"
                        value={suppForm.calciumAmount}
                        onChange={(e) => setSuppForm({ ...suppForm, calciumAmount: e.target.value })}
                      />
                      <CuteInput
                        type="number"
                        placeholder="维生素A (mcg)"
                        value={suppForm.vitAAmount}
                        onChange={(e) => setSuppForm({ ...suppForm, vitAAmount: e.target.value })}
                      />
                      <CuteInput
                        type="number"
                        placeholder="铁 (mg)"
                        value={suppForm.ironAmount}
                        onChange={(e) => setSuppForm({ ...suppForm, ironAmount: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setIsCreatingSupp(false)}
                      className="flex-1 py-1.5 rounded-xl border border-divider text-xs text-text-secondary"
                    >
                      取消
                    </button>
                    <CuteButton
                      size="sm"
                      className="flex-1"
                      onClick={async () => {
                        if (!suppForm.name.trim()) return alert("请输入补剂名称");
                        const nutrients: any = {};
                        if (suppForm.vitDAmount) nutrients.vitamin_d = { amount: Number(suppForm.vitDAmount), unit: "IU" };
                        if (suppForm.calciumAmount) nutrients.calcium = { amount: Number(suppForm.calciumAmount), unit: "mg" };
                        if (suppForm.vitAAmount) nutrients.vitamin_a = { amount: Number(suppForm.vitAAmount), unit: "mcg RAE" };
                        if (suppForm.ironAmount) nutrients.iron = { amount: Number(suppForm.ironAmount), unit: "mg" };

                        const res = await fetch("/api/nutrition/products", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            type: "supplement",
                            ...suppForm,
                            nutrients,
                          }),
                        });

                        if (res.ok) {
                          const prod = await res.json();
                          if (babyId && prod.id) {
                            await fetch("/api/nutrition/schedules", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                babyId,
                                productId: prod.id,
                                frequency: "daily",
                                targetDose: Number(suppForm.defaultDose) || 1.0,
                              }),
                            });
                          }
                          setIsCreatingSupp(false);
                          await fetchData();
                          if (onUpdated) onUpdated();
                          window.dispatchEvent(new CustomEvent("baby:nutrition-updated"));
                        }
                      }}
                    >
                      保存并加入计划
                    </CuteButton>
                  </div>
                </CuteCard>
              )}

              {/* 已有补剂与计划状态列表 */}
              <div className="space-y-2">
                <span className="text-[11px] font-bold text-text-secondary uppercase block px-1">
                  正在使用与计划中的补剂 ({supplements.length})
                </span>
                {supplements.length > 0 ? (
                  supplements.map((s) => {
                    const sched = schedules.find((sc) => sc.productId === s.id && sc.isActive);
                    const currentFreq = sched ? sched.frequency : "none";
                    return (
                      <div
                        key={s.id}
                        className="p-3 bg-white dark:bg-[#251D25] rounded-2xl border border-emerald-200 dark:border-emerald-900/60 shadow-xs space-y-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-bold text-text-primary dark:text-white">{s.name}</span>
                              <span className="px-1.5 py-0.2 bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-[10px] rounded font-bold border border-emerald-200 dark:border-emerald-800">
                                {s.unitName}
                              </span>
                              {currentFreq === "daily" && (
                                <span className="px-2 py-0.2 bg-emerald-500 text-white text-[10px] rounded-full font-bold shadow-2xs">
                                  每日打卡
                                </span>
                              )}
                              {currentFreq === "alternate_day" && (
                                <span className="px-2 py-0.2 bg-purple-500 text-white text-[10px] rounded-full font-bold shadow-2xs">
                                  隔天轮换
                                </span>
                              )}
                              {currentFreq === "none" && (
                                <span className="px-2 py-0.2 bg-gray-100 dark:bg-gray-800 text-text-muted text-[10px] rounded-full font-medium">
                                  未入打卡计划
                                </span>
                              )}
                            </div>
                            {/* 穿透展示成分 */}
                            <div className="flex flex-wrap gap-1 mt-1">
                              {Object.entries(s.nutrients || {}).map(([key, val]) => (
                                <span
                                  key={key}
                                  className="text-[10px] bg-gray-100 dark:bg-gray-800 text-text-secondary dark:text-gray-300 px-1.5 py-0.2 rounded font-medium"
                                >
                                  {key === "vitamin_d"
                                    ? "维D"
                                    : key === "calcium"
                                    ? "钙"
                                    : key === "vitamin_a"
                                    ? "维A"
                                    : key === "iron"
                                    ? "铁"
                                    : key === "zinc"
                                    ? "锌"
                                    : key === "dha"
                                    ? "DHA"
                                    : key}
                                  : {val.amount}
                                  {val.unit}
                                </span>
                              ))}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteProduct("supplement", s.id, s.name)}
                            className="p-1 text-text-muted hover:text-red-500 shrink-0"
                            title="删除补剂"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>

                        {/* 一键计划频次切换 */}
                        <div className="flex items-center justify-between pt-1.5 border-t border-divider/60">
                          <span className="text-[11px] text-text-secondary dark:text-gray-400 font-medium">
                            打卡计划频次:
                          </span>
                          <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 p-0.5 rounded-xl">
                            <button
                              type="button"
                              onClick={() => handleSetScheduleFrequency(s.id, "daily")}
                              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                                currentFreq === "daily"
                                  ? "bg-emerald-600 text-white shadow-xs"
                                  : "text-text-secondary dark:text-gray-300 hover:text-text-primary"
                              }`}
                            >
                              每日服
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSetScheduleFrequency(s.id, "alternate_day")}
                              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                                currentFreq === "alternate_day"
                                  ? "bg-purple-600 text-white shadow-xs"
                                  : "text-text-secondary dark:text-gray-300 hover:text-text-primary"
                              }`}
                            >
                              隔天轮换
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSetScheduleFrequency(s.id, "none")}
                              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                                currentFreq === "none"
                                  ? "bg-gray-300 dark:bg-gray-600 text-text-primary dark:text-white"
                                  : "text-text-muted hover:text-text-secondary"
                              }`}
                            >
                              暂停
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="p-3 bg-gray-50 dark:bg-[#251D25] rounded-2xl text-center border border-dashed border-divider">
                    <p className="text-xs text-text-muted">暂无使用中的补剂，可在下方快速导入 Witsbb、星鲨或伊可新</p>
                  </div>
                )}
              </div>

              {/* 热门补剂预置库与筛选 */}
              <div className="space-y-2 pt-2 border-t border-divider">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[11px] font-bold text-text-secondary uppercase block">
                    Witsbb健敏思与热门补剂库 ({filteredPresetSupplements.length})
                  </span>
                </div>

                {/* 搜索框 */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
                  <input
                    type="text"
                    value={suppSearch}
                    onChange={(e) => setSuppSearch(e.target.value)}
                    placeholder="搜索补剂、成分 (如 健敏思、D3、乳钙、铁剂、DHA)..."
                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-50 dark:bg-[#251D25] border border-divider rounded-xl text-text-primary dark:text-white placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  {suppSearch && (
                    <button
                      onClick={() => setSuppSearch("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>

                {/* 分类筛选标签 */}
                <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
                  {[
                    { id: "all", label: "全部" },
                    { id: "witsbb", label: "健敏思(Witsbb)" },
                    { id: "vitd", label: "维生素D/AD" },
                    { id: "calcium", label: "液体钙/乳钙" },
                    { id: "iron_zinc", label: "铁/锌补充" },
                    { id: "dha", label: "DHA藻油" },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setSuppFilterCategory(tab.id)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-bold whitespace-nowrap transition-all cursor-pointer ${
                        suppFilterCategory === tab.id
                          ? "bg-emerald-600 text-white shadow-xs"
                          : "bg-gray-100 dark:bg-gray-800 text-text-secondary dark:text-gray-300 hover:bg-gray-200"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* 预置列表 */}
                <div className="grid grid-cols-1 gap-1.5 pr-0.5">
                  {filteredPresetSupplements.map((p, idx) => {
                    const existing = supplements.find((item) => item.name === p.name);
                    const sched = existing ? schedules.find((sc) => sc.productId === existing.id && sc.isActive) : null;
                    return (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2.5 rounded-2xl bg-white dark:bg-[#251D25] hover:bg-emerald-50/50 border border-gray-200/80 dark:border-gray-800 transition-colors shadow-2xs"
                      >
                        <div className="truncate pr-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-text-primary dark:text-white truncate block">
                              {p.name}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.2 bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-bold rounded">
                              {p.unitName || "剂"}
                            </span>
                          </div>
                          <span className="text-[10px] text-text-secondary dark:text-gray-300 block truncate mt-0.5">
                            {p.notes || p.brand}
                          </span>
                        </div>
                        {existing ? (
                          <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/70 px-2.5 py-1 rounded-xl border border-emerald-200 dark:border-emerald-800 shrink-0">
                            {sched ? (sched.frequency === "daily" ? "✓ 每日计划中" : "✓ 隔天轮换中") : "✓ 已在库中"}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleImportPresetSupp(p, "daily")}
                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[11px] font-bold shrink-0 shadow-xs transition-colors cursor-pointer"
                          >
                            + 加入计划
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ==================== TAB 3: 宝宝补剂计划汇总 ==================== */}
          {activeTab === "schedule" && (
            <div className="space-y-3">
              <span className="text-[11px] font-bold text-text-secondary uppercase block px-1">
                宝宝补剂服用计划与轮换守护 ({schedules.length})
              </span>

              {schedules.length > 0 ? (
                schedules.map((sc) => (
                  <div
                    key={sc.id}
                    className="p-3 bg-white dark:bg-[#251D25] rounded-2xl border border-primary/25 shadow-xs flex items-center justify-between"
                  >
                    <div>
                      <span className="text-xs font-bold text-text-primary dark:text-white">
                        {sc.product?.name || "补剂"}
                      </span>
                      <p className="text-[11px] text-text-secondary dark:text-gray-300 mt-0.5">
                        频次: {sc.frequency === "daily" ? "每日一次" : sc.frequency === "alternate_day" ? "隔天轮换 (与AD交替)" : "特定日期"} · 剂量: {sc.targetDose} {sc.product?.unitName || "剂"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteSchedule(sc.id)}
                      className="p-1.5 text-text-muted hover:text-red-500 transition-colors"
                      title="取消计划"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              ) : (
                <div className="p-5 bg-gray-50 dark:bg-[#251D25] rounded-2xl text-center space-y-1.5 border border-dashed border-divider">
                  <Calendar size={24} className="mx-auto text-text-muted" />
                  <p className="text-xs font-bold text-text-primary dark:text-white">暂未配置补剂计划</p>
                  <p className="text-[11px] text-text-secondary dark:text-gray-300 leading-relaxed max-w-xs mx-auto">
                    切换到「补剂与计划」标签，点击「+ 加入计划」即可一键导入并建立日常打卡防线。
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-divider flex items-center justify-between gap-2 shrink-0">
          <span className="text-[11px] text-text-secondary dark:text-gray-400 font-medium">
            {activeTab === "formula"
              ? `已配置 ${formulas.length} 款奶粉`
              : activeTab === "supplement"
              ? `已添加 ${supplements.length} 种补剂`
              : `已设定 ${schedules.length} 项计划`}
          </span>
          <CuteButton variant="primary" size="sm" onClick={handleModalClose} className="px-6 shadow-button">
            确认并完成
          </CuteButton>
        </div>
      </div>

      {/* 标准冲调比例确认弹窗 */}
      {reconstitutionModal.isOpen && reconstitutionModal.product && (
        <StandardReconstitutionModal
          isOpen={reconstitutionModal.isOpen}
          onClose={() => setReconstitutionModal({ isOpen: false, product: null })}
          productName={reconstitutionModal.product.name}
          initialScoopWeightG={reconstitutionModal.product.scoopWeightG}
          initialWaterPerScoopMl={reconstitutionModal.product.waterPerScoopMl}
          initialRatio={reconstitutionModal.product.reconstitutionRatio}
          onConfirm={async (data) => {
            if (reconstitutionModal.product) {
              await fetch("/api/nutrition/products", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  id: reconstitutionModal.product.id,
                  type: "formula",
                  ...data,
                }),
              });
              await fetchData();
              if (onUpdated) onUpdated();
            }
          }}
        />
      )}
    </div>
  );
}

