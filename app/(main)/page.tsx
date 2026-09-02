"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Baby,
  Droplets,
  Moon,
  Wind,
  UtensilsCrossed,
  Bell,
  Users,
  RefreshCw,
  AlertCircle,
  Sparkles,
  Star,
  ChevronRight,
  Camera,
  FileText,
  MessageSquare,
} from "lucide-react";
import type { TimelineEntry } from "@/types";
import { useBabyStore } from "@/stores/useBabyStore";
import { calculateAge } from "@/lib/age";
import { StatCard } from "@/components/ui/StatCard";
import { QuickActionCard } from "@/components/ui/QuickActionCard";
import { Timeline } from "@/components/ui/Timeline";
import { RecordEditDialog } from "@/components/ui/RecordEditDialog";
import { RecordActionSheet } from "@/components/ui/RecordActionSheet";
import { CuteCard } from "@/components/ui/CuteCard";
import { CuteButton } from "@/components/ui/CuteButton";
import { QuickAiButton } from "@/components/ui/QuickAiButton";
import { InstallGuideBanner } from "@/components/ui/InstallGuideBanner";
import { SupplementQuickCheckIn } from "@/components/nutrition/SupplementQuickCheckIn";
import { formatIsoToLocalTime } from "@/lib/date";
import { APP_VERSION } from "@/lib/version";
import { openRecordDrawer, RecordDrawerType } from "@/lib/drawer-bus";
import { openQuickAI } from "@/lib/quickai-bus";

function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0);
  const router = useRouter();

  const fetchCount = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : [];
        const readRaw = localStorage.getItem("notification-read-ids");
        const readIds = new Set(readRaw ? JSON.parse(readRaw) : []);
        const unread = list.filter(
          (n: { id: string }) => !readIds.has(n.id)
        ).length;
        setUnreadCount(unread);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchCount();
    const handler = () => fetchCount();
    window.addEventListener("notifications-read", handler);
    window.addEventListener("baby:data-polled", handler);
    return () => {
      window.removeEventListener("notifications-read", handler);
      window.removeEventListener("baby:data-polled", handler);
    };
  }, [fetchCount]);

  return (
    <button
      onClick={() => router.push("/notifications")}
      aria-label="通知"
      className="w-10 h-10 rounded-full bg-white shadow-soft flex items-center justify-center btn-press relative cursor-pointer"
    >
      <Bell size={18} className="text-text-secondary" />
      {unreadCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1 shadow-soft">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </button>
  );
}

