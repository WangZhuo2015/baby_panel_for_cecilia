"use client";

import { useRef, useState } from "react";
import {
  X,
  Download,
  Copy,
  Check,
  Sparkles,
  Droplets,
  Moon,
  Wind,
  UtensilsCrossed,
  Baby as BabyIcon,
  Calendar,
  Heart,
  Lightbulb,
  Share2,
  Clock,
} from "lucide-react";
import { toBlob } from "html-to-image";
import type { AiDailySummaryResult } from "@/types/daily-summary";
import type { Baby } from "@/types";
import { getWeekdayStr } from "@/lib/date";

interface DailySummaryPosterModalProps {
  isOpen: boolean;
  onClose: () => void;
  summary: AiDailySummaryResult;
  baby: Baby | null;
  selectedDate: string;
  timeline?: any[];
}

export function DailySummaryPosterModal({
  isOpen,
  onClose,
  summary,
  baby,
  selectedDate,
  timeline = [],
}: DailySummaryPosterModalProps) {
  const posterRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [copyingImage, setCopyingImage] = useState(false);
  const [copiedImage, setCopiedImage] = useState(false);
  const [copiedText, setCopiedText] = useState(false);

  if (!isOpen) return null;

  const metrics = summary.metrics;
  const totalSleepHours = (metrics.totalSleepMinutes / 60).toFixed(1);
  const nightSleepHours = (metrics.nightSleepMinutes / 60).toFixed(1);
  const daySleepHours = (metrics.daySleepMinutes / 60).toFixed(1);

  const formattedDateStr = (() => {
    const parts = selectedDate.split("-");
    if (parts.length === 3) {
      return `${parts[0]}年${parseInt(parts[1], 10)}月${parseInt(parts[2], 10)}日 · ${getWeekdayStr(selectedDate)}`;
    }
    return selectedDate;
  })();

  // Filter key timeline milestones for the mini rhythm section (max 4 key events)
  const keyEvents = timeline
    .filter((e) => ["feeding", "sleep", "food", "diaper"].includes(e.type))
    .slice(0, 4);

  // Generate poster blob with Retina 2.5x resolution
  const generatePosterBlob = async (): Promise<Blob | null> => {
    if (!posterRef.current) return null;
    return await toBlob(posterRef.current, {
      cacheBust: true,
      pixelRatio: 2.5,
      quality: 0.98,
      backgroundColor: "#FFF9FB",
      skipFonts: true, // Prevents security errors reading external stylesheets in iOS WebKit
    });
  };

  const handleDownload = async () => {
    if (!posterRef.current || downloading) return;
    setDownloading(true);
    try {
      const blob = await generatePosterBlob();
      if (!blob) throw new Error("Failed to generate image blob");

      const fileName = `${summary.babyName || "宝宝"}_${selectedDate}_成长日报.png`;
      const file = new File([blob], fileName, { type: "image/png" });

      // Native mobile Web Share API if supported (e.g. iOS Safari / Android)
      if (typeof navigator !== "undefined" && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: `${summary.babyName}的成长日报`,
          });
          return;
        } catch (shareErr: any) {
          if (shareErr.name === "AbortError") return;
          console.warn("navigator.share cancelled or failed, falling back to download:", shareErr);
        }
      }

      // Fallback: Object URL download
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = fileName;
      link.href = blobUrl;
      link.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    } catch (err) {
      console.error("Failed to generate poster:", err);
      alert("生成海报图片失败，请稍后重试");
    } finally {
      setDownloading(false);
    }
  };

  const handleCopyImage = async () => {
    if (!posterRef.current || copyingImage) return;
    setCopyingImage(true);
    try {
      const blob = await generatePosterBlob();
      if (!blob) throw new Error("Failed to generate image blob");

      if (typeof navigator !== "undefined" && navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]);
        setCopiedImage(true);
        setTimeout(() => setCopiedImage(false), 2500);
      } else {
        await handleDownload();
      }
    } catch (err) {
      console.warn("Clipboard write image failed, falling back to download:", err);
      await handleDownload();
    } finally {
      setCopyingImage(false);
    }
  };

  const handleCopyText = () => {
    const text = `🌟【${summary.babyName}】${selectedDate} 成长日报 🌟
月龄：${summary.babyAgeLabel}
状态评价：${summary.overallScore} (${summary.overallRating.toFixed(1)}/5.0)

💡 核心亮点：
${summary.headline}
🏷️ ${summary.highlights.join(" · ")}

📊 累计作息数据：
🍼 奶量摄入：${metrics.totalFeedingMl}ml (共${metrics.feedingCount}次${metrics.totalBreastMinutes > 0 ? `，亲喂${metrics.totalBreastMinutes}分` : ""})
😴 睡眠时长：${totalSleepHours}小时 (夜间${nightSleepHours}h · 白天${daySleepHours}h · 夜醒${metrics.nightWakingCount}次)
💧 换尿布：${metrics.diaperCount}次 (嘘嘘${metrics.peeCount}次 · 便便${metrics.poopCount}次)
🥣 辅食打卡：${metrics.foodCount}顿${metrics.foodsTried.length > 0 ? ` (${metrics.foodsTried.join("、")})` : ""}
💊 补剂打卡：${metrics.supplements.length > 0 ? metrics.supplements.map((s) => s.name).join("、") : "未打卡"}

📋 AI 儿科点评：
🍼 喂养：${summary.sections.feeding}
😴 睡眠：${summary.sections.sleep}
💩 排便：${summary.sections.diaper}
📈 生长：${summary.sections.growthAndCare}
💡 明日贴士：
${summary.sections.tomorrowTips}

—— Baby Panel 智能成长手账 ——`;

    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        setCopiedText(true);
        setTimeout(() => setCopiedText(false), 2500);
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="relative w-full max-w-lg bg-white dark:bg-card rounded-[32px] shadow-2xl border border-primary/20 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Top Action Bar */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-primary/10 bg-primary-light/40 dark:bg-card shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-full bg-primary/15 text-primary flex items-center justify-center text-sm font-bold">
              🎨
            </span>
            <div>
              <h3 className="text-sm font-bold text-text-primary">精美成长日报海报</h3>
              <p className="text-[11px] text-text-muted">高清手账风 · 支持一键保存与发送</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white dark:bg-neutral-800 text-text-muted hover:text-text-primary flex items-center justify-center shadow-xs transition-colors btn-press cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Poster Scrollable Preview Canvas */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-neutral-100/70 dark:bg-neutral-900/50 flex justify-center">
          {/* THE POSTER ELEMENT (Export Target - Forced Light Mode for Crystal Clear Contrast) */}
          <div
            ref={posterRef}
            id="daily-summary-poster"
            className="light w-full max-w-[420px] bg-gradient-to-b from-[#FFF5F8] via-[#FFF9F5] to-[#F5F8FF] rounded-[28px] border border-pink-200/60 shadow-xl p-5 sm:p-6 space-y-4 font-sans relative overflow-hidden text-[#4A252B]"
            style={{
              color: "#4A252B",
              fontFamily:
                '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
            }}
          >
            {/* Background Decorative Accents */}
            <div className="absolute top-0 right-0 w-48 h-48 bg-radial from-pink-300/20 via-pink-100/10 to-transparent pointer-events-none rounded-bl-full" />
            <div className="absolute bottom-0 left-0 w-40 h-40 bg-radial from-sky-300/15 via-sky-100/10 to-transparent pointer-events-none rounded-tr-full" />

            {/* 1. Brand Top Bar & Date Badge */}
            <div className="flex items-center justify-between relative z-10 border-b border-pink-200/50 pb-3">
              <div className="flex items-center gap-1.5">
                <span className="text-base">🌿</span>
                <span className="text-xs font-black tracking-wider text-pink-600 uppercase">
                  Baby Panel · 每日成长手账
                </span>
              </div>
              <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/90 shadow-xs border border-pink-100 text-[11px] font-bold text-[#8F7076]">
                <Calendar size={12} className="text-pink-500" />
                <span>{formattedDateStr}</span>
              </div>
            </div>

            {/* 2. Baby Profile & Hero Banner */}
            <div className="flex items-center gap-3.5 bg-white/85 backdrop-blur-md p-3.5 rounded-2xl border border-pink-100 shadow-sm relative z-10">
              <div className="w-14 h-14 rounded-full p-0.5 bg-gradient-to-tr from-pink-400 via-amber-300 to-sky-400 shrink-0 shadow-sm">
                <div className="w-full h-full rounded-full bg-white flex items-center justify-center overflow-hidden">
                  {baby?.avatarUrl ? (
                    <img
                      src={`${baby.avatarUrl}${baby.avatarUrl.includes("?") ? "&" : "?"}export_cors=1`}
                      alt={summary.babyName}
                      className="w-full h-full object-cover"
                      crossOrigin="anonymous"
                    />
                  ) : (
                    <BabyIcon size={26} className="text-pink-500" />
                  )}
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-black text-[#4A252B] tracking-tight truncate">
                    {summary.babyName || "宝宝"}
                  </h2>
                  <span className="px-2 py-0.5 rounded-full bg-pink-100/80 text-pink-600 text-[10px] font-bold shrink-0">
                    {baby?.gender === "male" ? "👦 男宝" : "👧 女宝"}
                  </span>
                </div>
                <p className="text-xs font-bold text-[#8F7076] mt-0.5">
                  🍼 {summary.babyAgeLabel || "快乐成长中"}
                </p>
              </div>

              {/* Status Badge */}
              <div className="text-right shrink-0 bg-gradient-to-br from-pink-50 to-pink-100/80 px-2.5 py-1.5 rounded-xl border border-pink-200/60">
                <div className="flex items-center justify-end gap-1 text-xs font-black text-pink-600">
                  <Sparkles size={13} className="text-amber-500" />
                  <span>{summary.overallScore}</span>
                </div>
                <div className="text-[10px] font-bold text-[#B6A0A5] mt-0.5">
                  {summary.overallRating.toFixed(1)} / 5.0
                </div>
              </div>
            </div>

            {/* 3. Headline & Highlights */}
            <div className="bg-gradient-to-br from-pink-50/90 via-amber-50/50 to-white/90 p-4 rounded-2xl border border-pink-200/50 shadow-xs relative z-10 space-y-2.5">
              <div className="flex items-start gap-1.5">
                <span className="text-base text-pink-500 font-serif leading-none select-none">“</span>
                <p className="text-xs sm:text-[13px] font-bold text-[#4A252B] leading-relaxed flex-1">
                  {summary.headline}
                </p>
                <span className="text-base text-pink-500 font-serif leading-none select-none">”</span>
              </div>

              {/* Highlight Tag Badges */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {summary.highlights.slice(0, 3).map((tag, idx) => (
                  <span
                    key={idx}
                    className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-white text-[#4A252B] border border-pink-100 shadow-xs flex items-center gap-1"
                  >
                    <span className="text-pink-500">✓</span> {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* 4. 4-Grid Vital Stats Dashboard */}
            <div className="grid grid-cols-2 gap-2.5 relative z-10">
              {/* Feeding */}
              <div className="bg-gradient-to-br from-sky-50 to-white p-3 rounded-2xl border border-sky-100 shadow-xs space-y-1">
                <div className="flex items-center justify-between text-sky-600">
                  <div className="flex items-center gap-1">
                    <Droplets size={14} />
                    <span className="text-[11px] font-bold">总奶量摄入</span>
                  </div>
                  <span className="text-[10px] bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded-md font-bold">
                    {metrics.feedingCount}次
                  </span>
                </div>
                <div className="flex items-baseline gap-1 pt-0.5">
                  <span className="text-xl font-black text-sky-700">
                    {metrics.totalFeedingMl}
                  </span>
                  <span className="text-xs font-bold text-sky-500">ml</span>
                </div>
                <p className="text-[10px] text-[#8F7076] truncate">
                  {metrics.totalBreastMinutes > 0
                    ? `亲喂 ${metrics.totalBreastMinutes} 分钟`
                    : "配方奶/瓶喂摄入"}
                </p>
              </div>

              {/* Sleep */}
              <div className="bg-gradient-to-br from-purple-50 to-white p-3 rounded-2xl border border-purple-100 shadow-xs space-y-1">
                <div className="flex items-center justify-between text-purple-600">
                  <div className="flex items-center gap-1">
                    <Moon size={14} />
                    <span className="text-[11px] font-bold">全天总睡眠</span>
                  </div>
                  <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-md font-bold">
                    夜醒{metrics.nightWakingCount}次
                  </span>
                </div>
                <div className="flex items-baseline gap-1 pt-0.5">
                  <span className="text-xl font-black text-purple-700">
                    {totalSleepHours}
                  </span>
                  <span className="text-xs font-bold text-purple-500">小时</span>
                </div>
                <p className="text-[10px] text-[#8F7076] truncate">
                  夜睡 {nightSleepHours}h · 白天 {daySleepHours}h
                </p>
              </div>

              {/* Diaper */}
              <div className="bg-gradient-to-br from-emerald-50 to-white p-3 rounded-2xl border border-emerald-100 shadow-xs space-y-1">
                <div className="flex items-center justify-between text-emerald-600">
                  <div className="flex items-center gap-1">
                    <Wind size={14} />
                    <span className="text-[11px] font-bold">大小便排泄</span>
                  </div>
                  <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-md font-bold">
                    共{metrics.diaperCount}次
                  </span>
                </div>
                <div className="flex items-baseline gap-1 pt-0.5">
                  <span className="text-xl font-black text-emerald-700">
                    {metrics.poopCount}
                  </span>
                  <span className="text-xs font-bold text-emerald-500">次便便</span>
                  <span className="text-xs text-[#8F7076] font-bold ml-1.5">
                    · {metrics.peeCount}次尿
                  </span>
                </div>
                <p className="text-[10px] text-[#8F7076] truncate">
                  便状: {metrics.poopColors[0] || "正常黄色"}
                </p>
              </div>

              {/* Food / Supplements */}
              <div className="bg-gradient-to-br from-amber-50 to-white p-3 rounded-2xl border border-amber-100 shadow-xs space-y-1">
                <div className="flex items-center justify-between text-amber-600">
                  <div className="flex items-center gap-1">
                    <UtensilsCrossed size={14} />
                    <span className="text-[11px] font-bold">辅食与补剂</span>
                  </div>
                  <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-md font-bold">
                    {metrics.foodCount}餐
                  </span>
                </div>
                <div className="flex items-baseline gap-1 pt-0.5">
                  <span className="text-xl font-black text-amber-700">
                    {metrics.foodsTried.length}
                  </span>
                  <span className="text-xs font-bold text-amber-500">种食材</span>
                </div>
                <p className="text-[10px] text-[#8F7076] truncate">
                  {metrics.foodsTried.length > 0
                    ? metrics.foodsTried.slice(0, 2).join("、")
                    : "今日未打卡辅食"}
                </p>
              </div>
            </div>

            {/* 5. Key Daily Rhythm Milestones (Mini Timeline) */}
            {keyEvents.length > 0 && (
              <div className="bg-white/90 p-3.5 rounded-2xl border border-pink-100/70 shadow-xs relative z-10 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#4A252B]">
                  <Clock size={13} className="text-pink-500" />
                  <span>今日作息高光时刻</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {keyEvents.map((item, idx) => {
                    const timeStr = item.timestamp
                      ? new Date(item.timestamp).toLocaleTimeString("zh-CN", {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        })
                      : item.time || "--:--";

                    let icon = "🍼";
                    let label = "喂养";
                    let detail = `${item.amountMl || ""}ml`;
                    if (item.type === "sleep") {
                      icon = "😴";
                      label = "小睡";
                      detail = item.durationMinutes ? `${item.durationMinutes}分` : "睡眠";
                    } else if (item.type === "diaper") {
                      icon = item.diaperType === "poop" ? "💩" : "💧";
                      label = "换尿布";
                      detail = item.diaperType === "both" ? "便+尿" : item.diaperType || "正常";
                    } else if (item.type === "food") {
                      icon = "🥣";
                      label = "辅食";
                      detail = Array.isArray(item.foods) ? item.foods.join(",") : "餐点";
                    }

                    return (
                      <div
                        key={idx}
                        className="flex items-center gap-2 bg-neutral-50/80 p-2 rounded-xl border border-neutral-100 text-[11px]"
                      >
                        <span className="text-sm">{icon}</span>
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-[#4A252B] leading-tight">
                            {timeStr} {label}
                          </p>
                          <p className="text-[10px] text-[#8F7076] truncate">{detail}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 6. Pediatric AI Care & Tomorrow Tips */}
            <div className="bg-gradient-to-br from-amber-500/10 via-pink-500/5 to-white/90 p-3.5 rounded-2xl border border-amber-200/60 shadow-xs relative z-10 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-amber-800">
                <Lightbulb size={14} className="text-amber-600" />
                <span>儿科专家明日照护贴士</span>
              </div>
              <p className="text-[11px] text-[#4A252B] leading-relaxed line-clamp-3">
                {summary.sections.tomorrowTips || summary.sections.growthAndCare}
              </p>
            </div>

            {/* 7. Poster Footer Watermark */}
            <div className="pt-2 border-t border-pink-200/40 flex items-center justify-between text-[10px] text-[#B6A0A5] relative z-10">
              <div className="flex items-center gap-1">
                <Heart size={11} className="text-pink-500 fill-pink-500" />
                <span className="font-bold text-[#8F7076]">用心记录宝宝成长的每一刻</span>
              </div>
              <span>Baby Panel 专属档案</span>
            </div>
          </div>
        </div>

        {/* Modal Bottom Action Controls */}
        <div className="p-4 sm:p-5 border-t border-primary/10 bg-white dark:bg-card shrink-0 space-y-2.5">
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="flex items-center justify-center gap-1.5 py-3 px-4 rounded-2xl bg-primary text-white font-bold text-xs sm:text-sm hover:bg-primary-dark transition-all shadow-button btn-press disabled:opacity-50 cursor-pointer"
            >
              <Download size={16} className={downloading ? "animate-bounce" : ""} />
              <span>{downloading ? "正在渲染海报..." : "保存高清海报 (PNG)"}</span>
            </button>

            <button
              onClick={handleCopyImage}
              disabled={copyingImage}
              className={`flex items-center justify-center gap-1.5 py-3 px-4 rounded-2xl font-bold text-xs sm:text-sm border transition-all btn-press cursor-pointer ${
                copiedImage
                  ? "bg-emerald-500 border-emerald-500 text-white"
                  : "bg-white dark:bg-card border-primary/30 text-primary hover:bg-primary-light/50 shadow-xs"
              }`}
            >
              {copiedImage ? <Check size={16} /> : <Share2 size={16} />}
              <span>{copiedImage ? "已复制图片到剪贴板" : "复制海报图片"}</span>
            </button>
          </div>

          <div className="flex items-center justify-between pt-1">
            <button
              onClick={handleCopyText}
              className="text-xs font-bold text-text-secondary hover:text-primary transition-colors flex items-center gap-1 py-1 px-2 rounded-lg hover:bg-primary/5 cursor-pointer"
            >
              {copiedText ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
              <span>{copiedText ? "已复制文字版" : "复制文字版日报"}</span>
            </button>
            <span className="text-[11px] text-text-muted">
              Retina 2.5x 高清输出 · 自动适配深浅色与移动端
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
