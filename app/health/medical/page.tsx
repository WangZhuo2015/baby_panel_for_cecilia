"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  Plus,
  Calendar,
  Building2,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Sparkles,
  ExternalLink,
  Trash2,
  X,
  ChevronRight,
  Eye,
  Activity,
} from "lucide-react";
import { AppHeader } from "@/components/ui/AppHeader";
import { CuteCard } from "@/components/ui/CuteCard";
import { CuteButton } from "@/components/ui/CuteButton";
import { SegmentControl } from "@/components/ui/SegmentControl";
import { QuickAiButton } from "@/components/ui/QuickAiButton";
import { useToast } from "@/components/ui/Toast";
import { useBabyStore } from "@/stores/useBabyStore";
import { composeMedicalAiSummary } from "@/lib/medical-summary";
import { MarkdownBody } from "@/components/ui/MarkdownBody";
import { WhoPercentileChips, ReportWhoSection } from "@/components/growth/WhoPercentileCard";
import { AgentBadge } from "@/components/ui/AgentBadge";
import { extractReportGrowthMetrics, getWhoMetricsForBaby } from "@/lib/who-growth-standards";
import type { MedicalReport, MedicalReportItem } from "@/types";

const CATEGORY_MAP: Record<string, { label: string; emoji: string; color: string }> = {
  blood: { label: "血常规", emoji: "🩸", color: "bg-red-50 text-red-600 border-red-200" },
  growth: { label: "体检记录", emoji: "📏", color: "bg-blue-50 text-blue-600 border-blue-200" },
  trace_element: { label: "微量元素", emoji: "🧪", color: "bg-purple-50 text-purple-600 border-purple-200" },
  allergy: { label: "过敏原", emoji: "🌿", color: "bg-amber-50 text-amber-600 border-amber-200" },
  general: { label: "化验检查", emoji: "📑", color: "bg-gray-50 text-gray-600 border-gray-200" },
};