export default function HomePage() {
  const router = useRouter();

  const user = useBabyStore((s) => s.user);
  const baby = useBabyStore((s) => s.baby);
  const dailySummary = useBabyStore((s) => s.dailySummary);
  const aiDailySummary = useBabyStore((s) => s.aiDailySummary);
  const timeline = useBabyStore((s) => s.timeline);
  const weather = useBabyStore((s) => s.weather);
  const feedingRecords = useBabyStore((s) => s.feedingRecords);
  const sleepRecords = useBabyStore((s) => s.sleepRecords);
  const aiTips = useBabyStore((s) => s.aiTips);
  const aiError = useBabyStore((s) => s.aiError);
  const authLoading = useBabyStore((s) => s.authLoading);
  const updateTimelineRecord = useBabyStore((s) => s.updateTimelineRecord);
  const deleteTimelineRecord = useBabyStore((s) => s.deleteTimelineRecord);

  // 时间轴误操作修正
  const [editingRecord, setEditingRecord] = useState<TimelineEntry | null>(null);
  const [actionItem, setActionItem] = useState<TimelineEntry | null>(null);

  const fetchUser = useBabyStore((s) => s.fetchUser);
  const fetchDailySummary = useBabyStore((s) => s.fetchDailySummary);
  const fetchAiDailySummary = useBabyStore((s) => s.fetchAiDailySummary);
  const fetchTimeline = useBabyStore((s) => s.fetchTimeline);
  const fetchWeather = useBabyStore((s) => s.fetchWeather);
  const fetchFeedingRecords = useBabyStore((s) => s.fetchFeedingRecords);
  const fetchSleepRecords = useBabyStore((s) => s.fetchSleepRecords);
  const fetchAiTips = useBabyStore((s) => s.fetchAiTips);

  const [aiLoading, setAiLoading] = useState(false);
  const [pageRefreshing, setPageRefreshing] = useState(false);
  const [liveSleepStart, setLiveSleepStart] = useState<string | null>(null);
  const [liveSleepElapsed, setLiveSleepElapsed] = useState<string>("");

  const refreshAll = useBabyStore((s) => s.refreshAll);

  const handleManualRefresh = async () => {
    if (pageRefreshing) return;
    setPageRefreshing(true);
    try {
      await refreshAll();
    } finally {
      setTimeout(() => setPageRefreshing(false), 500);
    }
  };

  const handleQuickRecord = (type: RecordDrawerType, fallbackUrl: string) => {
    if (typeof window !== "undefined" && window.innerWidth >= 1024) {
      openRecordDrawer(type);
    } else {
      router.push(fallbackUrl);
    }
  };

  useEffect(() => {
    fetchWeather();
    fetchUser();
  }, [fetchUser, fetchWeather]);

  useEffect(() => {
    if (baby?.id) {
      fetchDailySummary();
      fetchAiDailySummary();
      fetchTimeline();
      fetchFeedingRecords();
      fetchSleepRecords();
      fetchAiTips();
    }
  }, [
    baby?.id,
    fetchDailySummary,
    fetchAiDailySummary,
    fetchTimeline,
    fetchFeedingRecords,
    fetchSleepRecords,
    fetchAiTips,
  ]);

  // Tab visibility change & nutrition updates: auto-refresh if baby is selected
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && baby?.id) {
        fetchDailySummary(undefined, true);
        fetchAiDailySummary(undefined, true);
        fetchTimeline(undefined, true);
        fetchFeedingRecords(undefined, true);
        fetchSleepRecords(true);
      }
    };
    const handleNutritionUpdate = () => {
      if (baby?.id) {
        fetchDailySummary(undefined, true);
        fetchTimeline(undefined, true);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("baby:nutrition-updated", handleNutritionUpdate);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("baby:nutrition-updated", handleNutritionUpdate);
    };
  }, [baby?.id, fetchDailySummary, fetchAiDailySummary, fetchTimeline, fetchFeedingRecords, fetchSleepRecords]);

  // Safety fallback: if auth takes longer than 2s, stop blocking screen
  useEffect(() => {
    const timer = setTimeout(() => {
      if (useBabyStore.getState().authLoading) {
        useBabyStore.setState({ authLoading: false });
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  // Check live sleep session
  useEffect(() => {
    const checkLiveSleep = () => {
      try {
        const stored = localStorage.getItem("baby_active_sleep_start");
        setLiveSleepStart(stored);
        if (stored) {
          const diffMs = Date.now() - new Date(stored).getTime();
          const totalMins = Math.max(0, Math.floor(diffMs / 60000));
          const h = Math.floor(totalMins / 60);
          const m = totalMins % 60;
          setLiveSleepElapsed(h > 0 ? `${h}小时${m}分` : `${m}分钟`);
        }
      } catch {
        // Ignore
      }
    };
    checkLiveSleep();
    const interval = setInterval(checkLiveSleep, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleRefreshAi = async () => {
    setAiLoading(true);
    try {
      await fetchAiTips();
    } finally {
      setAiLoading(false);
    }
  };

  // Calculate Last Feeding
  const latestFeeding = feedingRecords?.[0];
  const feedingElapsedText = latestFeeding
    ? (() => {
        const diffMs = Date.now() - new Date(latestFeeding.timestamp).getTime();
        const mins = Math.max(0, Math.floor(diffMs / 60000));
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return h > 0 ? `${h}小时${m}分前` : `${m}分钟前`;
      })()
    : null;

  const latestFeedingDetail = latestFeeding
    ? latestFeeding.type === "breast"
      ? `母乳 左${latestFeeding.leftMinutes || 0}分·右${latestFeeding.rightMinutes || 0}分`
      : latestFeeding.type === "bottle_breast"
      ? `瓶喂母乳 ${latestFeeding.amountMl || 0}ml`
      : latestFeeding.type === "mixed"
      ? `混合亲喂+奶粉 ${latestFeeding.amountMl || 0}ml`
      : `配方奶 ${latestFeeding.amountMl || 0}ml`
    : null;

  // Calculate Last Sleep / Awake Duration
  const latestSleep = sleepRecords?.[0];
  const awakeElapsedText = latestSleep && !liveSleepStart
    ? (() => {
        const diffMs = Date.now() - new Date(latestSleep.endTime).getTime();
        const mins = Math.max(0, Math.floor(diffMs / 60000));
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return h > 0 ? `${h}小时${m}分` : `${m}分钟`;
      })()
    : null;

  if (authLoading) {
    return (
      <div className="min-h-screen bg-bg-canvas flex items-center justify-center p-4">
        <div className="text-center space-y-2 text-xs text-text-muted">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p>加载成长档案中...</p>
        </div>
      </div>
    );
  }

  if (!baby) {
    return (
      <div className="px-4 pt-safe-12 pb-36 max-w-md mx-auto text-center">
        <div className="w-20 h-20 rounded-3xl bg-primary-light text-primary mx-auto flex items-center justify-center shadow-card mb-4">
          <Baby size={40} />
        </div>
        <CuteCard className="p-6">
          <p className="text-lg font-bold text-text-primary mb-1">欢迎使用宝宝成长工作台</p>
          <p className="text-sm text-text-secondary mb-5">
            {user ? "先完善宝宝信息，开始记录日常与生长发育" : "登录或注册账号，与家庭成员共同记录宝宝成长"}
          </p>
          {user ? (
            <CuteButton
              onClick={() => router.push("/onboarding")}
              size="lg"
              fullWidth
            >
              立即设置宝宝信息
            </CuteButton>
          ) : (
            <div className="flex flex-col gap-2 w-full max-w-xs mx-auto">
              <CuteButton
                onClick={() => router.push("/login")}
                size="md"
                fullWidth
              >
                登录已有账号
              </CuteButton>
              <CuteButton
                onClick={() => router.push("/register")}
                variant="secondary"
                size="md"
                fullWidth
              >
                注册新账号 / 加入家庭
              </CuteButton>
            </div>
          )}
        </CuteCard>
      </div>
    );
  }

  const age = calculateAge(baby.birthDate);
  const summary = dailySummary ?? { totalFeedingMl: 0, totalSleepMinutes: 0, diaperCount: 0, foodCount: 0 };

  const formatSleep = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h${m > 0 ? `${m}m` : ""}`;
  };

  return (
    <div className="px-4 pt-safe-6 pb-36 max-w-md md:max-w-xl lg:max-w-6xl mx-auto space-y-5">
      {/* 1. Header (Mobile & Tablet Bar) */}
      <div className="flex items-center justify-between">
        <div
          className="flex items-center gap-3 cursor-pointer group"
          onClick={() => router.push("/onboarding")}
          title="点击更换头像与修改宝宝资料"
        >
          <div className="relative">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-soft to-primary/30 flex items-center justify-center overflow-hidden shadow-soft group-hover:ring-2 group-hover:ring-primary/40 transition-all">
              {baby.avatarUrl ? (
                <img src={baby.avatarUrl} alt={baby.nickname} className="w-full h-full object-cover" />
              ) : (
                <Baby size={24} className="text-primary" />
              )}
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary text-white flex items-center justify-center shadow-xs">
              <Camera size={9} />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-base font-bold text-text-primary group-hover:text-primary transition-colors">
                {baby.nickname}
              </span>
              <span className="text-sm">{baby.gender === "male" ? "👦" : "🎀"}</span>
            </div>
            <span className="text-xs text-text-secondary flex items-center gap-1">
              {age.label}
              <span className="text-[10px] text-primary font-medium hover:underline">· 换头像</span>
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={pageRefreshing}
            aria-label="刷新数据"
            className="w-9 h-9 rounded-full bg-white shadow-soft flex items-center justify-center btn-press text-text-secondary hover:text-primary transition-colors cursor-pointer disabled:opacity-60"
            title="刷新全部数据"
          >
            <RefreshCw size={15} className={pageRefreshing ? "animate-spin text-primary" : ""} />
          </button>
          <button
            onClick={() => router.push("/family")}
            aria-label="家庭共享"
            className="w-9 h-9 rounded-full bg-white shadow-soft flex items-center justify-center btn-press text-text-secondary hover:text-primary relative cursor-pointer"
            title="家庭成员与邀请码"
          >
            <Users size={16} />
          </button>
          <NotificationBell />
        </div>
      </div>

      {/* 📱 PWA 保存到桌面引导 Banner */}
      <InstallGuideBanner />

      {/* 🌟 2. iPad / PC 6:4 双栏响应式工作台网格 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* ===== 左栏：实时看板与作息主线 (60% / Col 7) ===== */}
        <div className="lg:col-span-7 space-y-5">
          {/* 🍼 上次喂养与睡眠即时状态卡片 */}
          <div className="grid grid-cols-2 gap-2.5">
            {/* 🍼 上次喂养状态 */}
            <CuteCard
              className="p-3.5 bg-gradient-to-br from-sky-50 to-blue-50/50 border border-sky-100 cursor-pointer hover:shadow-md transition-all"
              onClick={() => handleQuickRecord("feeding", "/records/feeding")}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-bold text-sky-900 flex items-center gap-1">
                  <Droplets size={13} className="text-sky-500" />
                  上次喂奶
                </span>
                <span className="text-[10px] text-sky-600 bg-sky-100/70 px-1.5 py-0.5 rounded-full font-bold">
                  {feedingElapsedText || "今日未记"}
                </span>
              </div>
              <p className="text-xs font-semibold text-text-primary truncate">
                {latestFeedingDetail || "点击记录本餐喂养"}
              </p>
              <div className="mt-2.5 pt-1.5 border-t border-sky-100 flex items-center justify-between text-[10px] text-sky-700 font-medium">
                <span>+ 记录喂奶</span>
                <ChevronRight size={12} />
              </div>
            </CuteCard>

            {/* 🌙 睡眠与清醒状态 */}
            <CuteCard
              className={`p-3.5 cursor-pointer hover:shadow-md transition-all border ${
                liveSleepStart
                  ? "bg-gradient-to-br from-purple-900 to-indigo-900 text-white border-purple-800 shadow-md animate-pulse"
                  : "bg-gradient-to-br from-purple-50 to-pink-50/50 border-purple-100"
              }`}
              onClick={() => handleQuickRecord("sleep", "/records/sleep")}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className={`text-[11px] font-bold flex items-center gap-1 ${liveSleepStart ? "text-yellow-300" : "text-purple-900"}`}>
                  <Moon size={13} className={liveSleepStart ? "text-yellow-300" : "text-purple-500"} />
                  {liveSleepStart ? "正在睡觉中" : "清醒时长"}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${liveSleepStart ? "bg-yellow-400 text-purple-950" : "text-purple-600 bg-purple-100/70"}`}>
                  {liveSleepStart ? liveSleepElapsed : awakeElapsedText ? `已清醒 ${awakeElapsedText}` : "点击记录"}
                </span>
              </div>
              <p className={`text-xs font-semibold truncate ${liveSleepStart ? "text-purple-100" : "text-text-primary"}`}>
                {liveSleepStart ? "点击结算唤醒 ☀️" : latestSleep ? `上次睡了 ${formatIsoToLocalTime(latestSleep.startTime)}~${formatIsoToLocalTime(latestSleep.endTime)}` : "点击开始入睡计时"}
              </p>
              <div className={`mt-2.5 pt-1.5 flex items-center justify-between text-[10px] font-medium ${liveSleepStart ? "border-t border-purple-800 text-yellow-300" : "border-t border-purple-100 text-purple-700"}`}>
                <span>{liveSleepStart ? "结算本次睡眠" : "+ 记录入睡"}</span>
                <ChevronRight size={12} />
              </div>
            </CuteCard>
          </div>

          {/* Daily Summary Stats */}
          <div>
            <div className="flex items-center justify-between mb-2 px-1">
              <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wider">今日累计概况</h3>
              <button
                onClick={() => router.push("/daily-summary")}
                className="text-[11px] font-bold text-primary hover:underline flex items-center gap-0.5 cursor-pointer"
              >
                查看完整日报 <ChevronRight size={12} />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <StatCard icon={<Droplets size={16} className="text-sky" />} label="奶量" value={String(summary.totalFeedingMl)} unit="ml" color="bg-sky/10" />
              <StatCard icon={<Moon size={16} className="text-lavender" />} label="睡眠" value={formatSleep(summary.totalSleepMinutes)} color="bg-lavender/10" />
              <StatCard icon={<Wind size={16} className="text-mint" />} label="尿布" value={String(summary.diaperCount)} unit="次" color="bg-mint/10" />
              <StatCard icon={<UtensilsCrossed size={16} className="text-peach" />} label="辅食" value={String(summary.foodCount)} unit="顿" color="bg-peach/10" />
            </div>

            {/* 🤖 AI 每日成长日报 Banner */}
            <CuteCard
              className="mt-2.5 p-3.5 bg-gradient-to-r from-primary-light via-lavender/20 to-pink-50/50 dark:from-primary-dark/20 dark:via-lavender/10 dark:to-transparent border border-primary/20 cursor-pointer hover:shadow-md transition-all group"
              onClick={() => router.push("/daily-summary")}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center">
                    <FileText size={13} />
                  </span>
                  <span className="text-xs font-bold text-text-primary group-hover:text-primary transition-colors">
                    AI 每日成长日报
                  </span>
                  {aiDailySummary?.overallScore && (
                    <span className="text-[10px] bg-primary text-white px-2 py-0.5 rounded-full font-bold">
                      {aiDailySummary.overallScore}
                    </span>
                  )}
                </div>
                <span className="text-[11px] font-bold text-primary flex items-center gap-0.5">
                  查看与分享 <ChevronRight size={13} />
                </span>
              </div>
              <p className="text-xs text-text-secondary line-clamp-1">
                {aiDailySummary?.headline || "点击生成今日奶量、睡眠、排便全量 AI 智能总结与儿科指导"}
              </p>
            </CuteCard>
          </div>

          {/* Quick Action Grid */}
          <div>
            <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-2 px-1">快捷记录</h3>
            <div className="grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-3 gap-2">
              <QuickActionCard icon={<Droplets size={22} />} label="记喂奶" color="#8DCBFF" onClick={() => handleQuickRecord("feeding", "/records/feeding")} />
              <QuickActionCard icon={<Moon size={22} />} label="记睡眠" color="#B98AF5" onClick={() => handleQuickRecord("sleep", "/records/sleep")} />
              <QuickActionCard icon={<Wind size={22} />} label="换尿布" color="#78DDB5" onClick={() => handleQuickRecord("diaper", "/records/diaper")} />
              <QuickActionCard icon={<UtensilsCrossed size={22} />} label="吃辅食" color="#FFB38A" onClick={() => handleQuickRecord("food", "/food/log")} />
              <QuickActionCard icon={<FileText size={22} />} label="每日总结" color="#FF6F9F" onClick={() => router.push("/daily-summary")} />
              <QuickActionCard icon={<Star size={22} />} label="发育里程" color="#B98AF5" onClick={() => router.push("/development")} />
            </div>
          </div>

          {/* 24-Hour Timeline */}
          <div>
            <div className="flex items-center justify-between mb-2 px-1">
              <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wider">今日作息时间轴</h3>
              <span className="text-[10px] text-text-muted">按时间倒序</span>
            </div>
            <Timeline items={timeline} onItemTap={(item) => setActionItem(item)} />
          </div>
        </div>

        {/* ===== 右栏：智能顾问、补剂打卡与环境分析 (40% / Col 5) ===== */}
        <div className="lg:col-span-5 space-y-5">
          {/* AI Assistant Advice & Unified AI Hub Launcher */}
          <CuteCard className="bg-gradient-to-br from-primary-light via-pink-50/40 to-lavender/15 border border-primary/20 p-4.5 space-y-3.5 shadow-soft hover:shadow-elevated transition-all">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-pink-500 text-white flex items-center justify-center shadow-xs animate-float">
                  <Sparkles size={16} />
                </div>
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-text-primary">AI 育儿智能中枢</h4>
                  <p className="text-[10px] text-text-muted">全科儿科数据库 · 智能复盘 · 视觉识别</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleRefreshAi}
                  disabled={aiLoading}
                  className="text-[11px] text-text-muted hover:text-primary flex items-center gap-1 btn-press disabled:opacity-50 cursor-pointer p-1 rounded-lg hover:bg-white/60 transition-colors"
                  title="刷新 AI 建议"
                >
                  <RefreshCw size={12} className={aiLoading ? "animate-spin text-primary" : ""} />
                </button>
                <QuickAiButton
                  contextType="general"
                  label="打开 AI 中枢"
                  contextTitle="AI 育儿智能中枢"
                  variant="primary"
                />
              </div>
            </div>

            {/* 4 Fast AI Entry Pills */}
            <div className="grid grid-cols-4 gap-1.5 pt-0.5">
              <button
                type="button"
                onClick={() => openQuickAI({ contextTitle: "AI 育儿智能中枢", initialPrompt: "请帮我分析宝宝今天的整体作息与发育重点" })}
                className="flex flex-col items-center justify-center p-2 rounded-xl bg-white/80 dark:bg-card/80 hover:bg-white dark:hover:bg-card border border-primary/10 hover:border-primary/30 shadow-2xs hover:shadow-xs transition-all card-hover-lift cursor-pointer group"
              >
                <MessageSquare size={14} className="text-primary group-hover:scale-115 transition-transform" />
                <span className="text-[10px] font-bold mt-1 text-text-primary">问答记账</span>
              </button>

              <button
                type="button"
                onClick={() => router.push("/daily-summary")}
                className="flex flex-col items-center justify-center p-2 rounded-xl bg-white/80 dark:bg-card/80 hover:bg-white dark:hover:bg-card border border-primary/10 hover:border-primary/30 shadow-2xs hover:shadow-xs transition-all card-hover-lift cursor-pointer group"
              >
                <FileText size={14} className="text-pink-500 group-hover:scale-115 transition-transform" />
                <span className="text-[10px] font-bold mt-1 text-text-primary">今日日报</span>
              </button>

              <button
                type="button"
                onClick={() => openQuickAI({ contextType: "medical", contextTitle: "多模态视觉识别中枢" })}
                className="flex flex-col items-center justify-center p-2 rounded-xl bg-white/80 dark:bg-card/80 hover:bg-white dark:hover:bg-card border border-primary/10 hover:border-primary/30 shadow-2xs hover:shadow-xs transition-all card-hover-lift cursor-pointer group"
              >
                <Camera size={14} className="text-blue-500 group-hover:scale-115 transition-transform" />
                <span className="text-[10px] font-bold mt-1 text-text-primary">拍照识单</span>
              </button>

              <button
                type="button"
                onClick={() => openQuickAI({ contextTitle: "专科题库与问答锦囊" })}
                className="flex flex-col items-center justify-center p-2 rounded-xl bg-white/80 dark:bg-card/80 hover:bg-white dark:hover:bg-card border border-primary/10 hover:border-primary/30 shadow-2xs hover:shadow-xs transition-all card-hover-lift cursor-pointer group"
              >
                <Star size={14} className="text-amber-500 group-hover:scale-115 transition-transform" />
                <span className="text-[10px] font-bold mt-1 text-text-primary">专科题库</span>
              </button>
            </div>

            {/* AI Real-time Advice List */}
            {aiLoading ? (
              <div className="space-y-2 py-2 animate-pulse">
                <div className="h-3 bg-primary-soft/50 rounded-full w-full" />
                <div className="h-3 bg-primary-soft/30 rounded-full w-5/6" />
              </div>
            ) : aiError ? (
              <div className="p-2.5 rounded-xl bg-red-50/70 border border-red-100 flex items-start gap-2">
                <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-xs font-medium text-red-700">{aiError}</p>
                  <button
                    onClick={handleRefreshAi}
                    className="mt-1 text-[11px] text-red-600 underline font-semibold cursor-pointer"
                  >
                    重试加载
                  </button>
                </div>
              </div>
            ) : aiTips && aiTips.length > 0 ? (
              <ul className="space-y-2 text-xs text-text-primary leading-relaxed pt-1 border-t border-primary/10">
                {aiTips.map((tip, idx) => (
                  <li key={idx} className="flex items-start gap-2 animate-slide-up">
                    <span className="w-4 h-4 rounded-full bg-primary/20 text-primary text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                      {idx + 1}
                    </span>
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-text-muted">暂无育儿建议，请点击右上角刷新获取</p>
            )}
          </CuteCard>

          {/* 💊 今日补剂快速打卡与安全守护 */}
          <SupplementQuickCheckIn babyId={baby?.id} />

          {/* ⛅ Weather Card */}
          {weather && (
            <CuteCard className="p-4 cursor-pointer hover:shadow-md transition-all" onClick={() => router.push("/weather")}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-sky/15 flex items-center justify-center text-2xl">
                    {weather.condition.includes("晴") ? "☀️" : weather.condition.includes("雨") ? "🌧️" : "⛅"}
                  </div>
                  <div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-xl font-bold text-text-primary">{weather.temperature}°C</span>
                      <span className="text-xs text-text-secondary">({weather.city}) {weather.condition}</span>
                    </div>
                    <p className="text-[11px] text-text-muted mt-0.5">
                      UV {weather.uv} · 降雨 {weather.rainProbability}% · 空气{weather.airQuality}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="inline-block px-2.5 py-1 rounded-full bg-mint/15 text-[11px] font-medium text-mint whitespace-nowrap">
                    {weather.outdoorAdvice}
                  </span>
                </div>
              </div>
            </CuteCard>
          )}
        </div>
      </div>

      {/* Record Action Sheet & Edit Dialog */}
      <RecordActionSheet
        item={actionItem}
        onClose={() => setActionItem(null)}
        onEdit={(item) => {
          setActionItem(null);
          setEditingRecord(item);
        }}
        onDelete={(item) => {
          setActionItem(null);
          if (window.confirm(`确定删除「${item.title}」这条记录吗？`)) {
            deleteTimelineRecord(item.type, item.id).catch(() =>
              window.alert("删除失败，请重试")
            );
          }
        }}
      />

      <RecordEditDialog
        item={editingRecord}
        onClose={() => setEditingRecord(null)}
        onSubmit={async (patch) => {
          if (!editingRecord) return;
          await updateTimelineRecord(editingRecord.type, editingRecord.id, patch);
        }}
      />

      {/* App Version Footer */}
      <div className="text-center pt-4 pb-6">
        <p className="text-[10px] text-text-muted/60">
          宝宝成长工作台 {APP_VERSION}
        </p>
      </div>
    </div>
  );
}
