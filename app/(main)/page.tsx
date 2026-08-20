"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Baby, Droplets, Moon, Wind, UtensilsCrossed, Bell, Users, RefreshCw, AlertCircle, Sparkles } from "lucide-react";
import { useBabyStore } from "@/stores/useBabyStore";
import { calculateAge } from "@/lib/age";
import { StatCard } from "@/components/ui/StatCard";
import { QuickActionCard } from "@/components/ui/QuickActionCard";
import { Timeline } from "@/components/ui/Timeline";
import { CuteCard } from "@/components/ui/CuteCard";

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
    return () => window.removeEventListener("notifications-read", handler);
  }, [fetchCount]);

  return (
    <button
      onClick={() => router.push("/notifications")}
      aria-label="通知"
      className="w-10 h-10 rounded-full bg-white shadow-soft flex items-center justify-center btn-press relative"
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

export default function TodayPage() {
  const router = useRouter();
  const {
    user,
    family,
    baby,
    dailySummary,
    timeline,
    weather,
    aiTips,
    aiError,
    fetchUser,
    fetchBaby,
    fetchDailySummary,
    fetchTimeline,
    fetchWeather,
    fetchAiTips,
  } = useBabyStore();

  const [initialLoading, setInitialLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    const init = async () => {
      await fetchUser();
      await fetchBaby();
      fetchDailySummary();
      fetchTimeline();
      fetchWeather();
      fetchAiTips();
      setInitialLoading(false);
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefreshAi = async () => {
    setAiLoading(true);
    await fetchAiTips();
    setAiLoading(false);
  };

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center min-h-[70vh]">
        <div className="text-center text-text-muted text-sm flex flex-col items-center gap-2">
          <span className="text-3xl animate-bounce">👶</span>
          <span>加载中...</span>
        </div>
      </div>
    );
  }

  if (!baby) {
    return (
      <div className="px-4 pt-12 pb-8">
        <div className="flex items-center justify-center min-h-[70vh]">
          <CuteCard variant="gradient" className="w-full max-w-sm">
            <div className="flex flex-col items-center text-center py-6 px-2">
              <div className="w-20 h-20 rounded-full bg-white/70 flex items-center justify-center mb-4 shadow-soft">
                <span className="text-4xl">👶</span>
              </div>
              <p className="text-lg font-bold text-text-primary mb-1">欢迎使用宝宝成长工作台</p>
              <p className="text-sm text-text-secondary mb-5">
                {user ? "先完善宝宝信息，开始记录日常与生长发育" : "登录或注册账号，与家庭成员共同记录宝宝成长"}
              </p>
              {user ? (
                <button
                  onClick={() => router.push("/onboarding")}
                  className="px-6 py-3 rounded-full bg-primary text-white text-sm font-medium shadow-button btn-press"
                >
                  立即设置宝宝信息
                </button>
              ) : (
                <div className="flex flex-col gap-2 w-full max-w-xs">
                  <button
                    onClick={() => router.push("/login")}
                    className="px-6 py-2.5 rounded-full bg-primary text-white text-sm font-medium shadow-button btn-press"
                  >
                    登录已有账号
                  </button>
                  <button
                    onClick={() => router.push("/register")}
                    className="px-6 py-2.5 rounded-full bg-white text-text-primary border border-divider text-sm font-medium btn-press"
                  >
                    注册新账号 / 加入家庭
                  </button>
                </div>
              )}
            </div>
          </CuteCard>
        </div>
      </div>
    );
  }

  const age = calculateAge(baby.birthDate);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "早上好" : hour < 18 ? "下午好" : "晚上好";
  const userGreetingName = user?.displayName || "家长";

  const summary = dailySummary ?? { totalFeedingMl: 0, totalSleepMinutes: 0, diaperCount: 0, foodCount: 0 };

  const formatSleep = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h${m > 0 ? `${m}m` : ""}`;
  };

  return (
    <div className="px-4 pt-8 pb-36 max-w-md mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-13 h-13 rounded-full bg-gradient-to-br from-primary-soft to-primary/30 flex items-center justify-center overflow-hidden shadow-soft">
            <Baby size={26} className="text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-lg font-bold text-text-primary">{baby.nickname}</span>
              <span className="text-base">{baby.gender === "male" ? "👦" : "🎀"}</span>
            </div>
            <span className="text-xs text-text-secondary">{age.label}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Family Sharing Button */}
          <button
            onClick={() => router.push("/family")}
            aria-label="家庭共享"
            className="w-10 h-10 rounded-full bg-white shadow-soft flex items-center justify-center btn-press text-text-secondary hover:text-primary relative"
            title="家庭成员与邀请码"
          >
            <Users size={18} />
          </button>
          <NotificationBell />
        </div>
      </div>

      {/* Welcome & Family greeting */}
      <CuteCard variant="gradient" className="mb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-base font-semibold text-text-primary mb-0.5">
              {greeting}，{userGreetingName}！
            </p>
            <p className="text-xs text-text-secondary">
              {baby.nickname}今天也要健康快乐地成长哦～
            </p>
          </div>
          {family?.inviteCode && (
            <Link
              href="/family"
              className="text-[11px] px-2.5 py-1 rounded-full bg-white/80 text-primary font-medium border border-primary/20 hover:bg-white flex items-center gap-1"
            >
              <Users size={12} /> 邀请码: {family.inviteCode}
            </Link>
          )}
        </div>
      </CuteCard>

      {/* Weather */}
      {weather && (
        <CuteCard className="mb-5 cursor-pointer" onClick={() => router.push("/weather")}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-sky/15 flex items-center justify-center">
                <span className="text-2xl">{weather.condition.includes("晴") ? "☀️" : weather.condition.includes("雨") ? "🌧️" : "⛅"}</span>
              </div>
              <div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold text-text-primary">{weather.temperature}°C</span>
                  <span className="text-xs text-text-secondary">({weather.city}) {weather.condition}</span>
                </div>
                <p className="text-xs text-text-muted mt-0.5">
                  UV {weather.uv} · 降雨 {weather.rainProbability}% · 空气{weather.airQuality}
                </p>
              </div>
            </div>
            <div className="text-right">
              <span className="inline-block px-3 py-1.5 rounded-full bg-mint/15 text-xs font-medium text-mint">
                {weather.outdoorAdvice}
              </span>
              <p className="text-xs text-primary mt-1.5 font-medium">查看天气 →</p>
            </div>
          </div>
        </CuteCard>
      )}

      {/* Daily Summary */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <StatCard icon={<Droplets size={20} className="text-sky" />} label="奶量" value={String(summary.totalFeedingMl)} unit="ml" color="bg-sky/10" />
        <StatCard icon={<Moon size={20} className="text-lavender" />} label="睡眠" value={formatSleep(summary.totalSleepMinutes)} color="bg-lavender/10" />
        <StatCard icon={<Wind size={20} className="text-mint" />} label="尿布" value={String(summary.diaperCount)} unit="次" color="bg-mint/10" />
        <StatCard icon={<UtensilsCrossed size={20} className="text-peach" />} label="辅食" value={String(summary.foodCount)} unit="次" color="bg-peach/10" />
      </div>

      {/* Quick Actions */}
      <h3 className="text-sm font-semibold text-text-secondary mb-3 px-1">快捷记录</h3>
      <div className="grid grid-cols-4 gap-2.5 mb-6">
        <QuickActionCard icon={<Droplets size={24} />} label="喂奶" color="#8DCBFF" onClick={() => router.push("/records/feeding")} />
        <QuickActionCard icon={<Moon size={24} />} label="睡觉" color="#B98AF5" onClick={() => router.push("/records/sleep")} />
        <QuickActionCard icon={<Wind size={24} />} label="尿布" color="#78DDB5" onClick={() => router.push("/records/diaper")} />
        <QuickActionCard icon={<UtensilsCrossed size={24} />} label="辅食" color="#FFB38A" onClick={() => router.push("/food/log")} />
      </div>

      {/* Timeline */}
      <h3 className="text-sm font-semibold text-text-secondary mb-3 px-1">今日时间轴</h3>
      <Timeline items={timeline} />

      {/* AI Assistant Section (Strict error reporting, No Fake Tips) */}
      <CuteCard className="mt-5 bg-gradient-to-br from-primary-light to-lavender/10 border border-lavender/25">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xl">🤖</span>
            <h4 className="text-sm font-bold text-text-primary">AI 育儿助手</h4>
          </div>
          <button
            onClick={handleRefreshAi}
            disabled={aiLoading}
            className="text-xs text-text-muted hover:text-primary flex items-center gap-1 btn-press disabled:opacity-50"
            title="刷新 AI 建议"
          >
            <RefreshCw size={12} className={aiLoading ? "animate-spin" : ""} />
            {aiLoading ? "生成中..." : "刷新"}
          </button>
        </div>

        {aiError ? (
          <div className="bg-red-50/80 border border-red-200/70 rounded-xl p-3 my-1">
            <div className="flex items-start gap-2">
              <AlertCircle size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-xs font-medium text-red-700">{aiError}</p>
                <p className="text-[11px] text-red-500 mt-0.5">
                  请在环境变量中配置 AI 服务 (如 AI_API_KEY / AI_BASE_URL)
                </p>
                <button
                  onClick={handleRefreshAi}
                  className="mt-2 text-xs font-semibold text-red-600 underline"
                >
                  重新尝试获取
                </button>
              </div>
            </div>
          </div>
        ) : aiTips.length > 0 ? (
          <div className="space-y-2 my-1">
            {aiTips.map((tip, idx) => (
              <div key={idx} className="flex items-start gap-2 bg-white/70 rounded-xl p-2.5">
                <Sparkles size={14} className="text-primary mt-0.5 flex-shrink-0" />
                <p className="text-xs text-text-primary leading-relaxed">{tip}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-text-muted py-2">
            {aiLoading ? "正在结合宝宝月龄生成智能建议..." : "暂无育儿建议，点击右上角刷新生成。"}
          </p>
        )}

        <div className="flex items-center justify-between mt-3 pt-2 border-t border-primary-soft/50">
          <p className="text-[10px] text-text-muted">
            AI 建议仅供参考，不作为医疗诊断依据。
          </p>
          <button onClick={() => router.push("/development")} className="text-xs font-medium text-primary btn-press">
            更多参考 →
          </button>
        </div>
      </CuteCard>
    </div>
  );
}
