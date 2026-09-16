"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Calendar,
  RefreshCw,
  Share2,
  Copy,
  Check,
  Droplets,
  Moon,
  Wind,
  UtensilsCrossed,
  Pill,
  Baby,
  MessageCircle,
  HelpCircle,
  AlertCircle,
  Clock,
  Heart,
  TrendingUp,
  ShieldCheck,
  Lightbulb,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useBabyStore } from "@/stores/useBabyStore";
import { CuteCard } from "@/components/ui/CuteCard";
import { CuteButton } from "@/components/ui/CuteButton";
import { StatCard } from "@/components/ui/StatCard";
import { Timeline } from "@/components/ui/Timeline";
import { openQuickAI } from "@/lib/quickai-bus";
import {
  getLocalDateStr,
  getWeekdayStr,
  addDays,
  diffCalendarDays,
  isValidDateStr,
} from "@/lib/date";
import { calculateAge } from "@/lib/age";
import { loadDailySummaryFromBackend } from "@/lib/growdesk/daily-summary-client";
import type { AiDailySummaryResult } from "@/types/daily-summary";
import { DailySummaryPosterModal } from "@/components/daily-summary/DailySummaryPosterModal";
import { BabyAvatar } from "@/components/ui/BabyAvatar";

function FormattedSectionText({ text }: { text: string }) {
  if (!text) return null;
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  return (
    <div className="space-y-1.5 text-xs text-text-primary leading-relaxed">
      {lines.map((line, idx) => {
        const match = line.match(/^(\d+)\.\s*(.*)$/);
        if (match) {
          return (
            <div key={idx} className="flex items-start gap-2 pt-0.5">
              <span className="w-4 h-4 rounded-full bg-primary/15 text-primary text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                {match[1]}
              </span>
              <span className="flex-1">{match[2]}</span>
            </div>
          );
        }
        return <p key={idx}>{line}</p>;
      })}
    </div>
  );
}

