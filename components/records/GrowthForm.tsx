"use client";

import { useState, useRef } from "react";
import { Upload, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { CuteButton } from "@/components/ui/CuteButton";
import { CuteInput } from "@/components/ui/CuteInput";
import { CuteCard } from "@/components/ui/CuteCard";
import { FormSection } from "@/components/ui/FormSection";
import { SegmentControl } from "@/components/ui/SegmentControl";
import { useToast } from "@/components/ui/Toast";
import { VoiceConfirmEntry } from "@/components/ui/VoiceConfirmEntry";
import { QuickAiButton } from "@/components/ui/QuickAiButton";
import { getLocalDateStr } from "@/lib/date";
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
  const [ocrDone, setOcrDone] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(initialData?.imageUrl || null);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(
    initialData?.imageUrl || null
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleOcrUpload = async (file: File | null | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("请选择图片文件");
      return;
    }
    setOcrLoading(true);
    setOcrError(null);
    setOcrDone(false);
    setImagePreview(URL.createObjectURL(file));
    try {
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch("/api/growth/ocr", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setOcrError(data.error || "识别失败，请手动输入");
        return;
      }
      if (data.date) setDate(data.date);
      if (data.weightKg != null) setWeight(String(data.weightKg));
      if (data.heightCm != null) setHeight(String(data.heightCm));
      if (data.headCircumferenceCm != null) setHead(String(data.headCircumferenceCm));
      if (data.imageUrl) setUploadedImageUrl(data.imageUrl);
      setOcrDone(true);
    } catch {
      setOcrError("识别服务连接失败，请手动输入");
    } finally {
      setOcrLoading(false);
    }
  };

  const handleFormSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!weight && !height && !head) {
      showToast("请至少输入一项测量数据");
      return;
    }

    await onSubmit({
      date,
      weightKg: weight ? parseFloat(weight) : undefined,
      heightCm: height ? parseFloat(height) : undefined,
      headCircumferenceCm: head ? parseFloat(head) : undefined,
      imageUrl: uploadedImageUrl || undefined,
    });
  };

  return (
    <div className="space-y-4">
      {/* Quick AI & Voice Entry */}
      {!isEdit && (
        <>
          <div className="flex items-center justify-between bg-white dark:bg-card px-3.5 py-2.5 rounded-2xl border border-primary/20 shadow-2xs">
            <div className="flex items-center gap-2">
              <span className="text-base">📈</span>
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
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => handleOcrUpload(e.target.files?.[0])}
          />
          <CuteCard className="p-4">
            <div className="flex flex-col items-center py-4">
              {imagePreview ? (
                <div className="w-36 h-36 rounded-2xl overflow-hidden mb-3 border border-primary/20">
                  <img
                    src={imagePreview}
                    alt="测量照片预览"
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div className="w-14 h-14 rounded-full bg-primary-light flex items-center justify-center mb-3">
                  {ocrLoading ? (
                    <Loader2 size={24} className="text-primary animate-spin" />
                  ) : (
                    <Upload size={24} className="text-primary" />
                  )}
                </div>
              )}
              {!ocrLoading ? (
                ocrDone ? (
                  <>
                    <p className="text-xs font-medium text-mint mb-2">识别完成，请核对下方数据</p>
                    <button
                      type="button"
                      onClick={() => {
                        fileInputRef.current?.click();
                        setOcrDone(false);
                      }}
                      className="text-xs text-primary underline font-medium"
                    >
                      重新拍照识别
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-text-secondary mb-3">上传儿童体检单或手写测量记录</p>
                    <div className="flex gap-2">
                      <CuteButton
                        variant="primary"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        拍照上传
                      </CuteButton>
                      <CuteButton
                        variant="secondary"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        从相册选
                      </CuteButton>
                    </div>
                  </>
                )
              ) : (
                <p className="text-xs text-text-secondary">AI 智能识别体检单中...</p>
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
        <FormSection title="测量日期">
          <CuteInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </FormSection>
        <FormSection title="体重 (kg)">
          <CuteInput
            type="number"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            step="0.01"
            placeholder="例: 7.35"
          />
        </FormSection>
        <FormSection title="身长 (cm)">
          <CuteInput
            type="number"
            value={height}
            onChange={(e) => setHeight(e.target.value)}
            step="0.1"
            placeholder="例: 67.2"
          />
        </FormSection>
        <FormSection title="头围 (cm)">
          <CuteInput
            type="number"
            value={head}
            onChange={(e) => setHead(e.target.value)}
            step="0.1"
            placeholder="例: 42.1"
          />
        </FormSection>
      </div>

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
          disabled={saving}
          className={`flex items-center justify-center gap-2 ${isEdit ? "flex-1" : ""}`}
        >
          <CheckCircle2 size={18} />
          {saving ? "保存中..." : isEdit ? "保存修改" : "保存测量记录"}
        </CuteButton>
      </div>
    </div>
  );
}
