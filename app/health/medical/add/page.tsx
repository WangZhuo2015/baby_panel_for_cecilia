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
import { composeMedicalAiSummary } from "@/lib/medical-summary";
import { MarkdownBody } from "@/components/ui/MarkdownBody";
import { compressImageForOcr } from "@/lib/upload";
import { WhoPercentileBreakdown } from "@/components/growth/WhoPercentileCard";
import { getWhoMetricsForBaby } from "@/lib/who-growth-standards";
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
  const [jobId, setJobId] = useState<string | null>(null);
  const [claimJobId, setClaimJobId] = useState<string | null>(null);
  const [jobElapsed, setJobElapsed] = useState(0);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrDone, setOcrDone] = useState(false);
  const [saving, setSaving] = useState(false);
  const isSubmittingRef = useRef(false);

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

    setOcrLoading(true);
    setOcrError(null);
    setOcrDone(false);

    try {
      // 客户端压缩高分辨率照片，减少网络负载
      const compressed = await compressImageForOcr(file);
      setImageFile(compressed);
      setImagePreview(URL.createObjectURL(compressed));

      const formData = new FormData();
      formData.append("image", compressed);

      const res = await fetch("/api/medical/ocr", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      // ===== 异步任务模式：立即拿到 jobId，后台识别（约 1 分钟）=====
      if (res.status === 202 && data.jobId) {
        sessionStorage.setItem("pending-ocr-job", data.jobId);
        showToast("已提交后台识别，正在返回列表显示进度…");
        setTimeout(() => router.push("/health/medical"), 600);
        return;
      }

      // 兼容旧同步响应
      if (!res.ok) {
        setOcrError(data.error || "识别未能解析出数据，请核对并手动录入");
        return;
      }
      applyOcrResult(data);
      setOcrLoading(false); // 同步旧路径成功收尾
    } catch (e: any) {
      setOcrError(e?.message || "AI 识别服务连接失败，请手动录入数据");
      setOcrLoading(false);
    }
    // 异步任务模式下不在此处关 loading：由 startJobPolling 的 done/failed 收尾
  };

  // 将 OCR 结构化结果填入表单
  const applyOcrResult = (data: any) => {
    const payload = data?.data && typeof data.data === "object" ? data.data : data;
    if (payload.title) setTitle(payload.title);
    if (payload.category) setCategory(payload.category);
    if (payload.date) setDate(payload.date);
    if (payload.hospital) setHospital(payload.hospital);
    if (payload.doctorNotes) setDoctorNotes(payload.doctorNotes);
    const summary = payload.aiSummary || data.aiSummary;
    const itemList = Array.isArray(payload.items) ? payload.items : data.items;
    if (typeof summary === "string" && summary.trim()) {
      setAiSummary(summary.trim());
    } else if (Array.isArray(itemList)) {
      const fallback = composeMedicalAiSummary(itemList);
      if (fallback) setAiSummary(fallback);
    }
    if (payload.imageUrl || data.imageUrl) setUploadedImageUrl(payload.imageUrl || data.imageUrl);

    if (Array.isArray(itemList)) {
      setItems(
        itemList.map((it: any, idx: number) => ({
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

    const growth = payload.growthData || data.growthData;
    if (growth) {
      if (growth.weightKg) setWeightKg(String(growth.weightKg));
      if (growth.heightCm) setHeightCm(String(growth.heightCm));
      if (growth.headCm || growth.headCircumferenceCm)
        setHeadCm(String(growth.headCircumferenceCm ?? growth.headCm));
    }

    setOcrDone(true);
    showToast("识别完成！请核对并修改下方各项数据 ✨");
  };

  // 轮询任务状态直至完成/失败；返回清理函数，unmount 时必须调用防泄漏
  const pollingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startJobPolling = (id: string) => {
    const tick = async () => {
      try {
        const res = await fetch(`/api/ai/jobs/${id}`);
        if (!res.ok) return false;
        const job = await res.json();
        if (job.status === "done" && job.result) {
          sessionStorage.removeItem("pending-ocr-job");
          applyOcrResult(job.result);
          setClaimJobId(id);
          setOcrLoading(false);
          setJobId(null);
          return true;
        }
        if (job.status === "failed") {
          sessionStorage.removeItem("pending-ocr-job");
          setOcrError(job.errorMessage || "识别失败，请重试或手动录入");
          setOcrLoading(false);
          setJobId(null);
          return true;
        }
      } catch {
        /* 网络抖动，下个周期继续 */
      }
      return false;
    };

    void tick();
    if (pollingTimer.current) clearInterval(pollingTimer.current);
    pollingTimer.current = setInterval(async () => {
      setJobElapsed((v) => v + 3);
      if (await tick()) {
        if (pollingTimer.current) clearInterval(pollingTimer.current);
        pollingTimer.current = null;
      }
    }, 3000);
    return () => {
      if (pollingTimer.current) clearInterval(pollingTimer.current);
      pollingTimer.current = null;
    };
  };

  // 刷新/离开后回来：恢复未完成任务轮询；支持 ?job= 直达领取
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("job");
    const stored = sessionStorage.getItem("pending-ocr-job") || fromUrl;
    if (stored && !ocrDone) {
      setJobId(stored);
      setOcrLoading(true);
      const stop = startJobPolling(stored);
      return stop;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (saving || isSubmittingRef.current) return;
    if (!title.trim()) {
      showToast("请填写单据名称");
      return;
    }
    if (!date) {
      showToast("请选择检验/体检日期");
      return;
    }

    isSubmittingRef.current = true;
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
        aiSummary: aiSummary.trim() || composeMedicalAiSummary(items) || undefined,
        items,
        imageUrl: finalImageUrl,
        growthData: growthDataPayload,
      });

      if (claimJobId) {
        fetch(`/api/ai/jobs/${claimJobId}`, { method: "PATCH" }).catch(() => {});
      }

      showToast("报告已成功保存并归档 ✨");
      setTimeout(() => router.push("/health/medical"), 600);
    } catch (e: any) {
      showToast(e?.message || "保存失败，请重试");
    } finally {
      isSubmittingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-bg max-w-md mx-auto px-4 pb-28">
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
                AI 正在结构化识别单据指标{jobId ? `（已 ${jobElapsed}s）` : "..."}
              </p>
              <p className="text-xs text-text-muted mt-1">
                通常约需 1 分钟。你可以先离开，完成后会出现在化验单列表里，随时回来确认。
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

        <CuteCard className="p-4 space-y-3 border border-primary/20 bg-gradient-to-br from-primary-light/50 to-lavender/10">
          <h3 className="text-sm font-bold text-primary flex items-center gap-1.5">
            🤖 AI 临床解读与注意事项
          </h3>
          {aiSummary.trim() ? (
            <div className="rounded-xl bg-white/80 border border-primary/15 p-3">
              <MarkdownBody>{aiSummary}</MarkdownBody>
            </div>
          ) : (
            <p className="text-xs text-text-muted">
              {ocrLoading ? "识别完成后会自动填入解读…" : "暂无解读"}
            </p>
          )}
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

            {(() => {
              const wNum = weightKg ? parseFloat(weightKg) : undefined;
              const hNum = heightCm ? parseFloat(heightCm) : undefined;
              const hdNum = headCm ? parseFloat(headCm) : undefined;
              const whoMetrics = getWhoMetricsForBaby(baby, date, {
                weightKg: wNum && !Number.isNaN(wNum) && wNum > 0 ? wNum : undefined,
                heightCm: hNum && !Number.isNaN(hNum) && hNum > 0 ? hNum : undefined,
                headCircumferenceCm: hdNum && !Number.isNaN(hdNum) && hdNum > 0 ? hdNum : undefined,
              });

              if (whoMetrics.length === 0) return null;

              return (
                <div className="pt-2">
                  <WhoPercentileBreakdown
                    metrics={whoMetrics}
                    title="WHO 生长发育百分位（实时对照）"
                  />
                </div>
              );
            })()}
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
                  {item.interpretation ? (
                    <p className="text-[11px] text-text-secondary leading-relaxed bg-white/80 rounded-lg px-2 py-1.5">
                      {item.interpretation}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CuteCard>

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
            {saving ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                <span>保存中...</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={18} />
                <span>确认保存到健康档案</span>
              </>
            )}
          </CuteButton>
        </div>
      </div>
    </div>
  );
}
