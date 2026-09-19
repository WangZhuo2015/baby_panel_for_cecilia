"use client";

import { useState, useRef } from "react";
import Image from "next/image";
import {
  Upload,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Camera,
  Image as ImageIcon,
  Calendar,
  Scale,
  Ruler,
  CircleDot,
  TrendingUp,
  RefreshCw,
} from "lucide-react";
import { CuteButton } from "@/components/ui/CuteButton";
import { CuteInput } from "@/components/ui/CuteInput";
import { CuteCard } from "@/components/ui/CuteCard";
import { FormSection } from "@/components/ui/FormSection";
import { SegmentControl } from "@/components/ui/SegmentControl";
import { useToast } from "@/components/ui/Toast";
import { VoiceConfirmEntry } from "@/components/ui/VoiceConfirmEntry";
import { QuickAiButton } from "@/components/ui/QuickAiButton";
import { getLocalDateStr } from "@/lib/date";
import { compressImageForOcr } from "@/lib/upload";
import { useBabyStore } from "@/stores/useBabyStore";
import { WhoPercentileBreakdown } from "@/components/growth/WhoPercentileCard";
import { getWhoMetricsForBaby } from "@/lib/who-growth-standards";
import type { GrowthMeasurement } from "@/types";

type InputMode = "manual" | "ocr";

export interface GrowthFormProps {
  mode?: "create" | "edit";
  initialData?: Partial<GrowthMeasurement>;
  onSubmit: (data: {
    date: string;
    weightKg?: number;
    heightCm?: number;
    headCircumferenceCm?: number;
    imageUrl?: string;
  }) => Promise<void>;
  onCancel?: () => void;
  saving?: boolean;
}

