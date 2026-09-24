"use client";

import { useNutritionFetch } from "@/lib/hooks/useNutritionFetch";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  CheckCircle2,
  Clock,
  Plus,
  Minus,
  Settings2,
} from "lucide-react";
import { QuickFormulaManageModal } from "@/components/nutrition/QuickFormulaManageModal";
import { NursingDualTimer } from "./NursingDualTimer";
import { CuteButton } from "@/components/ui/CuteButton";
import { CuteInput } from "@/components/ui/CuteInput";
import { CuteCard } from "@/components/ui/CuteCard";
import { FormSection } from "@/components/ui/FormSection";
import { SegmentControl } from "@/components/ui/SegmentControl";
import { QuickAiButton } from "@/components/ui/QuickAiButton";
import { VoiceConfirmEntry } from "@/components/ui/VoiceConfirmEntry";
import { localTimeToUtcIso, getLocalDateStr, getLocalTimeStr } from "@/lib/date";
import { estimateNursingVolumeMl } from "@/lib/nutrition/breastmilk";
import type { FeedingType, FeedingRecord } from "@/types";

const FORMULA_PRESETS = [60, 90, 120, 150, 180, 210, 240];

function isoToLocalHHMM(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  return `${p.find((x) => x.type === "hour")?.value ?? "00"}:${p.find((x) => x.type === "minute")?.value ?? "00"}`;
}

export interface FeedingFormProps {
  mode?: "create" | "edit";
  initialData?: Partial<FeedingRecord> | any;
  onSubmit: (data: {
    type: FeedingType;
    amountMl?: number | null;
    leftMinutes?: number | null;
    rightMinutes?: number | null;
    spitUp: boolean;
    notes?: string;
    timestamp: string;
    formulaProductId?: string | null;
  }) => Promise<void>;
  onCancel?: () => void;
  saving?: boolean;
}

