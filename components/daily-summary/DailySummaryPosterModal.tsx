"use client";

import { useRef, useState, useEffect } from "react";
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
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);

  // Preload avatar as Base64 Data URL to prevent CORS / Canvas taint in html-to-image
  useEffect(() => {
    if (!baby?.avatarUrl) {
      setAvatarDataUrl(null);
      return;
    }
    let cancelled = false;
    fetch(baby.avatarUrl, { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error(`Avatar HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          if (!cancelled && typeof reader.result === "string") {
            setAvatarDataUrl(reader.result);
          }
        };
        reader.readAsDataURL(blob);
      })
      .catch((err) => {
        console.warn("Avatar preload failed, will use direct URL:", err);
      });

    return () => {
      cancelled = true;
    };
  }, [baby?.avatarUrl]);

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

  // Synthesize key milestones from metrics and timeline
  const milestones = (() => {
    const list: Array<{ time: string; icon: string; label: string; detail: string; order: string }> = [];

    for (const f of metrics.feedings || []) {
      const isBreast = f.type === "breast";
      list.push({
        time: f.time,
        icon: isBreast ? "🤱" : "🍼",
        label: isBreast ? "母乳亲喂" : "配方奶",
        detail: isBreast
          ? `${(f.leftMinutes || 0) + (f.rightMinutes || 0)}分钟`
          : `${f.amountMl || 0}ml`,
        order: f.time,
      });
    }

    for (const s of metrics.sleeps || []) {
      list.push({
        time: s.startTime,
        icon: "😴",
        label: s.type === "night" ? "夜间睡眠" : "白天小睡",
        detail: `${s.durationMinutes}分钟`,
        order: s.startTime,
      });
    }

    for (const d of metrics.diapers || []) {
      const isPoop = d.type === "poop" || d.type === "both";
      list.push({
        time: d.time,
        icon: isPoop ? "💩" : "💧",
        label: isPoop ? "换尿布(便)" : "换尿布(尿)",
        detail: d.poopColor || (d.type === "both" ? "便+尿" : "排尿正常"),
        order: d.time,
      });
    }

    for (const fl of metrics.foodLogs || []) {
      list.push({
        time: fl.time,
        icon: "🥣",
        label: "辅食打卡",
        detail: Array.isArray(fl.foods) && fl.foods.length > 0 ? fl.foods.slice(0, 2).join("、") : "营养辅食",
        order: fl.time,
      });
    }

    // Sort chronologically and take up to 4 highlights
    return list.sort((a, b) => a.order.localeCompare(b.order)).slice(0, 4);
  })();

  // Generate poster blob with Retina 2.5x resolution
  const generatePosterBlob = async (): Promise<Blob | null> => {
    if (!posterRef.current) return null;

    // Ensure avatar is loaded as Data URL before snapshotting
    if (baby?.avatarUrl && !avatarDataUrl) {
      try {
        const res = await fetch(baby.avatarUrl, { credentials: "include" });
        if (res.ok) {
          const blob = await res.blob();
          const dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
          setAvatarDataUrl(dataUrl);
          await new Promise((r) => setTimeout(r, 50));
        }
      } catch (e) {
        console.warn("Synchronous avatar load before snapshot failed:", e);
      }
    }

    return await toBlob(posterRef.current, {
      cacheBust: true,
      pixelRatio: 2.5,
      quality: 0.98,
      backgroundColor: "#FFF9FB",
      skipFonts: true,
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

  // Clean headline of redundant quotes
  const cleanHeadline = summary.headline.replace(/^[“"「]+|[”"」]+$/g, "").trim();
  const cleanTips = (summary.sections.tomorrowTips || summary.sections.growthAndCare || "")
    .replace(/\n{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm animate-fade-in overflow-y-auto pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-[calc(1rem+env(safe-area-inset-top,0px))]">
      <div className="relative w-full max-w-lg bg-white dark:bg-card rounded-[32px] shadow-2xl border border-primary/20 overflow-hidden flex flex-col max-h-[calc(100dvh-2rem)] sm:max-h-[90vh] my-auto">
        {/* Modal Top Action Bar */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-primary/10 bg-primary-light/40 dark:bg-card shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-full bg-primary/15 text-primary flex items-center justify-center text-sm font-bold">
              🎨
            </span>
            <div>
              <h3 className="text-sm font-bold text-text-primary">成长日报手账海报</h3>
              <p className="text-[11px] text-text-muted">精致手账排版 · 高清无失真导出</p>
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
        <div className="flex-1 overflow-y-auto p-3 sm:p-5 bg-neutral-100/70 dark:bg-neutral-900/50 flex justify-center">
          {/* THE POSTER ELEMENT */}
          <div
            ref={posterRef}
            id="daily-summary-poster"
            className="light w-full max-w-[400px] bg-gradient-to-b from-[#FFF5F8] via-[#FFF9F5] to-[#F5F8FF] rounded-[24px] border border-pink-200/60 shadow-xl p-4 sm:p-5 space-y-3 font-sans relative overflow-hidden text-[#4A252B]"
            style={{
              color: "#4A252B",
              fontFamily:
                '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
            }}
          >
            {/* Background Soft Bokeh Accents */}
            <div className="absolute -top-10 -right-10 w-40 h-40 bg-pink-300/20 rounded-full blur-2xl pointer-events-none" />
            <div className="absolute -bottom-10 -left-10 w-36 h-36 bg-sky-300/20 rounded-full blur-2xl pointer-events-none" />

            {/* 1. Header Row */}
            <div className="flex items-center justify-between relative z-10 border-b border-pink-200/50 pb-2.5">
              <div className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="text-sm">🌿</span>
                <span className="text-xs font-black tracking-wider text-pink-600 uppercase">
                  Baby Panel · 每日成长手账
                </span>
              </div>
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/95 shadow-xs border border-pink-100 text-[11px] font-bold text-[#8F7076] whitespace-nowrap">
                <Calendar size={11} className="text-pink-500" />
                <span>{formattedDateStr}</span>
              </div>
            </div>

            {/* 2. Baby Identity Card */}
            <div className="flex items-center gap-3 bg-white/90 backdrop-blur-md p-3 rounded-2xl border border-pink-100/80 shadow-xs relative z-10">
              <div className="w-12 h-12 rounded-full p-0.5 bg-gradient-to-tr from-pink-400 via-amber-300 to-sky-400 shrink-0 shadow-xs">
                <div className="w-full h-full rounded-full bg-white flex items-center justify-center overflow-hidden">
                  {baby?.avatarUrl ? (
                    <img
                      src={avatarDataUrl || baby.avatarUrl}
                      alt={summary.babyName || "宝宝头像"}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <BabyIcon size={24} className="text-pink-500" />
                  )}
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <h2 className="text-base font-black text-[#4A252B] tracking-tight truncate">
                    {summary.babyName || "宝宝"}
                  </h2>
                  <span className="px-1.5 py-0.5 rounded-md bg-pink-100/80 text-pink-600 text-[10px] font-bold shrink-0 whitespace-nowrap">
                    {baby?.gender === "male" ? "👦男宝" : "👧女宝"}
                  </span>
                </div>
                <p className="text-[11px] font-bold text-[#8F7076] mt-0.5 truncate">
                  🍼 {summary.babyAgeLabel || "快乐成长中"}
                </p>
              </div>

              {/* Status Score Pill */}
              <div className="text-right shrink-0 bg-gradient-to-br from-pink-50 to-pink-100/90 px-2 py-1 rounded-xl border border-pink-200/60 whitespace-nowrap">
                <div className="flex items-center justify-end gap-1 text-[11px] font-black text-pink-600">
                  <Sparkles size={11} className="text-amber-500" />
                  <span>{summary.overallScore}</span>
                </div>
                <div className="text-[9px] font-bold text-[#8F7076] mt-0.5">
                  评分 {summary.overallRating.toFixed(1)} / 5.0
                </div>
              </div>
            </div>

            {/* 3. Headline & Highlights */}
            <div className="bg-gradient-to-r from-pink-50/90 via-amber-50/40 to-pink-50/90 p-3 rounded-2xl border border-pink-200/50 shadow-xs relative z-10 space-y-2">
              <p className="text-xs font-bold text-[#4A252B] leading-relaxed">
                “{cleanHeadline}”
              </p>

              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {summary.highlights.slice(0, 4).map((tag, idx) => (
                  <span
                    key={idx}
                    className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-white/95 text-[#4A252B] border border-pink-100 shadow-xs inline-flex items-center gap-1 whitespace-nowrap"
                  >
                    <span className="text-pink-500 font-black">✓</span> {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* 4. 4-Grid Vital Stats Dashboard */}
            <div className="grid grid-cols-2 gap-2 relative z-10">
              {/* Feeding */}
              <div className="bg-gradient-to-br from-sky-50 to-white p-2.5 rounded-xl border border-sky-100 shadow-xs">
                <div className="flex items-center justify-between text-sky-600">
                  <span className="text-[11px] font-bold flex items-center gap-1">
                    <Droplets size={13} />
                    总奶量
                  </span>
                  <span className="text-[10px] bg-sky-100 text-sky-700 px-1 py-0.2 rounded font-bold">
                    {metrics.feedingCount}次
                  </span>
                </div>
                <div className="flex items-baseline gap-1 my-0.5">
                  <span className="text-xl font-black text-sky-700">
                    {metrics.totalFeedingMl}
                  </span>
                  <span className="text-[11px] font-bold text-sky-500">ml</span>
                </div>
                <p className="text-[10px] text-[#8F7076] truncate">
                  {metrics.totalBreastMinutes > 0
                    ? `亲喂 ${metrics.totalBreastMinutes} 分钟`
                    : metrics.formulaCount > 0
                      ? `${metrics.formulaCount}次配方奶`
                      : "暂无喂养"}
                </p>
              </div>

              {/* Sleep */}
              <div className="bg-gradient-to-br from-purple-50 to-white p-2.5 rounded-xl border border-purple-100 shadow-xs">
                <div className="flex items-center justify-between text-purple-600">
                  <span className="text-[11px] font-bold flex items-center gap-1">
                    <Moon size={13} />
                    总睡眠
                  </span>
                  <span className="text-[10px] bg-purple-100 text-purple-700 px-1 py-0.2 rounded font-bold">
                    夜醒{metrics.nightWakingCount}次
                  </span>
                </div>
                <div className="flex items-baseline gap-1 my-0.5">
                  <span className="text-xl font-black text-purple-700">
                    {totalSleepHours}
                  </span>
                  <span className="text-[11px] font-bold text-purple-500">小时</span>
                </div>
                <p className="text-[10px] text-[#8F7076] truncate">
                  夜间 {nightSleepHours}h · 白天 {daySleepHours}h
                </p>
              </div>

              {/* Diaper */}
              <div className="bg-gradient-to-br from-emerald-50 to-white p-2.5 rounded-xl border border-emerald-100 shadow-xs">
                <div className="flex items-center justify-between text-emerald-600">
                  <span className="text-[11px] font-bold flex items-center gap-1">
                    <Wind size={13} />
                    大小便
                  </span>
                  <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1 py-0.2 rounded font-bold">
                    共{metrics.diaperCount}次
                  </span>
                </div>
                <div className="flex items-baseline gap-1 my-0.5">
                  <span className="text-xl font-black text-emerald-700">
                    {metrics.poopCount}
                  </span>
                  <span className="text-[11px] font-bold text-emerald-500">次便</span>
                  <span className="text-[10px] text-[#8F7076] font-bold ml-1">
                    · {metrics.peeCount}次尿
                  </span>
                </div>
                <p className="text-[10px] text-[#8F7076] truncate">
                  便状: {metrics.poopColors[0] || "正常黄色"}
                </p>
              </div>

              {/* Food */}
              <div className="bg-gradient-to-br from-amber-50 to-white p-2.5 rounded-xl border border-amber-100 shadow-xs">
                <div className="flex items-center justify-between text-amber-600">
                  <span className="text-[11px] font-bold flex items-center gap-1">
                    <UtensilsCrossed size={13} />
                    辅食
                  </span>
                  <span className="text-[10px] bg-amber-100 text-amber-700 px-1 py-0.2 rounded font-bold">
                    {metrics.foodCount}餐
                  </span>
                </div>
                <div className="flex items-baseline gap-1 my-0.5">
                  <span className="text-xl font-black text-amber-700">
                    {metrics.foodsTried.length}
                  </span>
                  <span className="text-[11px] font-bold text-amber-500">种食材</span>
                </div>
                <p className="text-[10px] text-[#8F7076] truncate">
                  {metrics.foodsTried.length > 0
                    ? metrics.foodsTried.join("、")
                    : "今日未添加辅食"}
                </p>
              </div>
            </div>

            {/* 5. Key Rhythm Milestones Timeline */}
            {milestones.length > 0 && (
              <div className="bg-white/90 p-2.5 rounded-xl border border-pink-100/70 shadow-xs relative z-10 space-y-1.5">
                <div className="flex items-center gap-1 text-[11px] font-bold text-[#4A252B]">
                  <Clock size={12} className="text-pink-500" />
                  <span>今日作息高光时刻</span>
                </div>
                <div className="space-y-1">
                  {milestones.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between bg-neutral-50/90 px-2.5 py-1 rounded-lg border border-neutral-100 text-[11px]"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs">{item.icon}</span>
                        <span className="font-bold text-[#4A252B] whitespace-nowrap">{item.time}</span>
                        <span className="font-medium text-[#8F7076] truncate">{item.label}</span>
                      </div>
                      <span className="text-[10px] font-bold text-pink-600 shrink-0 ml-2 whitespace-nowrap">
                        {item.detail}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 6. Pediatric Care Tip */}
            {cleanTips && (
              <div className="bg-gradient-to-br from-amber-500/10 via-pink-500/5 to-white/90 p-2.5 rounded-xl border border-amber-200/60 shadow-xs relative z-10 space-y-1">
                <div className="flex items-center gap-1 text-[11px] font-bold text-amber-800">
                  <Lightbulb size={12} className="text-amber-600" />
                  <span>儿科专家明日照护贴士</span>
                </div>
                <p className="text-[10px] text-[#4A252B] leading-relaxed line-clamp-2">
                  {cleanTips}
                </p>
              </div>
            )}

            {/* 7. Poster Footer Watermark */}
            <div className="pt-1.5 border-t border-pink-200/40 flex items-center justify-between text-[9px] text-[#B6A0A5] relative z-10">
              <div className="flex items-center gap-1">
                <Heart size={10} className="text-pink-500 fill-pink-500" />
                <span className="font-bold text-[#8F7076]">记录点滴陪伴 · 见证每个闪光瞬间</span>
              </div>
              <span>Baby Panel 专属档案</span>
            </div>
          </div>
        </div>

        {/* Modal Bottom Action Controls */}
        <div className="p-3.5 sm:p-4 border-t border-primary/10 bg-white dark:bg-card shrink-0 space-y-2 pb-[max(1rem,env(safe-area-inset-bottom,1rem))]">
          <div className="grid grid-cols-2 gap-2.5">
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-primary text-white font-bold text-xs sm:text-sm hover:bg-primary-dark transition-all shadow-button btn-press disabled:opacity-50 cursor-pointer"
            >
              <Download size={15} className={downloading ? "animate-bounce" : ""} />
              <span>{downloading ? "正在渲染..." : "保存高清海报 (PNG)"}</span>
            </button>

            <button
              onClick={handleCopyImage}
              disabled={copyingImage}
              className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl font-bold text-xs sm:text-sm border transition-all btn-press cursor-pointer ${
                copiedImage
                  ? "bg-emerald-500 border-emerald-500 text-white"
                  : "bg-white dark:bg-card border-primary/30 text-primary hover:bg-primary-light/50 shadow-xs"
              }`}
            >
              {copiedImage ? <Check size={15} /> : <Share2 size={15} />}
              <span>{copiedImage ? "已复制图片到剪贴板" : "复制海报图片"}</span>
            </button>
          </div>

          <div className="flex items-center justify-between pt-0.5">
            <button
              onClick={handleCopyText}
              className="text-[11px] font-bold text-text-secondary hover:text-primary transition-colors flex items-center gap-1 py-0.5 px-1.5 rounded-lg hover:bg-primary/5 cursor-pointer"
            >
              {copiedText ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
              <span>{copiedText ? "已复制文字版" : "复制文字版日报"}</span>
            </button>
            <span className="text-[10px] text-text-muted">
              Retina 2.5x 高清 · 自动适配深浅色与移动端
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