export default function MedicalReportsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { medicalReports, fetchMedicalReports, deleteMedicalReport, fetchBaby, baby } = useBabyStore();

  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [selectedReport, setSelectedReport] = useState<MedicalReport | null>(null);
  const [aiJobs, setAiJobs] = useState<
    { id: string; status: string; claimed: boolean; imageUrl: string | null; createdAt: string; errorMessage?: string | null }[]
  >([]);
  const [nowTick, setNowTick] = useState(Date.now());
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBaby();
    fetchMedicalReports(activeCategory).finally(() => setLoading(false));
  }, [fetchBaby, fetchMedicalReports, activeCategory]);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("确定要删除这份化验/体检报告吗？")) return;
    try {
      await deleteMedicalReport(id);
      showToast("报告已删除");
      if (selectedReport?.id === id) setSelectedReport(null);
    } catch {
      showToast("删除失败，请重试");
    }
  };

  const getAbnormalCount = (items: MedicalReportItem[]) => {
    return items.filter((item) => ["high", "low", "abnormal", "positive"].includes(item.status)).length;
  };

  const filteredReports = activeCategory === "all"
    ? medicalReports
    : medicalReports.filter((r) => r.category === activeCategory);

  const fetchAiJobs = React.useCallback(async () => {
    try {
      const d = await fetch("/api/ai/jobs").then((r) => r.json());
      setAiJobs(d.jobs || []);
    } catch { /* 离线忽略 */ }
  }, []);

  useEffect(() => {
    fetchAiJobs();
  }, [fetchAiJobs]);

  // 存在识别中的任务时：5s 轮询刷新状态 + 每秒更新耗时显示
  const hasProcessing = aiJobs.some((j) => j.status === "processing" && !j.claimed);
  useEffect(() => {
    if (!hasProcessing) return;
    const poll = setInterval(fetchAiJobs, 5000);
    const tick = setInterval(() => setNowTick(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [hasProcessing, fetchAiJobs]);

  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([
        fetchBaby(true),
        fetchMedicalReports(activeCategory, true),
        fetchAiJobs(),
      ]);
    } finally {
      setTimeout(() => setRefreshing(false), 500);
    }
  };

  const pendingJobs = aiJobs.filter((j) => !j.claimed);

  return (
    <div className="min-h-[100dvh] bg-bg px-4 pb-28 max-w-md mx-auto">
      <AppHeader title="化验与体检档案" showBack onRefresh={handleRefresh} refreshing={refreshing} />

      {/* Top Switcher with Vaccines */}
      <div className="flex items-center gap-2 mt-3 mb-4 bg-primary-light/60 p-1 rounded-2xl">
        <Link
          href="/health/vaccines"
          className="flex-1 py-2 text-center text-xs font-semibold rounded-xl text-text-secondary hover:text-primary transition-all whitespace-nowrap"
        >
          💉 疫苗规划
        </Link>
        <div className="flex-1 py-2 text-center text-xs font-bold rounded-xl bg-white text-primary shadow-soft whitespace-nowrap">
          📑 化验与体检
        </div>
      </div>

      {pendingJobs.length > 0 && (
        <div className="mb-4 space-y-2">
          {pendingJobs.map((job) => {
            const elapsedS = Math.max(0, Math.floor((nowTick - new Date(job.createdAt).getTime()) / 1000));
            const elapsedText =
              elapsedS >= 60 ? `${Math.floor(elapsedS / 60)}分${elapsedS % 60}秒` : `${elapsedS}秒`;

            if (job.status === "processing") {
              return (
                <div
                  key={job.id}
                  className="p-3 rounded-[20px] bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800 animate-pulse"
                >
                  <div className="flex items-center gap-2 text-sm font-bold text-indigo-700 dark:text-indigo-300">
                    <Loader2 size={15} className="animate-spin" />
                    AI 正在识别化验单… 已 {elapsedText}
                  </div>
                  <p className="text-[11px] text-text-muted mt-1 ml-6">
                    可以先离开去记录其他内容，完成后这里会变成确认入口
                  </p>
                </div>
              );
            }

            if (job.status === "done") {
              return (
                <Link
                  key={job.id}
                  href={`/health/medical/add?job=${job.id}`}
                  className="block p-3 rounded-[20px] bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 hover:border-emerald-400 transition-colors"
                >
                  <div className="flex items-center gap-2 text-sm font-bold text-emerald-700 dark:text-emerald-300">
                    <Sparkles size={15} />
                    化验单识别完成，点击核对入库 →
                  </div>
                  {job.imageUrl && (
                    <Image
                      src={job.imageUrl}
                      alt="化验单缩略图"
                      width={320}
                      height={96}
                      unoptimized={job.imageUrl.startsWith("data:") || job.imageUrl.startsWith("blob:")}
                      className="mt-2 w-full h-24 object-cover rounded-xl opacity-80"
                    />
                  )}
                </Link>
              );
            }

            return (
              <button
                key={job.id}
                type="button"
                onClick={async () => {
                  await fetch(`/api/ai/jobs/${job.id}`, { method: "PATCH" });
                  fetchAiJobs();
                }}
                className="w-full text-left p-3 rounded-[20px] bg-red-50 dark:bg-red-900/25 border border-red-200 dark:border-red-800 cursor-pointer"
              >
                <div className="flex items-center justify-between text-sm font-bold text-red-600 dark:text-red-400">
                  <span>⚠️ 识别失败：{job.errorMessage?.slice(0, 60) || "请重试"}</span>
                  <X size={14} />
                </div>
                <p className="text-[11px] text-text-muted mt-1">点击关闭此提醒；可重新拍照再试</p>
              </button>
            );
          })}
        </div>
      )}

      {/* Action Banner */}
      <CuteCard variant="gradient" className="mb-4 shadow-card">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-text-primary mb-1">
              AI 智能识单与档案管理
            </h2>
            <p className="text-xs text-text-secondary leading-relaxed">
              支持血常规、儿保体检、微量元素等单据拍照识别、结构化核对与原图存档
            </p>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-primary/20 flex gap-2">
          <CuteButton
            variant="primary"
            size="sm"
            fullWidth
            onClick={() => router.push("/health/medical/add")}
            className="flex items-center justify-center gap-1.5 flex-1"
          >
            <Plus size={16} /> 拍照 / 识别新单据
          </CuteButton>
          <QuickAiButton
            contextType="medical"
            label="报告问答"
            contextTitle="化验单与体检解读顾问"
            variant="outline"
            className="px-3.5 py-2 text-xs"
          />
        </div>
      </CuteCard>

      {/* Category Tabs */}
      <div className="mb-4 overflow-x-auto pb-1 scrollbar-hide">
        <SegmentControl
          options={[
            { value: "all", label: "全部" },
            { value: "blood", label: "血常规" },
            { value: "growth", label: "体检" },
            { value: "trace_element", label: "微量元素" },
            { value: "allergy", label: "过敏原" },
          ]}
          value={activeCategory}
          onChange={(v) => setActiveCategory(v)}
        />
      </div>

      {/* Reports List */}
      {loading ? (
        <div className="text-center py-16 text-text-muted text-xs">加载健康档案中...</div>
      ) : filteredReports.length === 0 ? (
        <div className="text-center py-16 px-4">
          <div className="w-16 h-16 rounded-full bg-primary-light flex items-center justify-center mx-auto mb-3 text-2xl">
            📑
          </div>
          <p className="text-sm font-semibold text-text-primary mb-1">暂无化验或体检记录</p>
          <p className="text-xs text-text-muted mb-4">
            拍照上传宝宝的血常规单、儿保体检表或微量元素单，AI 自动提取指标并永久存档
          </p>
          <CuteButton variant="primary" size="md" onClick={() => router.push("/health/medical/add")}>
            <Plus size={16} className="mr-1" /> 录入第一份化验单
          </CuteButton>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredReports.map((report) => {
            const abnormalCount = getAbnormalCount(report.items || []);
            const catInfo = CATEGORY_MAP[report.category] || CATEGORY_MAP.general;
            const summaryText =
              (report.aiSummary && report.aiSummary.trim()) ||
              composeMedicalAiSummary(report.items || []);
            const growthMetrics = extractReportGrowthMetrics(report);
            const whoResults = getWhoMetricsForBaby(baby, report.date, growthMetrics);

            return (
              <CuteCard
                key={report.id}
                className="p-4 cursor-pointer hover:shadow-md transition-all relative border border-primary-soft/40"
                onClick={() => setSelectedReport(report)}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-lg shrink-0">{catInfo.emoji}</span>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-bold text-text-primary leading-tight truncate">
                        {report.title}
                      </h3>
                      <div className="flex items-center gap-1.5 text-[11px] text-text-muted mt-0.5 flex-wrap">
                        <span className="flex items-center gap-1 whitespace-nowrap">
                          <Calendar size={11} /> {report.date}
                        </span>
                        {report.sourceAgent && <AgentBadge name={report.sourceAgent} size="xs" />}
                        {report.hospital && (
                          <span className="flex items-center gap-1 truncate">
                            <Building2 size={11} className="shrink-0" /> {report.hospital}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium shrink-0 ${catInfo.color}`}>
                    {catInfo.label}
                  </span>
                </div>

                {whoResults.length > 0 && (
                  <div className="my-2.5">
                    <WhoPercentileChips metrics={whoResults} />
                  </div>
                )}

                {/* Status and summary badge */}
                <div className="flex items-center justify-between mt-2.5 pt-2.5 border-t border-divider/60">
                  <div className="flex items-center gap-1.5 text-xs">
                    {abnormalCount > 0 ? (
                      <span className="flex items-center gap-1 text-amber-600 font-medium text-[11px] bg-amber-50 px-2 py-0.5 rounded-md">
                        <AlertCircle size={12} /> {abnormalCount} 项指标异常/偏离
                      </span>
                    ) : report.items?.length > 0 ? (
                      <span className="flex items-center gap-1 text-mint font-medium text-[11px] bg-mint/10 px-2 py-0.5 rounded-md">
                        <CheckCircle2 size={12} /> {report.items.length} 项指标均在标准范围
                      </span>
                    ) : (
                      <span className="text-text-muted text-[11px]">已存档</span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {report.imageUrl && (
                      <span className="text-[10px] text-primary bg-primary-soft px-1.5 py-0.5 rounded flex items-center gap-0.5">
                        <Eye size={10} /> 有原图
                      </span>
                    )}
                    <ChevronRight size={16} className="text-text-muted" />
                  </div>
                </div>

                {summaryText && (
                  <div className="mt-2 text-xs text-text-secondary bg-primary-light/40 rounded-xl p-2.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-bold text-primary mb-1">
                      <Sparkles size={13} /> AI 临床解读
                    </div>
                    <div className="line-clamp-5 overflow-hidden">
                      <MarkdownBody className="text-xs">{summaryText}</MarkdownBody>
                    </div>
                  </div>
                )}
              </CuteCard>
            );
          })}
        </div>
      )}

      {/* Detail Modal */}
      {selectedReport && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-[#1E171E] text-text-primary dark:text-gray-100 w-full max-w-lg rounded-t-3xl sm:rounded-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-slide-up border border-primary/20">
            {/* Modal Header */}
            <div className="p-4 border-b border-divider flex items-center justify-between bg-white dark:bg-[#251D25] sticky top-0 z-10">
              <div className="flex items-center gap-2">
                <span className="text-xl">
                  {CATEGORY_MAP[selectedReport.category]?.emoji || "📑"}
                </span>
                <div>
                  <h3 className="text-base font-bold text-text-primary">
                    {selectedReport.title}
                  </h3>
                  <p className="text-xs text-text-muted flex items-center gap-1.5 flex-wrap">
                    <span>{selectedReport.date}</span>
                    {selectedReport.sourceAgent && <AgentBadge name={selectedReport.sourceAgent} size="xs" />}
                    {selectedReport.hospital && <span>· {selectedReport.hospital}</span>}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedReport(null)}
                className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-text-secondary"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 overflow-y-auto space-y-4">
              {((selectedReport.aiSummary && selectedReport.aiSummary.trim()) ||
                composeMedicalAiSummary(selectedReport.items || [])) && (
                <div className="bg-gradient-to-br from-primary-light/60 to-lavender/10 rounded-2xl p-3.5 border border-primary/20">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-primary mb-1">
                    <Sparkles size={14} /> AI 智能临床解读
                  </div>
                  <MarkdownBody>
                    {(selectedReport.aiSummary && selectedReport.aiSummary.trim()) ||
                      composeMedicalAiSummary(selectedReport.items || [])}
                  </MarkdownBody>
                </div>
              )}

              {/* Original Photo Preview */}
              {selectedReport.imageUrl && (
                <div className="bg-gray-50 rounded-2xl p-3 border border-divider">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-text-primary flex items-center gap-1">
                      📷 单据原图存档
                    </span>
                    <button
                      onClick={() => setLightboxImage(selectedReport.imageUrl!)}
                      className="text-xs text-primary font-medium flex items-center gap-1 hover:underline"
                    >
                      查看大图 <ExternalLink size={12} />
                    </button>
                  </div>
                  <div
                    className="w-full h-36 rounded-xl overflow-hidden bg-black/5 cursor-pointer relative group"
                    onClick={() => setLightboxImage(selectedReport.imageUrl!)}
                  >
                    <Image
                      src={selectedReport.imageUrl}
                      alt={selectedReport.title}
                      width={400}
                      height={144}
                      unoptimized={selectedReport.imageUrl.startsWith("data:") || selectedReport.imageUrl.startsWith("blob:")}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                    <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="text-white text-xs bg-black/60 px-3 py-1 rounded-full">点击放大查看</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Doctor Notes */}
              {selectedReport.doctorNotes && (
                <div className="bg-blue-50/60 rounded-2xl p-3 border border-blue-100">
                  <span className="text-xs font-semibold text-blue-800 block mb-0.5">
                    👨‍⚕️ 医生诊断 / 体检意见
                  </span>
                  <p className="text-xs text-blue-900 leading-relaxed">
                    {selectedReport.doctorNotes}
                  </p>
                </div>
              )}

              {/* WHO Growth Percentiles Section */}
              <ReportWhoSection report={selectedReport} baby={baby} />

              {/* Indicators Table */}
              <div>
                <h4 className="text-xs font-bold text-text-secondary mb-2 flex items-center gap-1.5">
                  <Activity size={14} className="text-primary" />
                  检测指标详情 ({selectedReport.items?.length || 0} 项)
                </h4>

                {selectedReport.items && selectedReport.items.length > 0 ? (
                  <div className="border border-divider rounded-2xl overflow-hidden">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-gray-50/80 text-text-muted border-b border-divider">
                          <th className="py-2.5 px-3 font-semibold">项目名称</th>
                          <th className="py-2.5 px-2 font-semibold">检测结果</th>
                          <th className="py-2.5 px-2 font-semibold">参考区间</th>
                          <th className="py-2.5 px-2 font-semibold text-right">状态</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-divider/60">
                        {selectedReport.items.map((item, idx) => {
                          const isHigh = item.status === "high";
                          const isLow = item.status === "low";
                          const isAbnormal = ["abnormal", "positive"].includes(item.status);

                          return (
                            <tr key={item.id || idx} className="hover:bg-primary-soft/20">
                              <td className="py-2.5 px-3">
                                <p className="font-semibold text-text-primary">{item.name}</p>
                                {item.interpretation && (
                                  <p className="text-[10px] text-text-muted mt-0.5">{item.interpretation}</p>
                                )}
                              </td>
                              <td className="py-2.5 px-2">
                                <span
                                  className={`font-bold ${
                                    isHigh ? "text-red-600" : isLow ? "text-blue-600" : isAbnormal ? "text-amber-600" : "text-text-primary"
                                  }`}
                                >
                                  {item.value} {item.unit}
                                </span>
                              </td>
                              <td className="py-2.5 px-2 text-text-muted text-[11px]">
                                {item.referenceRange || "--"}
                              </td>
                              <td className="py-2.5 px-2 text-right">
                                {isHigh ? (
                                  <span className="inline-block px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold">
                                    ↑ 偏高
                                  </span>
                                ) : isLow ? (
                                  <span className="inline-block px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px] font-bold">
                                    ↓ 偏低
                                  </span>
                                ) : isAbnormal ? (
                                  <span className="inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-bold">
                                    异常
                                  </span>
                                ) : (
                                  <span className="inline-block px-1.5 py-0.5 rounded bg-mint/15 text-mint text-[10px] font-medium">
                                    正常
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-text-muted py-3 text-center">暂无具体指标明细</p>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-3 bg-gray-50 dark:bg-[#251D25] border-t border-divider flex items-center justify-between">
              <button
                onClick={(e) => handleDelete(selectedReport.id, e)}
                className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1 px-3 py-2 rounded-xl hover:bg-red-50 transition-colors"
              >
                <Trash2 size={14} /> 删除报告
              </button>
              <CuteButton size="sm" variant="primary" onClick={() => setSelectedReport(null)}>
                完成
              </CuteButton>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox / Fullscreen Image Viewer */}
      {lightboxImage && (
        <div
          className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center p-4"
          onClick={() => setLightboxImage(null)}
        >
          <button
            onClick={() => setLightboxImage(null)}
            className="absolute top-6 right-6 w-10 h-10 rounded-full bg-white/20 text-white flex items-center justify-center hover:bg-white/40"
          >
            <X size={24} />
          </button>
          <img
            src={lightboxImage}
            alt="单据大图"
            className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
          />
        </div>
      )}
    </div>
  );
}