export function FeedingForm({
  mode = "create",
  initialData,
  onSubmit,
  onCancel,
  saving = false,
}: FeedingFormProps) {
  const isEdit = mode === "edit";
  const nutritionFetch = useNutritionFetch(initialData?.babyId);

  const [feedingType, setFeedingType] = useState<FeedingType>(() => {
    return (initialData?.type as FeedingType) || "formula";
  });

  const [amount, setAmount] = useState<number>(() => {
    return typeof initialData?.amountMl === "number" ? initialData.amountMl : 120;
  });

  const [customBreastMl, setCustomBreastMl] = useState<number | null>(() => {
    if (initialData?.type === "breast" && typeof initialData?.amountMl === "number" && initialData.amountMl > 0) {
      return initialData.amountMl;
    }
    return null;
  });

  // Breastfeeding state (isolated to minutes in parent; seconds tick in leaf NursingDualTimer)
  const [leftMin, setLeftMin] = useState<number>(() => {
    return initialData?.leftMinutes || 0;
  });
  const [rightMin, setRightMin] = useState<number>(() => {
    return initialData?.rightMinutes || 0;
  });
  const handleNursingDurationChange = useCallback((l: number, r: number) => {
    setLeftMin(l);
    setRightMin(r);
  }, []);

  const [spitUp, setSpitUp] = useState<boolean>(() => {
    return Boolean(initialData?.spitUp);
  });

  const [tookVitaminD, setTookVitaminD] = useState<boolean>(() => {
    return typeof initialData?.notes === "string" && initialData.notes.includes("维生素D");
  });

  const [notes, setNotes] = useState<string>(() => {
    if (!initialData?.notes) return "";
    return initialData.notes
      .replace(/\(已补充维生素D\)/g, "")
      .replace(/已补充维生素D/g, "")
      .trim();
  });

  const [time, setTime] = useState<string>(() => {
    if (initialData?.timestamp) {
      const hhmm = isoToLocalHHMM(initialData.timestamp);
      if (hhmm) return hhmm;
    }
    return getLocalTimeStr();
  });

  const [isNow, setIsNow] = useState<boolean>(() => !isEdit && !initialData?.timestamp);

  const [isFormulaModalOpen, setIsFormulaModalOpen] = useState<boolean>(false);
  const [formulaProducts, setFormulaProducts] = useState<any[]>([]);
  const [selectedFormulaId, setSelectedFormulaId] = useState<string | null>(() => {
    return initialData?.formulaProductId || null;
  });

  const fetchFormulas = useCallback(
    async (autoSelectId?: string) => {
      try {
        const res = await nutritionFetch("/api/nutrition/products?type=formula&includeInactive=true");
        if (!res.ok) return;
        const data = await res.json();
        const list = data.formulas || [];
        setFormulaProducts(list);

        if (autoSelectId) {
          setSelectedFormulaId(autoSelectId);
        } else {
          setSelectedFormulaId((curr) => {
            if (curr) {
              const found = list.find((f: any) => f.id === curr);
              if (found && (isEdit || found.isActive !== false)) return curr;
            }
            if (isEdit) {
              return initialData?.formulaProductId || null;
            }
            // Check localStorage on client for last selected active formula
            const lastSavedId =
              typeof window !== "undefined" ? localStorage.getItem("last_selected_formula_id") : null;
            if (lastSavedId) {
              const lastActive = list.find((f: any) => f.id === lastSavedId && f.isActive !== false);
              if (lastActive) return lastActive.id;
            }
            const activeList = list.filter((f: any) => f.isActive !== false);
            if (activeList.length > 0) {
              const defaultOne = activeList.find((f: any) => f.isDefault) || activeList[0];
              return defaultOne.id;
            }
            return null;
          });
        }
      } catch {}
    },
    [isEdit, initialData?.formulaProductId, nutritionFetch]
  );

  useEffect(() => {
    fetchFormulas();
  }, [fetchFormulas]);

  const activeFormulaProducts = useMemo(() => {
    return formulaProducts.filter((f) => f.isActive !== false);
  }, [formulaProducts]);

  const displayFormulaProducts = useMemo(() => {
    const selectedItem = formulaProducts.find((f) => f.id === selectedFormulaId);
    if (selectedItem && selectedItem.isActive === false) {
      return [selectedItem, ...activeFormulaProducts];
    }
    return activeFormulaProducts;
  }, [formulaProducts, selectedFormulaId, activeFormulaProducts]);

  const selectedFormula = useMemo(() => {
    return formulaProducts.find((f) => f.id === selectedFormulaId) || null;
  }, [formulaProducts, selectedFormulaId]);

  const totalNursingMin = leftMin + rightMin;
  const estimatedBreastMl = estimateNursingVolumeMl(leftMin, rightMin);
  const effectiveBreastMl = customBreastMl ?? estimatedBreastMl;

  const handleFormSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    let finalNotes = notes.trim();
    if (tookVitaminD) {
      finalNotes = finalNotes ? `${finalNotes} (已补充维生素D)` : "已补充维生素D";
    }

    let timestamp: string;
    if (isEdit && initialData?.timestamp) {
      const origDateStr = getLocalDateStr(new Date(initialData.timestamp));
      timestamp = new Date(`${origDateStr}T${time}:00+08:00`).toISOString();
    } else {
      timestamp = isNow ? new Date().toISOString() : localTimeToUtcIso(time);
    }

    if (selectedFormulaId && typeof window !== "undefined") {
      try {
        localStorage.setItem("last_selected_formula_id", selectedFormulaId);
      } catch {}
    }

    await onSubmit({
      type: feedingType,
      amountMl:
        feedingType === "formula" || feedingType === "bottle_breast" || feedingType === "mixed"
          ? Number(amount)
          : (customBreastMl ?? (estimatedBreastMl > 0 ? estimatedBreastMl : null)),
      leftMinutes: feedingType === "breast" || feedingType === "mixed" ? leftMin : null,
      rightMinutes: feedingType === "breast" || feedingType === "mixed" ? rightMin : null,
      spitUp,
      notes: finalNotes || undefined,
      timestamp,
      formulaProductId: (feedingType === "formula" || feedingType === "mixed") ? selectedFormulaId : null,
    });

    if (!isEdit && typeof window !== "undefined") {
      try {
        localStorage.removeItem("baby_active_nursing_timer");
      } catch {}
    }
  };

  return (
    <div className="space-y-4">
      {/* Quick AI Advisor & Voice (Only in Create Mode) */}
      {!isEdit && (
        <>
          <div className="flex items-center justify-between bg-white dark:bg-card px-3.5 py-2.5 rounded-2xl border border-primary/20 shadow-2xs">
            <div className="flex items-center gap-2">
              <span className="text-base">🍼</span>
              <span className="text-xs font-medium text-text-primary">遇到吐奶/胀气或奶量疑问？</span>
            </div>
            <QuickAiButton
              contextType="feeding"
              label="喂养顾问"
              contextTitle="喂养与胀气拍嗝顾问"
              variant="compact"
            />
          </div>
          <VoiceConfirmEntry contextType="feeding" />
        </>
      )}

      {/* Feeding Type Selector */}
      <CuteCard className="p-3">
        <SegmentControl
          options={[
            { value: "breast", label: "🤱 母乳亲喂" },
            { value: "formula", label: "🍼 配方奶粉" },
            { value: "bottle_breast", label: "🍼 瓶喂母乳" },
            { value: "mixed", label: "🥛 混合喂养" },
          ]}
          value={feedingType}
          onChange={(v) => setFeedingType(v as FeedingType)}
        />
      </CuteCard>

      {/* 🤱 母乳亲喂：双侧秒表与时长调整 */}
      {(feedingType === "breast" || feedingType === "mixed") && (
        <CuteCard className="p-4 space-y-4 bg-gradient-to-br from-pink-50/70 to-purple-50/40 border border-pink-100">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold text-pink-900 flex items-center gap-1.5">
                <Clock size={15} className="text-primary" />
                母乳亲喂时长
              </h3>
              <p className="text-[10px] text-text-muted mt-0.5">
                {isEdit ? "直接调整两侧亲喂分钟数" : "支持实时秒表计时或直接调节分钟数"}
              </p>
            </div>
            <div className="text-right">
              <span className="text-xs text-text-secondary">总时长</span>
              <p className="text-base font-extrabold text-primary">{totalNursingMin} 分钟</p>
            </div>
          </div>

          {/* Left & Right Dual Cards (Stopwatch isolated in leaf component) */}
          <NursingDualTimer
            isEdit={isEdit}
            initialLeftMin={leftMin}
            initialRightMin={rightMin}
            onChange={handleNursingDurationChange}
          />

          {/* 预估母乳奶量与微调 */}
          <div className="p-3 bg-white/90 rounded-2xl border border-pink-200/80 flex items-center justify-between shadow-2xs">
            <div className="flex items-center gap-2">
              <span className="text-lg">🍼</span>
              <div>
                <div className="text-xs font-bold text-text-primary flex items-center gap-1.5">
                  <span>{feedingType === "mixed" ? "母乳部分预估量" : "预估母乳摄入量"}</span>
                  {customBreastMl !== null ? (
                    <span className="text-[10px] bg-pink-100 text-pink-700 px-1.5 py-0.2 rounded font-bold">
                      手动修正
                    </span>
                  ) : (
                    <span className="text-[10px] bg-primary-soft text-primary px-1.5 py-0.2 rounded font-medium">
                      临床模型估算
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-text-muted mt-0.5">
                  {feedingType === "mixed"
                    ? `母乳约${estimatedBreastMl}ml + 配方${amount}ml，合计约${estimatedBreastMl + (amount || 0)}ml`
                    : "按双侧活跃吸吮时长科学折算，支持微调"}
                </p>
              </div>
            </div>

            {feedingType === "mixed" ? (
              <div className="text-right">
                <span className="text-base font-black text-pink-600">
                  {estimatedBreastMl}
                </span>
                <span className="text-[10px] text-text-muted ml-0.5">ml</span>
                <span className="block text-[9px] text-primary">按分钟自动折算</span>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setCustomBreastMl(Math.max(0, effectiveBreastMl - 10))}
                  className="w-7 h-7 rounded-full bg-pink-50 text-pink-700 border border-pink-200 text-xs font-bold flex items-center justify-center btn-press hover:bg-pink-100"
                  title="-10ml"
                >
                  -
                </button>
                <div className="min-w-[52px] text-center">
                  <span className="text-base font-black text-pink-600">
                    {effectiveBreastMl}
                  </span>
                  <span className="text-[10px] text-text-muted ml-0.5">ml</span>
                </div>
                <button
                  type="button"
                  onClick={() => setCustomBreastMl(effectiveBreastMl + 10)}
                  className="w-7 h-7 rounded-full bg-pink-50 text-pink-700 border border-pink-200 text-xs font-bold flex items-center justify-center btn-press hover:bg-pink-100"
                  title="+10ml"
                >
                  +
                </button>
                {customBreastMl !== null && (
                  <button
                    type="button"
                    onClick={() => setCustomBreastMl(null)}
                    className="text-[10px] text-text-muted hover:text-pink-600 underline ml-1 cursor-pointer"
                    title="恢复自动估算"
                  >
                    重置
                  </button>
                )}
              </div>
            )}
          </div>
        </CuteCard>
      )}

      {/* 🍼 配方奶 / 瓶喂母乳：刻度预设与微调 */}
      {(feedingType === "formula" || feedingType === "bottle_breast" || feedingType === "mixed") && (
        <CuteCard className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wider">
              {feedingType === "bottle_breast" ? "瓶喂母乳量" : "配方奶量"}
            </h3>
            <span className="text-xs text-text-muted">点击或微调奶量</span>
          </div>

          {/* 🍼 奶粉选择与快捷管理 (在配方奶或混合喂养时始终展示) */}
          {(feedingType === "formula" || feedingType === "mixed") && (
            <div className="p-3 bg-primary-light/35 dark:bg-card/70 rounded-2xl space-y-2 border border-primary/20 shadow-2xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-bold text-text-primary">🍼 正在喝的奶粉</span>
                  {selectedFormula && (
                    <span className="text-[10px] text-text-muted">
                      ({((selectedFormula.reconstitutionRatio || 0.135) * 100).toFixed(1)}% 冲调浓度
                      {selectedFormula.waterPerScoopMl ? ` · ${selectedFormula.waterPerScoopMl}ml/勺` : ""})
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setIsFormulaModalOpen(true)}
                  className="text-[11px] text-primary font-bold hover:underline flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <Settings2 size={12} />
                  <span>{activeFormulaProducts.length > 0 ? "管理/换奶" : "+ 添加奶粉"}</span>
                </button>
              </div>

              {activeFormulaProducts.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {displayFormulaProducts.map((f) => {
                    const isSelected = selectedFormulaId === f.id;
                    const isArchived = f.isActive === false;
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setSelectedFormulaId(f.id)}
                        className={`relative px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 btn-press cursor-pointer ${
                          isSelected
                            ? "bg-primary text-white shadow-button ring-2 ring-primary/40"
                            : "bg-white dark:bg-card text-text-secondary hover:bg-gray-50 border border-divider"
                        }`}
                      >
                        <span className="truncate max-w-[150px]">{f.name}</span>
                        {f.isDefault && (
                          <span
                            className={`text-[9px] px-1.5 py-0.2 rounded-full font-bold leading-tight ${
                              isSelected ? "bg-white/30 text-white" : "bg-primary-soft text-primary"
                            }`}
                          >
                            主力
                          </span>
                        )}
                        {isArchived && (
                          <span className="text-[9px] px-1 py-0.2 rounded-full bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                            已归档
                          </span>
                        )}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setIsFormulaModalOpen(true)}
                    className="px-2.5 py-1.5 rounded-xl text-xs font-medium text-text-muted hover:text-primary border border-dashed border-divider hover:border-primary/40 bg-white/50 dark:bg-white/5 flex items-center gap-1 btn-press cursor-pointer"
                    title="添加或管理正在喝的奶粉"
                  >
                    <Plus size={12} />
                    <span>管理/添加</span>
                  </button>
                </div>
              ) : (
                <div className="py-2.5 px-3 bg-white/80 dark:bg-card rounded-xl border border-divider/60 flex items-center justify-between gap-2">
                  <div className="text-[11px] text-text-muted">
                    尚未添加宝宝正在喝的奶粉
                  </div>
                  <CuteButton
                    type="button"
                    size="sm"
                    variant="primary"
                    onClick={() => setIsFormulaModalOpen(true)}
                  >
                    + 快速添加正在喝的奶粉
                  </CuteButton>
                </div>
              )}
            </div>
          )}

          {/* Big Amount Display */}
          <div className="flex items-center justify-center gap-4 py-2">
            <button
              type="button"
              onClick={() => setAmount(Math.max(10, amount - 10))}
              className="w-10 h-10 rounded-full bg-primary-light text-primary flex items-center justify-center btn-press font-bold hover:bg-primary/20"
            >
              <Minus size={18} />
            </button>

            <div className="text-center">
              <div className="text-5xl font-black text-primary tracking-tight">
                {amount}
              </div>
              <span className="text-xs font-semibold text-text-muted">毫升 (ml)</span>
            </div>

            <button
              type="button"
              onClick={() => setAmount(amount + 10)}
              className="w-10 h-10 rounded-full bg-primary-light text-primary flex items-center justify-center btn-press font-bold hover:bg-primary/20"
            >
              <Plus size={18} />
            </button>
          </div>

          {/* Quick Presets */}
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            {FORMULA_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setAmount(p)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap btn-press ${
                  amount === p
                    ? "bg-primary text-white shadow-button scale-105"
                    : "bg-gray-100 text-text-secondary hover:bg-primary-soft"
                }`}
              >
                {p}ml
              </button>
            ))}
          </div>
        </CuteCard>
      )}

      {/* 🕒 时间选择 */}
      <CuteCard className="p-4 space-y-3">
        <FormSection title="记录时间">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <CuteInput
                type="time"
                value={time}
                onChange={(e) => {
                  setTime(e.target.value);
                  setIsNow(false);
                }}
              />
            </div>
            {!isEdit && (
              <button
                type="button"
                onClick={() => {
                  setTime(getLocalTimeStr());
                  setIsNow(true);
                }}
                className={`px-4 py-2.5 rounded-2xl text-xs font-bold transition-all whitespace-nowrap btn-press ${
                  isNow
                    ? "bg-primary text-white shadow-button"
                    : "bg-primary-light text-primary hover:bg-primary-soft"
                }`}
              >
                刚刚 / 现在
              </button>
            )}
          </div>
        </FormSection>

        {/* 吐奶与补充剂开关 */}
        <div className="pt-2 border-t border-divider/60 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-text-primary block">
                ⚠️ 吐奶 / 溢奶情况
              </span>
              <span className="text-[10px] text-text-muted">记录是否有大口吐奶或溢奶</span>
            </div>
            <button
              type="button"
              onClick={() => setSpitUp(!spitUp)}
              className={`px-3 py-1 rounded-full text-xs font-bold transition-all whitespace-nowrap btn-press ${
                spitUp
                  ? "bg-red-500 text-white shadow-sm"
                  : "bg-gray-100 text-text-muted"
              }`}
            >
              {spitUp ? "有吐奶 🚨" : "正常无吐奶"}
            </button>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div>
              <span className="text-xs font-semibold text-text-primary block">
                💊 维生素 D3 打卡
              </span>
              <span className="text-[10px] text-text-muted">已随本顿喂养补充维生素D</span>
            </div>
            <button
              type="button"
              onClick={() => setTookVitaminD(!tookVitaminD)}
              className={`px-3 py-1 rounded-full text-xs font-bold transition-all whitespace-nowrap btn-press ${
                tookVitaminD
                  ? "bg-mint text-white shadow-sm"
                  : "bg-gray-100 text-text-muted"
              }`}
            >
              {tookVitaminD ? "已吃 D3 ✨" : "未吃"}
            </button>
          </div>
        </div>

        <FormSection title="备注说明（可选）">
          <CuteInput
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="如：吃得很香 / 拍嗝顺畅 / 换了新奶嘴"
          />
        </FormSection>
      </CuteCard>

      {/* Buttons */}
      <div className="pt-2 flex gap-3">
        {isEdit && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-3 rounded-full border border-primary-soft text-text-secondary text-sm font-medium btn-press hover:bg-gray-50"
          >
            取消
          </button>
        )}
        <CuteButton
          variant="primary"
          size="lg"
          fullWidth={!isEdit}
          onClick={() => handleFormSubmit()}
          disabled={saving}
          className={`flex items-center justify-center gap-2 ${isEdit ? "flex-1" : ""}`}
        >
          <CheckCircle2 size={18} />
          {saving ? "保存中..." : isEdit ? "保存修改" : "保存喂养记录"}
        </CuteButton>
      </div>
      <QuickFormulaManageModal
        babyId={initialData?.babyId}
        isOpen={isFormulaModalOpen}
        onClose={() => setIsFormulaModalOpen(false)}
        selectedFormulaId={selectedFormulaId}
        onSelectFormula={(id) => {
          setSelectedFormulaId(id);
          setIsFormulaModalOpen(false);
        }}
        onFormulasChanged={(newSelectedId) => {
          fetchFormulas(newSelectedId);
        }}
      />
    </div>
  );
}
