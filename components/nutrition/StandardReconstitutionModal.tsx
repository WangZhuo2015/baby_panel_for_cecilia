"use client";

import { useState } from "react";
import { X, Check, Calculator, AlertCircle, Info } from "lucide-react";
import { CuteButton } from "@/components/ui/CuteButton";
import { CuteInput } from "@/components/ui/CuteInput";

export interface StandardReconstitutionModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialScoopWeightG?: number;
  initialWaterPerScoopMl?: number;
  initialRatio?: number;
  productName?: string;
  onConfirm: (data: {
    scoopWeightG: number;
    waterPerScoopMl: number;
    reconstitutionRatio: number;
  }) => void;
}

export function StandardReconstitutionModal({
  isOpen,
  onClose,
  initialScoopWeightG = 4.3,
  initialWaterPerScoopMl = 30.0,
  initialRatio = 0.135,
  productName = "配方奶粉",
  onConfirm,
}: StandardReconstitutionModalProps) {
  const [scoopWeight, setScoopWeight] = useState<number>(initialScoopWeightG);
  const [waterPerScoop, setWaterPerScoop] = useState<number>(initialWaterPerScoopMl);
  const [isCustom, setIsCustom] = useState<boolean>(false);

  if (!isOpen) return null;

  // 冲调浓度公式：干粉质量 / (加水量 + 粉溶解体积)，通常 1勺4.3g配30ml水 ≈ 13.5% (0.135 g/ml)
  const computedRatio =
    waterPerScoop > 0
      ? Number((scoopWeight / (waterPerScoop + scoopWeight * 0.7)).toFixed(4))
      : 0.135;

  const standardRatioPercent = (computedRatio * 100).toFixed(1);

  const handleSave = () => {
    onConfirm({
      scoopWeightG: Number(scoopWeight) || 4.3,
      waterPerScoopMl: Number(waterPerScoop) || 30.0,
      reconstitutionRatio: computedRatio,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-fadeIn">
      <div className="bg-white rounded-3xl p-5 max-w-md w-full shadow-card border border-primary/20 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <Calculator size={18} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-text-primary">标准冲调比例确认</h3>
              <p className="text-[11px] text-text-muted">{productName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full text-text-muted hover:bg-gray-100 flex items-center justify-center"
          >
            <X size={16} />
          </button>
        </div>

        {/* 说明卡片 */}
        <div className="p-3 bg-sky-50 rounded-2xl border border-sky-100 flex items-start gap-2.5">
          <Info size={16} className="text-sky-600 shrink-0 mt-0.5" />
          <div className="text-xs text-sky-900 leading-relaxed">
            <p className="font-bold">为什么需要确认冲调比例？</p>
            <p className="text-[11px] text-sky-800 mt-0.5">
              系统将根据此比例把每次喂奶量（ml）折算为干粉克重，以精准统计维生素D、钙、铁、DHA等营养素摄入。
            </p>
          </div>
        </div>

        {/* 预设与微调 */}
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 rounded-2xl bg-gray-50 border border-gray-200/70">
            <div>
              <span className="text-xs font-bold text-text-primary block">标准一平勺粉重</span>
              <span className="text-[10px] text-text-muted">通常包装说明为 4.3g ~ 4.5g</span>
            </div>
            <div className="flex items-center gap-1">
              <CuteInput
                type="number"
                step="0.1"
                min="1"
                max="15"
                value={String(scoopWeight)}
                onChange={(e) => {
                  setScoopWeight(Number(e.target.value) || 0);
                  setIsCustom(true);
                }}
                className="w-20 text-center font-bold text-primary"
              />
              <span className="text-xs text-text-secondary font-medium">克 (g)</span>
            </div>
          </div>

          <div className="flex items-center justify-between p-3 rounded-2xl bg-gray-50 border border-gray-200/70">
            <div>
              <span className="text-xs font-bold text-text-primary block">对应温开水量</span>
              <span className="text-[10px] text-text-muted">通常每平勺对应 30ml 或 50ml 水</span>
            </div>
            <div className="flex items-center gap-1">
              <CuteInput
                type="number"
                step="5"
                min="10"
                max="100"
                value={String(waterPerScoop)}
                onChange={(e) => {
                  setWaterPerScoop(Number(e.target.value) || 0);
                  setIsCustom(true);
                }}
                className="w-20 text-center font-bold text-primary"
              />
              <span className="text-xs text-text-secondary font-medium">毫升 (ml)</span>
            </div>
          </div>

          {/* 计算结果展示 */}
          <div className="p-3 bg-gradient-to-r from-primary-light to-lavender/20 rounded-2xl flex items-center justify-between">
            <span className="text-xs text-text-secondary font-medium">折算干粉冲调浓度：</span>
            <div className="text-right">
              <span className="text-base font-extrabold text-primary">{standardRatioPercent}%</span>
              <span className="text-[10px] text-text-muted block">约 {(computedRatio * 100).toFixed(2)}g 粉 / 100ml 奶</span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2.5 pt-2">
          <button
            type="button"
            onClick={() => {
              setScoopWeight(4.3);
              setWaterPerScoop(30.0);
              setIsCustom(false);
            }}
            className="px-3.5 py-2.5 rounded-full border border-gray-200 text-xs text-text-secondary hover:bg-gray-50 font-medium"
          >
            恢复默认 (4.3g:30ml)
          </button>
          <CuteButton
            variant="primary"
            fullWidth
            onClick={handleSave}
            className="flex items-center justify-center gap-1.5"
          >
            <Check size={16} />
            确认冲调比例
          </CuteButton>
        </div>
      </div>
    </div>
  );
}
