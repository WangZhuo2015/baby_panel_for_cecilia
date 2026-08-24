"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellOff, Trash2, Shield, Sparkles, Clock, CheckCircle } from "lucide-react";
import { AppHeader } from "@/components/ui/AppHeader";
import { CuteCard } from "@/components/ui/CuteCard";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { useToast } from "@/components/ui/Toast";
import { InstallGuideModal } from "@/components/ui/InstallGuideModal";

interface NotificationItem {
  id: string;
  type: "vaccine" | "ai" | "daily" | "data_release";
  title: string;
  detail: string;
  time: string;
  urgent: boolean;
  icon: string;
}

const READ_IDS_KEY = "notification-read-ids";

function getReadIds(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_IDS_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveReadIds(ids: Set<string>) {
  localStorage.setItem(READ_IDS_KEY, JSON.stringify([...ids]));
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission | "unsupported">(
    "default"
  );
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const { showToast } = useToast();
  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : data?.notifications ?? [];
      setNotifications(list);

      // Prune read ids that no longer exist so localStorage stays bounded
      setReadIds((prev) => {
        const valid = new Set(list.map((n: NotificationItem) => n.id));
        const pruned = new Set([...prev].filter((id) => valid.has(id)));
        if (pruned.size !== prev.size) saveReadIds(pruned);
        return pruned;
      });
    } catch (e) {
      console.error("Failed to fetch notifications:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  const markRead = useCallback(
    (id: string) => {
      setReadIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        saveReadIds(next);
        return next;
      });
      window.dispatchEvent(new CustomEvent("notifications-read"));
    },
    []
  );

  useEffect(() => {
    // Read stored read IDs
    setReadIds(getReadIds());

    // Check push support
    if (typeof window !== "undefined" && "Notification" in window) {
      setPushPermission(Notification.permission);
      // Check if service worker is registered
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.getRegistration().then((reg) => {
          setPushEnabled(!!reg && Notification.permission === "granted");
        });
      }
    } else {
      setPushPermission("unsupported");
    }

    fetchNotifications();
  }, [fetchNotifications]);

  const unreadCount = notifications.filter((n) => !readIds.has(n.id)).length;

  const handleEnablePush = async () => {
    try {
      // iOS Safari 需先安装到主屏幕（standalone）才有 Push API
      const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const isStandalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as { standalone?: boolean }).standalone === true;
      if (isIos && !isStandalone) {
        showToast("iOS 需先「添加到主屏幕」，从桌面图标打开才能开启推送");
        setShowInstallGuide(true);
        return;
      }

      if (!("Notification" in window)) {
        showToast("您的浏览器不支持推送通知");
        return;
      }

      const permission = await Notification.requestPermission();
      setPushPermission(permission);

      if (permission !== "granted") {
        showToast("推送通知权限被拒绝");
        return;
      }

      if (!("serviceWorker" in navigator)) {
        showToast("您的浏览器不支持 Service Worker");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      await registration.update();

      // Get VAPID public key
      const keyRes = await fetch("/api/push/vapid-key");
      if (!keyRes.ok) throw new Error("Failed to get VAPID key");
      const { publicKey } = await keyRes.json();

      // Subscribe to push
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKey,
      });

      // Save subscription to server
      const subRes = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });

      if (subRes.ok) {
        setPushEnabled(true);
        showToast("推送通知已开启 ✨");
      } else {
        showToast("订阅保存失败");
      }
    } catch (error) {
      console.error("Push subscription error:", error);
      showToast("开启推送通知失败");
    }
  };

  const handleClearAll = () => {
    setNotifications([]);
    const allIds = new Set(notifications.map((n) => n.id));
    const merged = new Set([...readIds, ...allIds]);
    setReadIds(merged);
    saveReadIds(merged);
    window.dispatchEvent(new CustomEvent("notifications-read"));
    showToast("已全部清除");
  };

  const vaccineNotifs = notifications.filter((n) => n.type === "vaccine");
  const aiNotifs = notifications.filter((n) => n.type === "ai");
  const dailyNotifs = notifications.filter((n) => n.type === "daily");

  return (
    <div className="px-4 pt-12 pb-8">
      {/* Header */}
      <AppHeader
        title="通知中心"
        showBack
        rightAction={
          notifications.length > 0 ? (
            <button
              onClick={handleClearAll}
              className="btn-press flex items-center gap-1 text-xs text-text-muted"
            >
              <Trash2 size={14} />
              <span>清除</span>
            </button>
          ) : undefined
        }
      />

      {/* Push notification toggle */}
      <CuteCard variant="gradient" className="mb-5 mt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-lavender/15 flex items-center justify-center">
              {pushEnabled ? (
                <Bell size={20} className="text-lavender" />
              ) : (
                <BellOff size={20} className="text-text-muted" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-text-primary">推送通知</p>
              <p className="text-xs text-text-muted">
                {pushEnabled
                  ? "已开启，新消息会自动推送"
                  : pushPermission === "unsupported"
                    ? "浏览器不支持"
                    : "开启浏览器推送通知"}
              </p>
            </div>
          </div>
          {!pushEnabled && pushPermission !== "unsupported" && (
            <button
              onClick={handleEnablePush}
              className="px-4 py-2 rounded-full bg-primary text-white text-xs font-medium btn-press shadow-button"
            >
              开启推送通知
            </button>
          )}
          {pushEnabled && (
            <span className="flex items-center gap-1 text-xs text-mint font-medium">
              <CheckCircle size={14} />
              已开启
            </span>
          )}
        </div>
      </CuteCard>

      {/* Unread indicator */}
      {unreadCount > 0 && (
        <div className="mb-4 px-1">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-xs font-medium text-primary">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            {unreadCount} 条未读通知
          </span>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-10 h-10 rounded-full bg-primary-soft flex items-center justify-center mb-3">
            <Clock size={20} className="text-primary animate-pulse" />
          </div>
          <p className="text-sm text-text-muted">加载中...</p>
        </div>
      ) : notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-16 h-16 rounded-full bg-primary-soft flex items-center justify-center mb-4">
            <span className="text-3xl">🔔</span>
          </div>
          <p className="text-base font-medium text-text-primary mb-1">暂无通知</p>
          <p className="text-sm text-text-muted">一切安好，没有新消息哦～</p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Vaccine reminders group */}
          {vaccineNotifs.length > 0 && (
            <div>
              <SectionTitle
                title="疫苗提醒"
                icon={<Shield size={18} className="text-primary" />}
                className="mb-3"
                action={
                  <span className="text-xs text-text-muted">
                    {vaccineNotifs.length} 条
                  </span>
                }
              />
              <div className="space-y-2.5">
                {vaccineNotifs.map((notif) => (
                  <NotificationCard key={notif.id} notification={notif} read={readIds.has(notif.id)} onRead={markRead} />
                ))}
              </div>
            </div>
          )}

          {/* AI Tips group */}
          {aiNotifs.length > 0 && (
            <div>
              <SectionTitle
                title="AI 建议"
                icon={<Sparkles size={18} className="text-lavender" />}
                className="mb-3"
                action={
                  <span className="text-xs text-text-muted">
                    {aiNotifs.length} 条
                  </span>
                }
              />
              <div className="space-y-2.5">
                {aiNotifs.map((notif) => (
                  <NotificationCard key={notif.id} notification={notif} read={readIds.has(notif.id)} onRead={markRead} />
                ))}
              </div>
            </div>
          )}

          {/* Daily reminders group */}
          {dailyNotifs.length > 0 && (
            <div>
              <SectionTitle
                title="日常提醒"
                icon={<Clock size={18} className="text-sky" />}
                className="mb-3"
                action={
                  <span className="text-xs text-text-muted">
                    {dailyNotifs.length} 条
                  </span>
                }
              />
              <div className="space-y-2.5">
                {dailyNotifs.map((notif) => (
                  <NotificationCard key={notif.id} notification={notif} read={readIds.has(notif.id)} onRead={markRead} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Disclaimer */}
      <p className="text-[10px] text-text-muted text-center mt-8">
        AI 建议仅供参考，如有疑问请咨询专业医生。
      </p>

      <InstallGuideModal isOpen={showInstallGuide} onClose={() => setShowInstallGuide(false)} />
    </div>
  );
}

function NotificationCard({
  notification,
  read,
  onRead,
}: {
  notification: NotificationItem;
  read: boolean;
  onRead: (id: string) => void;
}) {
  const router = useRouter();

  const handleClick = () => {
    if (!read) onRead(notification.id);
    // Route to relevant page based on notification type
    if (notification.type === "vaccine") {
      router.push("/health/vaccines");
    } else if (notification.type === "daily") {
      if (notification.title.includes("喂奶")) {
        router.push("/records/feeding");
      } else if (notification.title.includes("睡眠")) {
        router.push("/records/sleep");
      } else if (notification.title.includes("辅食")) {
        router.push("/food/log");
      }
    }
  };

  const borderColor = notification.urgent
    ? "border-l-primary"
    : notification.type === "vaccine"
      ? "border-l-primary/50"
      : notification.type === "ai"
        ? "border-l-lavender/50"
        : "border-l-sky/50";

  return (
    <CuteCard
      className={`${!read ? "ring-1 ring-primary/20" : ""} border-l-[3px] ${borderColor} card-press cursor-pointer`}
      onClick={handleClick}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-primary-light/50 flex items-center justify-center">
          <span className="text-lg">{notification.icon}</span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className={`text-sm ${!read ? "font-semibold" : "font-medium"} text-text-primary truncate`}>
              {notification.title}
            </p>
            {!read && (
              <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
            )}
          </div>
          <p className="text-xs text-text-secondary mt-0.5 leading-relaxed line-clamp-2">
            {notification.detail}
          </p>
          <p className="text-[10px] text-text-muted mt-1.5">{notification.time}</p>
        </div>
      </div>
    </CuteCard>
  );
}
