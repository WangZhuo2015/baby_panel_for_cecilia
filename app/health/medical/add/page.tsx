"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  Camera,
  Loader2,
  AlertTriangle,
  Plus,
  Trash2,
  CheckCircle2,
  FileText,
} from "lucide-react";
import { AppHeader } from "@/components/ui/AppHeader";
import { CuteButton } from "@/components/ui/CuteButton";
import { CuteInput } from "@/components/ui/CuteInput";
import { CuteCard } from "@/components/ui/CuteCard";
import { FormSection } from "@/components/ui/FormSection";
import { SegmentControl } from "@/components/ui/SegmentControl";
import { useToast } from "@/components/ui/Toast";
import { useBabyStore } from "@/stores/useBabyStore";
import { getLocalDateStr } from "@/lib/date";
import type { MedicalReportCategory, MedicalReportItem } from "@/types";

export default function MedicalAddPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { baby, fetchBaby, addMedicalReport } = useBabyStore();

  useEffect(() => {
    if (!baby) fetchBaby();
  }, [baby, fetchBaby]);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrDone, setOcrDone] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form Fields
  const [title, setTitle] = useState("化验检查报告");
  const [category, setCategory] = useState<MedicalReportCategory>("blood");
  const [date, setDate] = useState(getLocalDateStr());
  const [hospital, setHospital] = useState("");
  const [doctorNotes, setDoctorNotes] = useState("");
  const [aiSummary, setAiSummary] = useState("");
  const [items, setItems] = useState<MedicalReportItem[]>([]);

  // Growth Sync Fields
  const [weightKg, setWeightKg] = useState<string>("");
  const [heightCm, setHeightCm] = useState<string>("");
  const [headCm, setHeadCm] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (file: File | null | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("请选择图片格式文件");
      return;
    }

    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setOcrLoading(true);
    setOcrError(null);
    setOcrDone(false);

    try {
      const formData = new FormData();
      formData.append("image", file);

      const res = await fetch("/api/medical/ocr", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        setOcrError(data.error || "识别未能解析出数据，请核对并手动录入");
        return;
      }

      if (data.title) setTitle(data.title);
      if (data.category) setCategory(data.category);
      if (data.date) setDate(data.date);
      if (data.hospital) setHospital(data.hospital);
      if (data.doctorNotes) setDoctorNotes(data.doctorNotes);
      if (data.aiSummary) setAiSummary(data.aiSummary);
      if (data.imageUrl) setUploadedImageUrl(data.imageUrl);

      if (Array.isArray(data.items)) {
        setItems(
          data.items.map((it: any, idx: number) => ({
            id: `item_${Date.now()}_${idx}`,
            name: it.name || "",
            value: it.value ?? "",
            unit: it.unit || "",
            referenceRange: it.referenceRange || "",
            status: it.status || "normal",
            interpretation: it.interpretation || "",
          }))
        );
      }

      if (data.growthData) {
        if (data.growthData.weightKg) setWeightKg(String(data.growthData.weightKg));
        if (data.growthData.heightCm) setHeightCm(String(data.growthData.heightCm));
        if (data.growthData.headCircumferenceCm) setHeadCm(String(data.growthData.headCircumferenceCm));
      }

      setOcrDone(true);
      showToast("识别完成！请核对并修改下方各项数据 ✨");
    } catch (e: any) {
      setOcrError(e?.message || "AI 识别服务连接失败，请手动录入数据");
    } finally {
      setOcrLoading(false);
    }
  };

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      {
        id: `item_${Date.now()}_${prev.length}`,
        name: "",
        value: "",
        unit: "",
        referenceRange: "",
        status: "normal",
        interpretation: "",
      },
    ]);
  };

  const handleUpdateItem = (id: string, field: keyof MedicalReportItem, val: any) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, [field]: val } : it))
    );
  };

  const handleDeleteItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const handleSave = async () => {
    if (!title.trim()) {
      showToast("请填写单据名称");
      return;
    }
    if (!date) {
      showToast("请选择检验/体检日期");
      return;
    }

    setSaving(true);
    try {
      let finalImageUrl = uploadedImageUrl;
      if (!finalImageUrl && imageFile) {
        const uploadFormData = new FormData();
        uploadFormData.append("file", imageFile);
        const uploadRes = await fetch("/api/medical/upload", {
          method: "POST",
          body: uploadFormData,
        });
        if (uploadRes.ok) {
          const uploadData = await uploadRes.json();
          finalImageUrl = uploadData.imageUrl;
        }
      }

      const growthDataPayload =
        weightKg || heightCm || headCm
          ? {
              weightKg: weightKg ? parseFloat(weightKg) : undefined,
              heightCm: heightCm ? parseFloat(heightCm) : undefined,
              headCircumferenceCm: headCm ? parseFloat(headCm) : undefined,
            }
          : undefined;

      await addMedicalReport({
        title: title.trim(),
        category,
        date,
        hospital: hospital.trim() || undefined,
        doctorNotes: doctorNotes.trim() || undefined,
        aiSummary: aiSummary.trim() || undefined,
        items,
        imageUrl: finalImageUrl,
        growthData: growthDataPayload,
      });

      showToast("报告已成功保存并归档 ✨");
      setTimeout(() => router.push("/health/medical"), 600);
    } catch (e: any) {
      showToast(e?.message || "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-bg max-w-md mx-auto px-4 pt-4 pb-28">
      <AppHeader title="录入化验 / 体检单" showBack />

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFileSelect(e.target.files?.[0])}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFileSelect(e.target.files?.[0])}
      />

      {/* Photo Capture & OCR Card */}
      <CuteCard className="my-4 shadow-card">
        <div className="flex flex-col items-center py-4 text-center">
          {imagePreview ? (
            <div className="w-full h-44 rounded-2xl overflow-hidden mb-3 bg-black/5 relative group border border-divider">
              <img
                src={imagePreview}
                alt="单据预览"
                className="w-full h-full object-contain"
              />
              <div className="absolute top-2 right-2 flex gap-1.5">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-2.5 py-1 rounded-full bg-black/60 text-white text-[11px] font-medium backdrop-blur"
                >
                  重新选择
                </button>
              </div>
            </div>
          ) : (
            <div className="w-16 h-16 rounded-full bg-primary-light flex items-center justify-center mb-3">
              {ocrLoading ? (
                <Loader2 size={30} className="text-primary animate-spin" />
              ) : (
                <FileText size={30} className="text-primary" />
              )}
            </div>
          )}

          {ocrLoading ? (
            <div className="py-2">
              <p className="text-sm font-bold text-primary animate-pulse">
                AI 正在结构化识别单据指标...
              </p>
              <p className="text-xs text-text-muted mt-1">
                支持血常规、体检表、微量元素、过敏原等报告
              </p>
            </div>
          ) : (
            <>
              <p className="text-sm font-bold text-text-primary mb-1">
                {imagePreview ? (ocrDone ? "AI 识别完成，请核对下方内容" : "已加载照片") : "拍照或上传单据照片"}
              </p>
              <p className="text-xs text-text-muted mb-4">
                原图将永久归档，AI 自动提取指标与参考值供随时查阅
              </p>

              <div className="flex gap-2 w-full max-w-xs">
                <CuteButton
                  variant="primary"
                  size="sm"
                  fullWidth
                  onClick={() => cameraInputRef.current?.click()}
                  className="flex items-center justify-center gap-1"
                >
                  <Camera size={16} /> 拍照识别
                </CuteButton>
                <CuteButton
                  variant="secondary"
                  size="sm"
                  fullWidth
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center justify-center gap-1"
                >
                  <Upload size={16} /> 相册选图
                </CuteButton>
              </div>
            </>
          )}

          {ocrError && !ocrLoading && (
            <div className="mt-3 w-full p-3 rounded-xl bg-red-50 border border-red-200 text-left flex items-start gap-2">
              <AlertTriangle size={15} className="text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-red-700">{ocrError}</p>
                <p className="text-[11px] text-red-500 mt-0.5">
                  你可以在下方直接手动录入或修改指标内容。
                </p>
              </div>
            </div>
          )}
        </div>
      </CuteCard>

      {/* Form Fields: Editable Structured Details */}
      <div className="space-y-4">
        {/* Basic Info */}
        <CuteCard className="p-4 space-y-3">
          <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wider">
            基础信息
          </h3>

          <FormSection title="报告名称">
            <CuteInput
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="如：末梢血常规化验单 / 6月龄体检表"
            />
          </FormSection>

          <FormSection title="单据类型">
            <SegmentControl
              options={[
                { value: "blood", label: "血常规" },
                { value: "growth", label: "体检" },
                { value: "trace_element", label: "微量元素" },
                { value: "allergy", label: "过敏原" },
                { value: "general", label: "其他" },
              ]}
              value={category}
              onChange={(v) => setCategory(v as MedicalReportCategory)}
            />
          </FormSection>

          <div className="space-y-3">
            <FormSection title="检验 / 体检日期">
              <CuteInput
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </FormSection>
            <FormSection title="就诊医院 / 机构">
              <CuteInput
                value={hospital}
                onChange={(e) => setHospital(e.target.value)}
                placeholder="如：苏州市儿童医院"
              />
            </FormSection>
          </div>
        </CuteCard>

        {/* Growth Measurement Sync (Optional) */}
        {(category === "growth" || weightKg || heightCm || headCm) && (
          <CuteCard className="p-4 space-y-3 bg-blue-50/40 border border-blue-100">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-blue-900 flex items-center gap-1.5">
                📏 生长指标同步（将同时更新宝宝成长曲线）
              </h3>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[11px] text-text-muted block mb-1">体重 (kg)</label>
                <CuteInput
                  type="number"
                  step="0.01"
                  value={weightKg}
                  onChange={(e) => setWeightKg(e.target.value)}
                  placeholder="kg"
                />
              </div>
              <div>
                <label className="text-[11px] text-text-muted block mb-1">身长 (cm)</label>
                <CuteInput
                  type="number"
                  step="0.1"
                  value={heightCm}
                  onChange={(e) => setHeightCm(e.target.value)}
                  placeholder="cm"
                />
              </div>
              <div>
                <label className="text-[11px] text-text-muted block mb-1">头围 (cm)</label>
                <CuteInput
                  type="number"
                  step="0.1"
                  value={headCm}
                  onChange={(e) => setHeadCm(e.target.value)}
                  placeholder="cm"
                />
              </div>
            </div>
          </CuteCard>
        )}

        {/* Indicators Table Editor (Core Request) */}
        <CuteCard className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wider">
                检测指标明细 ({items.length} 项)
              </h3>
              <p className="text-[10px] text-text-muted">
                点击各项可直接修改名称、结果、参考值与异常状态
              </p>
            </div>
            <button
              type="button"
              onClick={handleAddItem}
              className="text-xs text-primary font-semibold flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary-soft hover:bg-primary/20 transition-colors"
            >
              <Plus size={14} /> 添加指标
            </button>
          </div>

          {items.length === 0 ? (
            <div className="text-center py-6 border-2 border-dashed border-divider rounded-2xl">
              <p className="text-xs text-text-muted mb-2">未添加检测指标</p>
              <CuteButton size="sm" variant="secondary" onClick={handleAddItem}>
                <Plus size={14} className="mr-1" /> 手动添加检测项
              </CuteButton>
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item, idx) => (
                <div
                  key={item.id || idx}
                  className="p-3 rounded-2xl bg-gray-50/80 border border-divider space-y-2 relative"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <input
                      type="text"
                      placeholder="项目名称 (如 白细胞计数 WBC)"
                      value={item.name}
                      onChange={(e) => handleUpdateItem(item.id, "name", e.target.value)}
                      className="flex-1 text-xs font-bold text-text-primary bg-transparent border-b border-divider/60 focus:border-primary focus:outline-none pb-0.5"
                    />
                    <button
                      type="button"
                      onClick={() => handleDeleteItem(item.id)}
                      className="text-gray-400 hover:text-red-500 p-1"
                      title="删除此项"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[10px] text-text-muted block">检测结果</label>
                      <input
                        type="text"
                        placeholder="结果值"
                        value={item.value}
                        onChange={(e) => handleUpdateItem(item.id, "value", e.target.value)}
                        className="w-full text-xs font-semibold text-text-primary bg-white border border-divider rounded-lg px-2 py-1 focus:border-primary focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-text-muted block">单位</label>
                      <input
                        type="text"
                        placeholder="单位(如 g/L)"
                        value={item.unit || ""}
                        onChange={(e) => handleUpdateItem(item.id, "unit", e.target.value)}
                        className="w-full text-xs text-text-secondary bg-white border border-divider rounded-lg px-2 py-1 focus:border-primary focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-text-muted block">参考范围</label>
                      <input
                        type="text"
                        placeholder="参考区间"
                        value={item.referenceRange || ""}
                        onChange={(e) => handleUpdateItem(item.id, "referenceRange", e.target.value)}
                        className="w-full text-xs text-text-secondary bg-white border border-divider rounded-lg px-2 py-1 focus:border-primary focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Status buttons */}
                  <div className="flex items-center gap-1 pt-1">
                    <span className="text-[10px] text-text-muted mr-1">指标状态:</span>
                    {[
                      { val: "normal", label: "正常", style: "text-mint border-mint/40 bg-mint/10" },
                      { val: "high", label: "↑ 偏高", style: "text-red-600 border-red-300 bg-red-50" },
                      { val: "low", label: "↓ 偏低", style: "text-blue-600 border-blue-300 bg-blue-50" },
                      { val: "abnormal", label: "异常", style: "text-amber-600 border-amber-300 bg-amber-50" },
                    ].map((st) => (
                      <button
                        key={st.val}
                        type="button"
                        onClick={() => handleUpdateItem(item.id, "status", st.val)}
                        className={`text-[10px] px-2 py-0.5 rounded-md border transition-all ${
                          item.status === st.val
                            ? `${st.style} font-bold shadow-sm`
                            : "text-text-muted border-divider bg-white hover:border-gray-300"
                        }`}
                      >
                        {st.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CuteCard>

        {/* Doctor & AI Summary */}
        <CuteCard className="p-4 space-y-3">
          <FormSection title="👨‍⚕️ 医生诊断 / 体格评价意见">
            <textarea
              rows={2}
              value={doctorNotes}
              onChange={(e) => setDoctorNotes(e.target.value)}
              placeholder="单据上填写的诊断结论或医嘱建议..."
              className="w-full text-xs p-2.5 rounded-xl border border-divider bg-white focus:border-primary focus:outline-none"
            />
          </FormSection>

          <FormSection title="🤖 AI 临床解读与注意事项">
            <textarea
              rows={2}
              value={aiSummary}
              onChange={(e) => setAiSummary(e.target.value)}
              placeholder="AI 自动生成的通俗解读与家庭护理提示..."
              className="w-full text-xs p-2.5 rounded-xl border border-divider bg-white focus:border-primary focus:outline-none"
            />
          </FormSection>
        </CuteCard>

        {/* Submit */}
        <div className="pt-2">
          <CuteButton
            variant="primary"
            size="lg"
            fullWidth
            onClick={handleSave}
            disabled={saving}
            className="flex items-center justify-center gap-2"
          >
            <CheckCircle2 size={18} />
            {saving ? "保存中..." : "确认保存到健康档案"}
          </CuteButton>
        </div>
      </div>
    </div>
  );
}
