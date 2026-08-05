"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Baby, Droplets, Moon, Wind, UtensilsCrossed, Bell } from "lucide-react";
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
    baby,
    dailySummary,
    timeline,
    weather,
    aiTips,
    fetchBaby,
    fetchDailySummary,
    fetchTimeline,
    fetchWeather,
    fetchAiTips,
  } = useBabyStore();

  const [initialized, setInitialized] = useState(true);

  useEffect(() => {
    fetchBaby().then(() => {
      setInitialized(!!useBabyStore.getState().baby);
    });
    fetchDailySummary();
    fetchTimeline();
    fetchWeather();
    fetchAiTips();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!initialized) {
    return (
      <div className="px-4 pt-12 pb-8">
        <div className="flex items-center justify-center min-h-[70vh]">
          <CuteCard variant="gradient" className="w-full max-w-sm">
            <div className="flex flex-col items-center text-center py-6 px-2">
              <div className="w-20 h-20 rounded-full bg-white/70 flex items-center justify-center mb-4">
                <span className="text-4xl">👶</span>
              </div>
              <p className="text-lg font-bold text-text-primary mb-1">欢迎使用宝宝成长工作台</p>
              <p className="text-sm text-text-secondary mb-5">
                先设置宝宝信息，就能开始记录喂奶、睡眠、成长啦
              </p>
              <button
                onClick={() => router.push("/onboarding")}
                className="px-6 py-3 rounded-full bg-primary text-white text-sm font-medium shadow-button btn-press"
              >
                立即设置宝宝信息
              </button>
            </div>
          </CuteCard>
        </div>
      </div>
    );
  }

  const age = baby ? calculateAge(baby.birthDate) : { months: 0, days: 0, label: "0月0天" };
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "早上好" : hour < 18 ? "下午好" : "晚上好";

  const summary = dailySummary ?? { totalFeedingMl: 0, totalSleepMinutes: 0, diaperCount: 0, foodCount: 0 };
  const aiTip = aiTips[0] ?? "暂无建议";

  const formatSleep = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h${m > 0 ? `${m}m` : ""}`;
  };

  return (
    <div className="px-4 pt-12 pb-36">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-primary-soft to-primary/30 flex items-center justify-center overflow-hidden shadow-soft">
            <Baby size={28} className="text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-lg font-bold text-text-primary">{baby?.nickname ?? ""}</span>
              <span className="text-base">🎀</span>
            </div>
            <span className="text-sm text-text-secondary">{age.label}</span>
          </div>
        </div>
        <NotificationBell />
      </div>

      {/* Welcome */}
      <CuteCard variant="gradient" className="mb-4">
        <p className="text-base font-semibold text-text-primary mb-1">
          {greeting}，妈妈！
        </p>
        <p className="text-sm text-text-secondary">
          {baby?.nickname ?? ""}今天也要健康快乐地成长哦～
        </p>
      </CuteCard>

      {/* Weather */}
      {weather && (
        <CuteCard className="mb-5 cursor-pointer" onClick={() => router.push("/weather")}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-sky/15 flex items-center justify-center">
                <span className="text-2xl">⛅</span>
              </div>
              <div>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-text-primary">{weather.temperature}°C</span>
                  <span className="text-sm text-text-secondary">{weather.condition}</span>
                </div>
                <p className="text-xs text-text-muted mt-0.5">
                  UV {weather.uv} · 降雨{weather.rainProbability}%
                </p>
              </div>
            </div>
            <div className="text-right">
              <span className="inline-block px-3 py-1.5 rounded-full bg-mint/15 text-xs font-medium text-mint">
                {weather.outdoorAdvice}
              </span>
              <p className="text-xs text-primary mt-1.5 font-medium">查看详情 →</p>
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

      {/* AI Assistant */}
      <CuteCard className="mt-5 bg-gradient-to-br from-primary-light to-lavender/5 border border-lavender/20">
        <div className="flex gap-3">
          <div className="flex-shrink-0 w-12 h-12 rounded-2xl bg-lavender/15 flex items-center justify-center">
            <span className="text-2xl">🤖</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-text-primary leading-relaxed mb-2">{aiTip}</p>
            <button onClick={() => router.push("/development")} className="text-xs font-medium text-primary btn-press">
              查看更多建议 →
            </button>
          </div>
        </div>
        <p className="text-[10px] text-text-muted mt-3 pt-2 border-t border-primary-soft/50">
          AI 建议仅供参考，如有疑问请咨询专业医生。
        </p>
      </CuteCard>
    </div>
  );
}
