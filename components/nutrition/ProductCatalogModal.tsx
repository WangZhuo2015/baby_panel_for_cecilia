"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
      }
    } catch (e) {
      console.error("Import preset error:", e);
    }
  };

  // 预置导入补剂
  const handleImportPresetSupp = async (preset: any) => {
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
        await fetchData();
        if (onUpdated) onUpdated();
      }
    } catch (e) {
      console.error("Import preset supplement error:", e);
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
      }
    } catch (e) {
      console.error("Delete product error:", e);
    }
  };

  // 创建补剂计划 (日服 / 隔天轮换)
  const handleCreateSchedule = async (productId: string, frequency: string) => {
    try {
      const res = await fetch("/api/nutrition/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          babyId,
          productId,
          frequency,
          targetDose: 1.0,
        }),
      });
      if (res.ok) {
        await fetchData();
        if (onUpdated) onUpdated();
      }
    } catch (e) {
      console.error("Create schedule error:", e);
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
      }
    } catch (e) {
      console.error("Delete schedule error:", e);
    }
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
          calciumAmount: parsed.nutrients.calcium ? String(parsed.nutrients.calcium.amount) : "",
          vitDAmount: parsed.nutrients.vitamin_d ? String(parsed.nutrients.vitamin_d.amount) : "",
          vitAAmount: parsed.nutrients.vitamin_a ? String(parsed.nutrients.vitamin_a.amount) : "",
          ironAmount: parsed.nutrients.iron ? String(parsed.nutrients.iron.amount) : "",
          zincAmount: parsed.nutrients.zinc ? String(parsed.nutrients.zinc.amount) : "",
          dhaAmount: parsed.nutrients.dha ? String(parsed.nutrients.dha.amount) : "",
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/60 backdrop-blur-xs animate-fadeIn">
      <div className="bg-bg-canvas rounded-3xl p-4 max-w-md w-full max-h-[90vh] flex flex-col shadow-card border border-primary/20">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-divider/60">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-primary-light text-primary flex items-center justify-center">
              <Package size={18} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-text-primary">家庭配方奶粉与补剂库</h3>
              <p className="text-[10px] text-text-muted">共享管理与成分核对</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full text-text-muted hover:bg-gray-200/60 flex items-center justify-center"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="pt-3 pb-2">
          <SegmentControl
            options={[
              { value: "formula", label: `🍼 奶粉 (${formulas.length})` },
              { value: "supplement", label: `💊 补剂 (${supplements.length})` },
              { value: "schedule", label: `📅 计划 (${schedules.length})` },
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
        <div className="flex-1 overflow-y-auto space-y-3 pr-0.5 py-1">
          {/* TAB 1: 奶粉档案 */}
          {activeTab === "formula" && (
            <div className="space-y-3">
              {/* 操作按钮区 */}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={ocrLoading}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 py-2 bg-gradient-to-r from-primary to-pink-500 text-white rounded-2xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-button btn-press cursor-pointer disabled:opacity-50"
                >
                  <Camera size={15} />
                  {ocrLoading ? "AI 识别中..." : "📸 拍照识别奶粉成分"}
                </button>
                <button
                  type="button"
                  onClick={() => setIsCreatingFormula(!isCreatingFormula)}
                  className="px-3.5 py-2 bg-white text-primary border border-primary/30 rounded-2xl text-xs font-bold flex items-center gap-1 btn-press"
                >
                  <Plus size={14} />
                  自定义
                </button>
              </div>

              {/* 手动添加奶粉折叠表单 */}
              {isCreatingFormula && (
                <CuteCard className="p-3.5 space-y-2.5 bg-white border border-primary/30">
                  <h4 className="text-xs font-bold text-text-primary">添加新奶粉档案</h4>
                  <div className="space-y-2">
                    <CuteInput
                      placeholder="奶粉品牌与全称 (如 爱他美卓萃1段)"
                      value={formulaForm.name}
                      onChange={(e) => setFormulaForm({ ...formulaForm, name: e.target.value })}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <CuteInput
                        placeholder="品牌 (如 爱他美)"
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
                        placeholder="单勺粉重(g)"
                        value={String(formulaForm.scoopWeightG)}
                        onChange={(e) => setFormulaForm({ ...formulaForm, scoopWeightG: Number(e.target.value) || 4.3 })}
                      />
                      <CuteInput
                        type="number"
                        step="5"
                        placeholder="加水毫升(ml)"
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
                  当前正在使用的配方奶粉
                </span>
                {formulas.length > 0 ? (
                  formulas.map((f) => (
                    <CuteCard key={f.id} className="p-3 bg-white border border-primary/15 hover:border-primary/30">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-text-primary">{f.name}</span>
                            {f.stage && (
                              <span className="px-1.5 py-0.2 bg-primary-soft text-primary text-[10px] rounded font-bold">
                                {f.stage}段
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-text-muted mt-0.5">
                            {f.brand} · 标准比例: 1勺({f.scoopWeightG}g):{f.waterPerScoopMl}ml水 ({(f.reconstitutionRatio * 100).toFixed(1)}%)
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setReconstitutionModal({ isOpen: true, product: f })}
                            className="px-2 py-1 bg-sky-50 text-sky-700 text-[10px] font-bold rounded-lg hover:bg-sky-100"
                          >
                            调冲调比
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteProduct("formula", f.id, f.name)}
                            className="p-1 text-text-muted hover:text-red-500"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    </CuteCard>
                  ))
                ) : (
                  <p className="text-xs text-text-muted text-center py-2">暂未添加奶粉档案</p>
                )}
              </div>

              {/* 预置奶粉库一键导入 */}
              <div className="space-y-2 pt-2 border-t border-divider/60">
                <span className="text-[11px] font-bold text-text-secondary block px-1">
                  热门奶粉预置库 (点击一键导入)
                </span>
                <div className="grid grid-cols-1 gap-1.5">
                  {presets.formulas.map((p, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2 rounded-xl bg-gray-50 hover:bg-primary-light/30 border border-gray-200/60 transition-colors"
                    >
                      <div className="truncate pr-2">
                        <span className="text-xs font-semibold text-text-primary truncate block">{p.name}</span>
                        <span className="text-[10px] text-text-muted">{p.notes || p.brand}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleImportPresetFormula(p)}
                        className="px-2.5 py-1 bg-primary text-white rounded-lg text-[11px] font-bold shrink-0 hover:bg-primary-dark transition-colors"
                      >
                        + 导入
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: 补剂档案 */}
          {activeTab === "supplement" && (
            <div className="space-y-3">
              {/* 操作按钮区 */}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={ocrLoading}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 py-2 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-2xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-button btn-press cursor-pointer disabled:opacity-50"
                >
                  <Camera size={15} />
                  {ocrLoading ? "AI 识别中..." : "📸 拍照识别补剂标签"}
                </button>
                <button
                  type="button"
                  onClick={() => setIsCreatingSupp(!isCreatingSupp)}
                  className="px-3.5 py-2 bg-white text-emerald-700 border border-emerald-300 rounded-2xl text-xs font-bold flex items-center gap-1 btn-press"
                >
                  <Plus size={14} />
                  自定义
                </button>
              </div>

              {/* 手动添加补剂折叠表单 */}
              {isCreatingSupp && (
                <CuteCard className="p-3.5 space-y-2.5 bg-white border border-emerald-300">
                  <h4 className="text-xs font-bold text-text-primary">添加新补剂档案 (支持复合多营养素)</h4>
                  <div className="space-y-2">
                    <CuteInput
                      placeholder="补剂名称 (如 Ostelin 液体乳钙)"
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
                        placeholder="默认单次量"
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

                        await fetch("/api/nutrition/products", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            type: "supplement",
                            ...suppForm,
                            nutrients,
                          }),
                        });
                        setIsCreatingSupp(false);
                        await fetchData();
                        if (onUpdated) onUpdated();
                      }}
                    >
                      保存补剂
                    </CuteButton>
                  </div>
                </CuteCard>
              )}

              {/* 已有补剂列表 */}
              <div className="space-y-2">
                <span className="text-[11px] font-bold text-text-secondary uppercase block px-1">
                  家庭已添加补剂 ({supplements.length})
                </span>
                {supplements.length > 0 ? (
                  supplements.map((s) => (
                    <CuteCard key={s.id} className="p-3 bg-white border border-emerald-100">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-text-primary">{s.name}</span>
                            <span className="px-1.5 py-0.2 bg-emerald-50 text-emerald-700 text-[10px] rounded font-bold">
                              {s.unitName}
                            </span>
                          </div>
                          {/* 穿透展示成分 */}
                          <div className="flex flex-wrap gap-1 mt-1">
                            {Object.entries(s.nutrients || {}).map(([key, val]) => (
                              <span key={key} className="text-[10px] bg-gray-100 text-text-secondary px-1.5 py-0.2 rounded">
                                {key === "vitamin_d" ? "维D" : key === "calcium" ? "钙" : key === "vitamin_a" ? "维A" : key}: {val.amount}{val.unit}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleCreateSchedule(s.id, "daily")}
                            className="px-2 py-1 bg-emerald-50 text-emerald-700 text-[10px] font-bold rounded-lg hover:bg-emerald-100"
                          >
                            + 加入计划
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteProduct("supplement", s.id, s.name)}
                            className="p-1 text-text-muted hover:text-red-500"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    </CuteCard>
                  ))
                ) : (
                  <p className="text-xs text-text-muted text-center py-2">暂无补剂档案</p>
                )}
              </div>

              {/* 热门补剂预置库 */}
              <div className="space-y-2 pt-2 border-t border-divider/60">
                <span className="text-[11px] font-bold text-text-secondary block px-1">
                  热门预置补剂 (点击一键导入)
                </span>
                <div className="grid grid-cols-1 gap-1.5">
                  {presets.supplements.map((p, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2 rounded-xl bg-gray-50 hover:bg-emerald-50/50 border border-gray-200/60 transition-colors"
                    >
                      <div className="truncate pr-2">
                        <span className="text-xs font-semibold text-text-primary truncate block">{p.name}</span>
                        <span className="text-[10px] text-text-muted">{p.notes || p.brand}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleImportPresetSupp(p)}
                        className="px-2.5 py-1 bg-emerald-600 text-white rounded-lg text-[11px] font-bold shrink-0 hover:bg-emerald-700 transition-colors"
                      >
                        + 导入
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: 宝宝补剂计划 */}
          {activeTab === "schedule" && (
            <div className="space-y-3">
              <span className="text-[11px] font-bold text-text-secondary uppercase block px-1">
                宝宝补剂服用计划与轮换规则
              </span>

              {schedules.length > 0 ? (
                schedules.map((sc) => (
                  <CuteCard key={sc.id} className="p-3 bg-white border border-primary/20">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-xs font-bold text-text-primary">{sc.product?.name || "补剂"}</span>
                        <p className="text-[11px] text-text-muted mt-0.5">
                          频次: {sc.frequency === "daily" ? "每日一次" : sc.frequency === "alternate_day" ? "隔天轮换 (与AD交替)" : "特定日期"} · 剂量: {sc.targetDose} {sc.product?.unitName || "剂"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteSchedule(sc.id)}
                        className="p-1.5 text-text-muted hover:text-red-500"
                        title="取消计划"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </CuteCard>
                ))
              ) : (
                <div className="p-4 bg-gray-50 rounded-2xl text-center space-y-1">
                  <Calendar size={24} className="mx-auto text-text-muted" />
                  <p className="text-xs text-text-muted">暂未配置补剂计划</p>
                  <p className="text-[10px] text-text-muted">
                    切换到「补剂」标签，在补剂卡片上点击「+ 加入计划」即可建立打卡提醒。
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-divider/60 flex justify-end">
          <CuteButton variant="primary" size="sm" onClick={onClose}>
            完成
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