export function GrowthForm({
  mode: formMode = "create",
  initialData,
  onSubmit,
  onCancel,
  saving = false,
}: GrowthFormProps) {
  const isEdit = formMode === "edit";
  const { showToast } = useToast();
  const { baby } = useBabyStore();

  const [inputMode, setInputMode] = useState<InputMode>("manual");
  const [date, setDate] = useState(() => initialData?.date || getLocalDateStr());
  const [weight, setWeight] = useState(() =>
    initialData?.weightKg != null ? String(initialData.weightKg) : ""
  );
  const [height, setHeight] = useState(() =>
    initialData?.heightCm != null ? String(initialData.heightCm) : ""
  );
  const [head, setHead] = useState(() =>
    initialData?.headCircumferenceCm != null ? String(initialData.headCircumferenceCm) : ""
  );

  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrElapsed, setOcrElapsed] = useState(0);
  const [ocrDone, setOcrDone] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(initialData?.imageUrl || null);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(
    initialData?.imageUrl || null
  );
  const [internalSaving, setInternalSaving] = useState(false);
  const isSaving = saving || internalSaving;

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const handleOcrUpload = async (file: File | null | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("请选择图片文件");
      return;
    }
    setOcrLoading(true);
    setOcrElapsed(0);
    setOcrError(null);
    setOcrDone(false);
    setImagePreview(URL.createObjectURL(file));

    const timer = setInterval(() => {
      setOcrElapsed((s) => s + 1);
    }, 1000);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);

    try {
      // 1. 客户端秒级压缩高分辨率照片（由 10MB 压至 ~300KB），大幅加速网络上传与 AI 解析
      const compressed = await compressImageForOcr(file);

      const formData = new FormData();
      formData.append("image", compressed);
      const res = await fetch("/api/growth/ocr", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const data = await res.json();
      if (!res.ok) {
        setOcrError(data.error || "识别未能提取到有效数据，请手动核对录入");
        return;
      }
      if (data.date) setDate(data.date);
      if (data.weightKg != null) setWeight(String(data.weightKg));
      if (data.heightCm != null) setHeight(String(data.heightCm));
      if (data.headCircumferenceCm != null) setHead(String(data.headCircumferenceCm));
      if (data.imageUrl) setUploadedImageUrl(data.imageUrl);
      setOcrDone(true);
      showToast("识别完成！请核对下方数据 ✨");
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err?.name === "AbortError") {
        setOcrError("识别响应超时（已超过45秒），建议直接手动输入或换用清晰局部照片");
      } else {
        setOcrError(err?.message || "识别服务连接失败，请手动输入");
      }
    } finally {
      clearInterval(timer);
      setOcrLoading(false);
    }
  };

  const handleFormSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isSaving) return; // Prevent double submit
    if (!weight && !height && !head) {
      showToast("请至少输入一项测量数据");
      return;
    }

    setInternalSaving(true);
    try {
      await onSubmit({
        date,
        weightKg: weight ? parseFloat(weight) : undefined,
        heightCm: height ? parseFloat(height) : undefined,
        headCircumferenceCm: head ? parseFloat(head) : undefined,
        imageUrl: uploadedImageUrl || undefined,
      });
    } finally {
      setInternalSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Quick AI & Voice Entry */}
      {!isEdit && (
        <>
          <div className="flex items-center justify-between bg-white dark:bg-card px-3.5 py-2.5 rounded-2xl border border-primary/20 shadow-2xs">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-primary-light flex items-center justify-center text-primary shrink-0">
                <TrendingUp size={15} />
              </div>
              <span className="text-xs font-medium text-text-primary">生长曲线或百分位疑问？</span>
            </div>
            <QuickAiButton
              contextType="growth"
              label="生长顾问"
              contextTitle="WHO 生长曲线顾问"
              variant="compact"
            />
          </div>
          <VoiceConfirmEntry contextType="growth" />
        </>
      )}

      {/* Input Mode Selector */}
      {!isEdit && (
        <FormSection title="录入方式">
          <SegmentControl
            options={[
              { value: "manual", label: "✍️ 手动填写" },
              { value: "ocr", label: "📸 拍照识别" },
            ]}
            value={inputMode}
            onChange={(v) => setInputMode(v as InputMode)}
          />
        </FormSection>
      )}

      {inputMode === "ocr" && !isEdit && (
        <>
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              handleOcrUpload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              handleOcrUpload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <CuteCard className="p-4">
            <div className="flex flex-col items-center py-4">
              {imagePreview ? (
                <div className="w-36 h-36 rounded-2xl overflow-hidden mb-3 border border-primary/20">
                  <Image
                    src={imagePreview}
                    alt="测量照片预览"
                    width={144}
                    height={144}
                    unoptimized={imagePreview.startsWith("data:") || imagePreview.startsWith("blob:") || imagePreview.startsWith("/api/attachments/")}
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div className="w-14 h-14 rounded-full bg-gradient-to-br from-primary-light to-primary/10 flex items-center justify-center mb-3 shadow-inner">
                  {ocrLoading ? (
                    <Loader2 size={24} className="text-primary animate-spin" />
                  ) : (
                    <Camera size={24} className="text-primary" />
                  )}
                </div>
              )}
              {!ocrLoading ? (
                ocrDone ? (
                  <>
                    <p className="text-xs font-medium text-mint mb-2 flex items-center gap-1">
                      <CheckCircle2 size={14} /> 识别完成，请核对下方数据
                    </p>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          cameraInputRef.current?.click();
                          setOcrDone(false);
                        }}
                        className="text-xs text-primary underline font-medium flex items-center gap-1 cursor-pointer"
                      >
                        <Camera size={13} />
                        重新拍照
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          galleryInputRef.current?.click();
                          setOcrDone(false);
                        }}
                        className="text-xs text-text-secondary underline font-medium flex items-center gap-1 cursor-pointer"
                      >
                        <ImageIcon size={13} />
                        从相册重选
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-text-secondary mb-3">上传儿童体检单或手写测量记录</p>
                    <div className="flex gap-2">
                      <CuteButton
                        variant="primary"
                        size="sm"
                        onClick={() => cameraInputRef.current?.click()}
                        className="flex items-center gap-1.5"
                      >
                        <Camera size={15} />
                        拍照上传
                      </CuteButton>
                      <CuteButton
                        variant="secondary"
                        size="sm"
                        onClick={() => galleryInputRef.current?.click()}
                        className="flex items-center gap-1.5"
                      >
                        <ImageIcon size={15} />
                        从相册选
                      </CuteButton>
                    </div>
                  </>
                )
              ) : (
                <div className="text-center py-2 space-y-1">
                  <p className="text-xs font-bold text-primary animate-pulse">
                    AI 正在识别体检单指标（已耗时 {ocrElapsed}s）...
                  </p>
                  <p className="text-[11px] text-text-muted">
                    已自动优化压缩图片，正在提取各项测量指标
                  </p>
                </div>
              )}

              {ocrError && !ocrLoading && (
                <div className="mt-2.5 px-3 py-2 rounded-xl bg-red-50 border border-red-200 flex items-start gap-1.5 max-w-xs">
                  <AlertTriangle size={13} className="text-red-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-600">{ocrError}</p>
                </div>
              )}
            </div>
          </CuteCard>
        </>
      )}

      {/* Manual / Verified Fields */}
      <div className="space-y-3">
        <FormSection
          title={
            <span className="flex items-center gap-1.5 text-text-primary text-xs font-bold">
              <Calendar size={14} className="text-primary" />
              <span>测量日期</span>
            </span>
          }
        >
          <CuteInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </FormSection>
        <FormSection
          title={
            <span className="flex items-center gap-1.5 text-text-primary text-xs font-bold">
              <Scale size={14} className="text-primary" />
              <span>体重 (kg)</span>
            </span>
          }
        >
          <CuteInput
            type="number"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            step="0.01"
            placeholder="例: 7.35"
          />
        </FormSection>
        <FormSection
          title={
            <span className="flex items-center gap-1.5 text-text-primary text-xs font-bold">
              <Ruler size={14} className="text-primary" />
              <span>身长 (cm)</span>
            </span>
          }
        >
          <CuteInput
            type="number"
            value={height}
            onChange={(e) => setHeight(e.target.value)}
            step="0.1"
            placeholder="例: 67.2"
          />
        </FormSection>
        <FormSection
          title={
            <span className="flex items-center gap-1.5 text-text-primary text-xs font-bold">
              <CircleDot size={14} className="text-primary" />
              <span>头围 (cm)</span>
            </span>
          }
        >
          <CuteInput
            type="number"
            value={head}
            onChange={(e) => setHead(e.target.value)}
            step="0.1"
            placeholder="例: 42.1"
          />
        </FormSection>
      </div>

      {/* Live WHO Percentile Evaluation Preview */}
      {(() => {
        const wNum = weight ? parseFloat(weight) : undefined;
        const hNum = height ? parseFloat(height) : undefined;
        const hdNum = head ? parseFloat(head) : undefined;
        const whoMetrics = getWhoMetricsForBaby(baby, date, {
          weightKg: wNum && !Number.isNaN(wNum) && wNum > 0 ? wNum : undefined,
          heightCm: hNum && !Number.isNaN(hNum) && hNum > 0 ? hNum : undefined,
          headCircumferenceCm: hdNum && !Number.isNaN(hdNum) && hdNum > 0 ? hdNum : undefined,
        });

        if (whoMetrics.length === 0) return null;

        return (
          <div className="pt-1">
            <WhoPercentileBreakdown
              metrics={whoMetrics}
              title="WHO 生长发育百分位（实时对照）"
            />
          </div>
        );
      })()}

      {/* Buttons */}
      <div className="pt-2 flex gap-3">
        {isEdit && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-3 rounded-full border border-primary-soft text-text-secondary text-sm font-medium btn-press hover:bg-gray-50 cursor-pointer"
          >
            取消
          </button>
        )}
        <CuteButton
          fullWidth={!isEdit}
          size="lg"
          onClick={() => handleFormSubmit()}
          disabled={isSaving}
          className={`flex items-center justify-center gap-2 ${isEdit ? "flex-1" : ""}`}
        >
          {isSaving ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              <span>保存中...</span>
            </>
          ) : (
            <>
              <CheckCircle2 size={18} />
              <span>{isEdit ? "保存修改" : "保存测量记录"}</span>
            </>
          )}
        </CuteButton>
      </div>
    </div>
  );
}