export default function DailySummaryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const {showToast}=useToast();
  const baby = useBabyStore((s) => s.baby);
  const timeline = useBabyStore((s) => s.timeline);
  const fetchTimeline = useBabyStore((s) => s.fetchTimeline);
  const fetchBaby = useBabyStore((s) => s.fetchBaby);

  const todayStr = getLocalDateStr();
  const yesterdayStr = addDays(todayStr, -1);
  const initialDate = searchParams.get("date") || yesterdayStr;
  const [selectedDate, setSelectedDate] = useState<string>(
    isValidDateStr(initialDate) ? initialDate : yesterdayStr
  );

  const [summary, setSummary] = useState<AiDailySummaryResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [regenerating, setRegenerating] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [showPosterModal, setShowPosterModal] = useState<boolean>(false);
  const [showTimeline, setShowTimeline] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<"all" | "feeding" | "sleep" | "diaper" | "growth" | "tips">("all");
  const [isPending, startTransition] = useTransition();

  const isToday = selectedDate === todayStr;
  const isFuture = selectedDate > todayStr;
  const daysDiff = diffCalendarDays(selectedDate, todayStr);
  const dateLabel = isToday
    ? `今天 · ${selectedDate.slice(5)} (${getWeekdayStr(selectedDate)}) · 进行中`
    : daysDiff === 1
    ? `昨天 · ${selectedDate.slice(5)} (${getWeekdayStr(selectedDate)})`
    : daysDiff === 2
    ? `前天 · ${selectedDate.slice(5)} (${getWeekdayStr(selectedDate)})`
    : `${selectedDate.slice(5)} (${getWeekdayStr(selectedDate)})`;

  const isTodayEmpty =
    isToday &&
    summary &&
    summary.metrics.totalFeedingMl === 0 &&
    summary.metrics.totalSleepMinutes === 0 &&
    summary.metrics.diaperCount === 0 &&
    summary.metrics.foodCount === 0;

  // Persist date change to URL without full-page reloads
  const updateSelectedDate = (newDate: string) => {
    if (!isValidDateStr(newDate) || newDate > todayStr) return;
    startTransition(() => {
      setSelectedDate(newDate);
      router.replace(`/daily-summary?date=${newDate}`, { scroll: false });
    });
  };

  // Fetch summary for date
  const loadDailySummary = async (date: string, force: boolean = false) => {
    if (force) setRegenerating(true);
    else setLoading(true);

    try {
      const identity=useBabyStore.getState();
      if(!identity.baby||!identity.user)return;
      const result=await loadDailySummaryFromBackend({babyId:identity.baby.id,userId:identity.user.id,date,generate:force});
      if(useBabyStore.getState().baby?.id===identity.baby.id&&useBabyStore.getState().user?.id===identity.user.id)setSummary(result);

    } catch (e) {
      console.error("Failed to load daily summary:", e);
      showToast(e instanceof Error?e.message:"日报读取失败");
    } finally {
      setLoading(false);
      setRegenerating(false);
    }
  };

  useEffect(() => {
    if (!baby) {
      fetchBaby();
    }
  }, [baby, fetchBaby]);

  useEffect(() => {
    loadDailySummary(selectedDate);
    fetchTimeline(selectedDate, true);
  }, [selectedDate, fetchTimeline, baby?.id]);

  const handlePrevDay = () => {
    updateSelectedDate(addDays(selectedDate, -1));
  };

  const handleNextDay = () => {
    if (isToday || isFuture) return;
    updateSelectedDate(addDays(selectedDate, 1));
  };

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (isValidDateStr(val)) {
      if (val > todayStr) {
        alert("不能选择未来日期哦");
        return;
      }
      updateSelectedDate(val);
    }
  };

  const handleRegenerate = () => {
    loadDailySummary(selectedDate, true);
  };

  const handleCopyReport = () => {
    if (!summary) return;
    const metrics = summary.metrics;
    const totalSleepHours = (metrics.totalSleepMinutes / 60).toFixed(1);

    const text = `🌟【${summary.babyName}】${selectedDate} 成长日报 🌟
月龄：${summary.babyAgeLabel}
状态评价：${summary.overallScore}

💡 核心亮点：
${summary.headline}
🏷️ ${summary.highlights.join(" · ")}

📊 累计作息数据：
🍼 奶量摄入：${metrics.totalFeedingMl}ml (共${metrics.feedingCount}次${metrics.totalBreastMinutes > 0 ? `，亲喂${metrics.totalBreastMinutes}分` : ""})
😴 睡眠时长：${totalSleepHours}小时 (夜间${(metrics.nightSleepMinutes/60).toFixed(1)}h · 白天${(metrics.daySleepMinutes/60).toFixed(1)}h · 夜醒${metrics.nightWakingCount}次)
💧 换尿布：${metrics.diaperCount}次 (嘘嘘${metrics.peeCount}次 · 便便${metrics.poopCount}次)
🥣 辅食打卡：${metrics.foodCount}顿${metrics.foodsTried.length > 0 ? ` (${metrics.foodsTried.join("、")})` : ""}
💊 补剂打卡：${metrics.supplements.length > 0 ? metrics.supplements.map(s => s.name).join("、") : "未打卡"}

📋 AI 儿科点评：
🍼 喂养：${summary.sections.feeding}
😴 睡眠：${summary.sections.sleep}
💩 排便：${summary.sections.diaper}
📈 生长：${summary.sections.growthAndCare}
💡 明日贴士：
${summary.sections.tomorrowTips}

—— 宝宝成长工作台 AI 智能生成 ——`;

    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      });
    }
  };

  const handleAskQuestion = (question: string) => {
    openQuickAI({
      contextTitle: `${selectedDate} 每日日报追问`,
      contextDetail: summary ? JSON.stringify({ summary, date: selectedDate }) : undefined,
      initialPrompt: question,
    });
  };

  const age = baby ? calculateAge(baby.birthDate, selectedDate) : { label: "0月0天" };
  const metrics = summary?.metrics;

  const formatSleep = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h${m > 0 ? `${m}m` : ""}`;
  };

  return (
    <div className="px-4 pt-safe-6 pb-36 workbench:pb-12 max-w-md md:max-w-xl workbench:max-w-none lg:max-w-5xl mx-auto space-y-4">
      {/* 1. Header & Date Switcher Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white/80 dark:bg-card/80 backdrop-blur-md p-3.5 rounded-3xl border border-primary-soft/30 shadow-soft">
        {/* Date Selector Navigation */}
        <div className="flex items-center justify-between sm:justify-start gap-2">
          <button
            onClick={handlePrevDay}
            className="w-8 h-8 rounded-full bg-primary-soft/30 hover:bg-primary-soft/50 text-text-primary flex items-center justify-center btn-press cursor-pointer"
            title="前一天"
          >
            <ChevronLeft size={18} />
          </button>

          <div className="relative flex items-center gap-1.5 bg-primary-light/60 dark:bg-card px-3 py-1.5 rounded-2xl border border-primary/20 cursor-pointer">
            <Calendar size={15} className="text-primary" />
            <span className="text-xs font-bold text-text-primary">{dateLabel}</span>
            <input
              type="date"
              max={todayStr}
              value={selectedDate}
              onChange={handleDateChange}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            />
          </div>

          <button
            onClick={handleNextDay}
            disabled={isToday || isFuture}
            className="w-8 h-8 rounded-full bg-primary-soft/30 hover:bg-primary-soft/50 text-text-primary flex items-center justify-center btn-press cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            title="后一天"
          >
            <ChevronRight size={18} />
          </button>

          {isToday ? (
            <button
              onClick={() => updateSelectedDate(yesterdayStr)}
              className="text-[11px] font-bold text-primary bg-primary/10 hover:bg-primary/20 px-2.5 py-1 rounded-full btn-press cursor-pointer whitespace-nowrap"
            >
              查看昨天完整日报
            </button>
          ) : selectedDate !== yesterdayStr ? (
            <button
              onClick={() => updateSelectedDate(yesterdayStr)}
              className="text-[11px] font-bold text-primary bg-primary/10 hover:bg-primary/20 px-2.5 py-1 rounded-full btn-press cursor-pointer whitespace-nowrap"
            >
              回到昨天
            </button>
          ) : (
            <button
              onClick={() => updateSelectedDate(todayStr)}
              className="text-[11px] font-bold text-text-secondary bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 px-2.5 py-1 rounded-full btn-press cursor-pointer whitespace-nowrap"
              title="预览今日实时作息（进行中）"
            >
              今日实时预览 ⏳
            </button>
          )}
        </div>

        {/* Baby Profile Info Header */}
        <div className="flex items-center justify-between sm:justify-end gap-2.5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-primary-soft flex items-center justify-center overflow-hidden shrink-0">
              {baby?.avatarUrl ? (
                <BabyAvatar src={baby.avatarUrl} alt={baby.nickname} size={32} />
              ) : (
                <Baby size={16} className="text-primary" />
              )}
            </div>
            <div className="text-left">
              <p className="text-xs font-bold text-text-primary leading-tight">
                {baby?.nickname || "宝宝"}
              </p>
              <p className="text-[10px] text-text-muted">
                {summary?.babyAgeLabel || age.label}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={handleRegenerate}
              disabled={regenerating || loading}
              className="p-2 rounded-xl bg-white dark:bg-card border border-primary/15 text-text-secondary hover:text-primary btn-press disabled:opacity-50 cursor-pointer shadow-xs"
              title="重新用 AI 生成总结"
            >
              <RefreshCw size={14} className={regenerating ? "animate-spin text-primary" : ""} />
            </button>

            <button
              onClick={() => setShowPosterModal(true)}
              disabled={!summary}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-primary via-pink-500 to-rose-400 text-white hover:opacity-90 shadow-button btn-press cursor-pointer"
              title="生成精美长图海报，方便分享到朋友圈或群聊"
            >
              <Share2 size={13} />
              <span>生成海报</span>
            </button>

            <button
              onClick={handleCopyReport}
              disabled={!summary}
              className={`p-2 rounded-xl text-xs font-bold transition-all btn-press cursor-pointer border ${
                copied
                  ? "bg-emerald-500 text-white border-emerald-500 shadow-sm"
                  : "bg-white dark:bg-card text-text-secondary hover:text-primary border-primary/15 shadow-xs"
              }`}
              title="复制纯文本日报到剪贴板"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        </div>
      </div>

      {/* 2. Loading State */}
      {loading ? (
        <div className="space-y-4 py-8 animate-pulse">
          <CuteCard className="p-6 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center mx-auto text-primary animate-bounce">
              <Sparkles size={24} />
            </div>
            <p className="text-sm font-bold text-text-primary">AI 正在深度分析今日作息与健康数据...</p>
            <p className="text-xs text-text-muted">正在汇总奶量、睡眠、排便与辅食指标，结合儿科指南生成总结</p>
          </CuteCard>
        </div>
      ) : summary ? (
        <>
          {/* If viewing Today, show friendly in-progress banner */}
          {isToday && (
            <div className="flex items-center justify-between p-3.5 rounded-2xl bg-gradient-to-r from-sky-50 via-indigo-50 to-purple-50 dark:from-sky-950/40 dark:via-indigo-950/30 dark:to-purple-950/20 border border-sky-200/80 dark:border-sky-800/60 text-xs text-sky-900 dark:text-sky-200 shadow-xs">
              <div className="flex items-center gap-2">
                <span className="text-base">⏳</span>
                <div>
                  <p className="font-bold">
                    今日（{selectedDate.slice(5)} {getWeekdayStr(selectedDate)}）作息仍在进行中
                  </p>
                  <p className="text-[11px] text-text-muted">
                    每日成长手账于次日生成全天完整复盘与评分
                  </p>
                </div>
              </div>
              <button
                onClick={() => updateSelectedDate(yesterdayStr)}
                className="px-3 py-1.5 rounded-xl bg-primary text-white font-bold transition-all shadow-xs btn-press cursor-pointer shrink-0 ml-2"
              >
                查看昨日完整日报 👈
              </button>
            </div>
          )}

          {/* 3. Status Score & Headline Card */}
          <CuteCard className="bg-gradient-to-br from-primary-light via-lavender/15 to-pink-50/40 dark:from-primary-dark/20 dark:via-lavender/10 dark:to-transparent border border-lavender/30 p-5 shadow-soft">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                <span className="px-3 py-1 rounded-full bg-primary text-white text-xs font-bold shadow-xs flex items-center gap-1">
                  <Sparkles size={12} className="animate-spin-slow" />
                  {summary.overallScore}
                </span>
                <span className="text-[11px] font-bold text-text-secondary bg-white/70 dark:bg-card/70 px-2 py-0.5 rounded-full border border-primary/10">
                  {summary.overallRating.toFixed(1)} / 5.0
                </span>
              </div>
              <span className="text-[10px] text-text-muted flex items-center gap-1">
                {summary.isAiGenerated ? "🤖 AI 深度生成" : "📋 儿科规则生成"}
              </span>
            </div>

            {/* 1-Sentence Headline */}
            <h2 className="text-sm sm:text-base font-bold text-text-primary leading-relaxed mb-3">
              “{summary.headline.replace(/^[“"「]+|[”"」]+$/g, "").trim()}”
            </h2>

            {/* Highlight Tags */}
            <div className="flex flex-wrap gap-1.5">
              {summary.highlights.map((tag, idx) => (
                <span
                  key={idx}
                  className="text-[11px] font-medium px-2.5 py-1 rounded-xl bg-white/80 dark:bg-card/80 text-text-primary border border-primary-soft/40 shadow-xs flex items-center gap-1"
                >
                  <span className="text-primary font-bold">✓</span> {tag}
                </span>
              ))}
            </div>

            {/* Quick Share Poster Banner */}
            <div className="pt-1.5">
              <button
                onClick={() => setShowPosterModal(true)}
                className="w-full flex items-center justify-between p-2.5 sm:p-3 rounded-2xl bg-gradient-to-r from-pink-100/90 via-rose-50/70 to-amber-50/80 hover:from-pink-100 hover:to-amber-100 border border-pink-200/60 text-xs font-bold text-pink-700 transition-all shadow-xs btn-press group cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-xl bg-gradient-to-tr from-pink-500 to-rose-400 text-white flex items-center justify-center text-xs shadow-xs">
                    🎨
                  </span>
                  <span>一键生成精美手账长图（可直接保存或发送群聊）</span>
                </div>
                <span className="text-[11px] text-pink-600 font-bold group-hover:translate-x-0.5 transition-transform flex items-center gap-0.5">
                  生成海报 <ChevronRight size={13} />
                </span>
              </button>
            </div>
          </CuteCard>

          {/* 4. Key Metrics Grid (Stat Cards) */}
          <div>
            <div className="flex items-center justify-between mb-2 px-1">
              <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wider">
                今日全量指标概览
              </h3>
              <span className="text-[10px] text-text-muted">
                {selectedDate} 实时统计
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <StatCard
                icon={<Droplets size={16} className="text-sky-500" />}
                label="总奶量"
                value={String(metrics?.totalFeedingMl || 0)}
                unit="ml"
                color="bg-sky-500/10"
              />
              <StatCard
                icon={<Moon size={16} className="text-purple-500" />}
                label="总睡眠"
                value={formatSleep(metrics?.totalSleepMinutes || 0)}
                color="bg-purple-500/10"
              />
              <StatCard
                icon={<Wind size={16} className="text-emerald-500" />}
                label="排便/尿布"
                value={`${metrics?.diaperCount || 0}次`}
                color="bg-emerald-500/10"
              />
              <StatCard
                icon={<UtensilsCrossed size={16} className="text-amber-500" />}
                label="辅食餐点"
                value={`${metrics?.foodCount || 0}顿`}
                color="bg-amber-500/10"
              />
            </div>

            {/* Secondary stats pill row */}
            <div className="mt-2.5 flex flex-wrap gap-2 text-[11px] text-text-secondary px-1">
              {metrics && metrics.totalBreastMinutes > 0 && (
                <span className="bg-sky-50 dark:bg-sky-950/30 text-sky-700 px-2 py-0.5 rounded-lg border border-sky-100">
                  🤱 母乳亲喂累计 {metrics.totalBreastMinutes} 分钟
                </span>
              )}
              {metrics && metrics.nightWakingCount > 0 && (
                <span className="bg-purple-50 dark:bg-purple-950/30 text-purple-700 px-2 py-0.5 rounded-lg border border-purple-100">
                  🌙 夜醒 {metrics.nightWakingCount} 次
                </span>
              )}
              {metrics && metrics.poopCount > 0 && (
                <span className="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 px-2 py-0.5 rounded-lg border border-emerald-100">
                  💩 大便 {metrics.poopCount} 次 ({metrics.poopColors.join("、") || "正常"})
                </span>
              )}
              {metrics && metrics.supplements.length > 0 && (
                <span className="bg-pink-50 dark:bg-pink-950/30 text-pink-700 px-2 py-0.5 rounded-lg border border-pink-100 flex items-center gap-1">
                  <Pill size={11} />
                  已补: {metrics.supplements.map((s) => s.name).join("、")}
                </span>
              )}
            </div>
          </div>

          {/* 5. Filter Tabs & Detailed AI Analysis Sections */}
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles size={14} className="text-primary" />
                AI 儿科与生长发育分析
              </h3>
            </div>

            <div className="space-y-3">
              {/* Section 1: Feeding & Nutrition */}
              <CuteCard className="p-4 bg-white dark:bg-card border-l-4 border-l-sky-500 shadow-soft">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-xl bg-sky-100 text-sky-600 flex items-center justify-center">
                    <Droplets size={15} />
                  </div>
                  <h4 className="text-xs font-bold text-text-primary">喂养与营养摄入评估</h4>
                </div>
                <FormattedSectionText text={summary.sections.feeding} />
              </CuteCard>

              {/* Section 2: Sleep & Rhythm */}
              <CuteCard className="p-4 bg-white dark:bg-card border-l-4 border-l-purple-500 shadow-soft">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center">
                    <Moon size={15} />
                  </div>
                  <h4 className="text-xs font-bold text-text-primary">作息与睡眠节律评估</h4>
                </div>
                <FormattedSectionText text={summary.sections.sleep} />
              </CuteCard>

              {/* Section 3: Diaper & Digestion */}
              <CuteCard className="p-4 bg-white dark:bg-card border-l-4 border-l-emerald-500 shadow-soft">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
                    <Wind size={15} />
                  </div>
                  <h4 className="text-xs font-bold text-text-primary">排泄与肠胃舒适度</h4>
                </div>
                <FormattedSectionText text={summary.sections.diaper} />
              </CuteCard>

              {/* Section 4: Growth & Supplements */}
              <CuteCard className="p-4 bg-white dark:bg-card border-l-4 border-l-pink-500 shadow-soft">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-xl bg-pink-100 text-pink-600 flex items-center justify-center">
                    <TrendingUp size={15} />
                  </div>
                  <h4 className="text-xs font-bold text-text-primary">生长发育与营养补剂</h4>
                </div>
                <FormattedSectionText text={summary.sections.growthAndCare} />
              </CuteCard>

              {/* Section 5: Tomorrow Tips */}
              <CuteCard className="p-4 bg-gradient-to-br from-amber-50/70 to-orange-50/40 dark:from-amber-950/20 dark:to-transparent border-l-4 border-l-amber-500 shadow-soft">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
                    <Lightbulb size={15} />
                  </div>
                  <h4 className="text-xs font-bold text-amber-900 dark:text-amber-300">明日照护与早教互动贴士</h4>
                </div>
                <FormattedSectionText text={summary.sections.tomorrowTips} />
              </CuteCard>
            </div>
          </div>

          {/* 6. Contextual AI Follow-up Questions */}
          {summary.suggestedQuestions && summary.suggestedQuestions.length > 0 && (
            <CuteCard className="p-4 bg-primary-light/40 dark:bg-card border border-primary/20 space-y-2.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-text-primary">
                <MessageCircle size={15} className="text-primary" />
                <span>向 AI 顾问针对今日情况深度追问</span>
              </div>
              <div className="flex flex-col gap-2">
                {summary.suggestedQuestions.map((q, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleAskQuestion(q)}
                    className="text-left text-xs text-text-primary bg-white dark:bg-card/90 hover:bg-primary-light p-2.5 rounded-xl border border-primary/10 transition-all flex items-center justify-between group btn-press cursor-pointer shadow-xs"
                  >
                    <span>💬 {q}</span>
                    <ChevronRight size={14} className="text-text-muted group-hover:text-primary transition-colors shrink-0" />
                  </button>
                ))}
              </div>
            </CuteCard>
          )}

          {/* 7. Collapsible Full Timeline of Today */}
          <div className="pt-2">
            <button
              onClick={() => setShowTimeline(!showTimeline)}
              className="w-full flex items-center justify-between p-3.5 bg-white dark:bg-card rounded-2xl border border-primary/15 text-xs font-bold text-text-primary btn-press cursor-pointer hover:shadow-xs transition-all"
            >
              <div className="flex items-center gap-2">
                <Clock size={15} className="text-primary" />
                <span>查看 {selectedDate} 详细时间轴明细 ({timeline.length}条记录)</span>
              </div>
              <ChevronRight size={16} className={`transform transition-transform ${showTimeline ? "rotate-90 text-primary" : "text-text-muted"}`} />
            </button>

            {showTimeline && (
              <div className="mt-3">
                <Timeline items={timeline} />
              </div>
            )}
          </div>

          {/* Disclaimer Footer */}
          <div className="text-center pt-2 pb-6 px-4">
            <p className="text-[11px] text-text-muted/80 leading-relaxed">
              ⚠️ {summary.disclaimer}
            </p>
          </div>
        </>
      ) : (
        <CuteCard className="p-8 text-center space-y-3">
          <AlertCircle size={32} className="text-amber-500 mx-auto" />
          <p className="text-sm font-bold text-text-primary">暂无此日期的总结数据</p>
          <p className="text-xs text-text-secondary">点击下方按钮生成该日的 AI 每日总结</p>
          <CuteButton onClick={handleRegenerate} size="md">
            立即生成总结
          </CuteButton>
        </CuteCard>
      )}

      {/* Daily Summary Shareable Poster Modal */}
      {summary && (
        <DailySummaryPosterModal
          isOpen={showPosterModal}
          onClose={() => setShowPosterModal(false)}
          summary={summary}
          baby={baby}
          selectedDate={selectedDate}
          timeline={timeline}
        />
      )}
    </div>
  );
}
