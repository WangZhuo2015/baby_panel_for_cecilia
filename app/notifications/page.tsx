"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  BellOff,
  Clock,
  Shield,
  Trash2,
  CheckCircle,
  Users,
  Send,
  Smartphone,
  RefreshCw,
  X,
} from "lucide-react";
import { CuteCard } from "@/components/ui/CuteCard";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { AppHeader } from "@/components/ui/AppHeader";
import { useBabyStore } from "@/stores/useBabyStore";
import { useToast } from "@/components/ui/Toast";
import { InstallGuideModal } from "@/components/ui/InstallGuideModal";
import {
  getReadNotificationIds,
  markNotificationRead,
  markAllNotificationsRead,
  setClearedBeforeTime,
  addDismissedNotificationId,
  filterVisibleNotifications,
} from "@/lib/notifications-storage";

interface NotificationItem {
  id: string;
  type: "vaccine" | "daily" | "data_release" | "family";
  title: string;
  detail: string;
  time: string;
  urgent: boolean;
  icon: string;
  actorId?: string | null;
  actorLabel?: string | null;
  createdAt?: number;
}

/** 将 VAPID Base64 字符串转换为浏览器 PushManager 必需的 Uint8Array */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushPermission, setPushPermission] = useState<string>("default");
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [testingPush, setTestingPush] = useState(false);
  const [enablingPush, setEnablingPush] = useState(false);

  const baby = useBabyStore((s) => s.baby);
  const { showToast } = useToast();

  /** 强制生成最新有效的推送订阅并同步至服务端 */
  const subscribeFresh = useCallback(
    async (readyReg: ServiceWorkerRegistration): Promise<PushSubscription | null> => {
      try {
        const keyRes = await fetch("/api/push/vapid-key");
        if (!keyRes.ok) throw new Error("获取推送公钥失败");
        const { publicKey } = await keyRes.json();

        // 先退订本地旧的或失效的订阅凭据，防止 key 漂移冲突
        const oldSub = await readyReg.pushManager.getSubscription();
        if (oldSub) {
          await oldSub.unsubscribe().catch(() => {});
        }

        // 获取全新的当前有效订阅（必须传 Uint8Array）
        const appServerKey = urlBase64ToUint8Array(publicKey);
        const newSub = await readyReg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: appServerKey as unknown as BufferSource,
        });

        // 立即上传并绑定到当前用户
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newSub.toJSON()),
        });

        setPushEnabled(true);
        return newSub;
      } catch (e) {
        console.error("subscribeFresh error:", e);
        return null;
      }
    },
    []
  );

  const checkAndSyncPush = useCallback(async () => {
    if (typeof window === "undefined") return;

    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;

    if (isIos && !isStandalone) {
      setPushPermission("ios_not_standalone");
      setPushEnabled(false);
      return;
    }

    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setPushPermission("unsupported");
      setPushEnabled(false);
      return;
    }

    const perm = Notification.permission;
    setPushPermission(perm);

    if (perm === "granted") {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          setPushEnabled(true);
          // 自动向后端同步当前用户与设备订阅绑定
          fetch("/api/push/subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(sub.toJSON()),
          }).catch(() => {});
        } else {
          setPushEnabled(false);
        }
      } catch {
        setPushEnabled(false);
      }
    } else {
      setPushEnabled(false);
    }
  }, []);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const url = baby?.id
        ? `/api/notifications?babyId=${baby.id}`
        : "/api/notifications";
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const visible = filterVisibleNotifications(Array.isArray(data) ? data : []);
        setNotifications(visible);
        if (visible.length > 0) {
          markAllNotificationsRead(visible.map((n) => n.id));
          setReadIds(getReadNotificationIds());
          window.dispatchEvent(new CustomEvent("notifications-read"));
        }
      }
    } catch {
      // Offline fallback
    } finally {
      setLoading(false);
    }
  }, [baby?.id]);

  const markRead = useCallback((id: string) => {
    markNotificationRead(id);
    setReadIds(getReadNotificationIds());
    window.dispatchEvent(new CustomEvent("notifications-read"));
  }, []);

  const handleDismiss = useCallback((id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    addDismissedNotificationId(id);
    markNotificationRead(id);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    setReadIds(getReadNotificationIds());
    window.dispatchEvent(new CustomEvent("notifications-read"));
    showToast("已清除此条通知 ✨");
  }, [showToast]);

  useEffect(() => {
    setReadIds(getReadNotificationIds());
    checkAndSyncPush();
    fetchNotifications();
  }, [fetchNotifications, checkAndSyncPush]);

  const unreadCount = notifications.filter((n) => !readIds.has(n.id)).length;

  const handleEnablePush = async () => {
    if (enablingPush) return;
    setEnablingPush(true);
    try {
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
        showToast("推送权限未开启，请在浏览器设置中允许通知", "error");
        return;
      }

      if (!("serviceWorker" in navigator)) {
        showToast("您的浏览器不支持 Service Worker");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      await registration.update();
      const readyReg = await navigator.serviceWorker.ready;

      const newSub = await subscribeFresh(readyReg);
      if (newSub) {
        showToast("设备推送已绑定并就绪 ✨", "success");
      } else {
        showToast("绑定失败，请检查网络设置", "error");
      }
    } catch (error) {
      console.error("Push subscription error:", error);
      showToast("开启推送通知失败，请重试", "error");
    } finally {
      setEnablingPush(false);
    }
  };

  const handleSendTestPush = async () => {
    if (testingPush) return;
    setTestingPush(true);
    try {
      let subPayload: any = null;

      if ("serviceWorker" in navigator && "Notification" in window) {
        if (Notification.permission === "default") {
          const perm = await Notification.requestPermission();
          setPushPermission(perm);
        }

        if (Notification.permission === "granted") {
          const readyReg = await navigator.serviceWorker.ready;
          let sub = await readyReg.pushManager.getSubscription();
          if (!sub) {
            sub = await subscribeFresh(readyReg);
          }
          if (sub) {
            subPayload = sub.toJSON();
          }
        }
      }

      const res = await fetch("/api/push/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: subPayload }),
      });
      const data = await res.json();

      if (res.ok) {
        setPushEnabled(true);
        showToast("测试推送已发出，请查看手机/电脑系统通知栏 ✨", "success");
      } else {
        showToast(data.error || "发送测试推送失败", "error");
      }
    } catch {
      showToast("网络请求失败，请稍后重试", "error");
    } finally {
      setTestingPush(false);
    }
  };

  const handleClearAll = () => {
    setClearedBeforeTime(Date.now());
    markAllNotificationsRead(notifications.map((n) => n.id));
    setNotifications([]);
    setReadIds(getReadNotificationIds());
    window.dispatchEvent(new CustomEvent("notifications-read"));
    showToast("已清除全部通知 ✨", "success");
  };

  const familyNotifs = notifications.filter((n) => n.type === "family");
  const vaccineNotifs = notifications.filter((n) => n.type === "vaccine");
  const dailyNotifs = notifications.filter((n) => n.type === "daily");

  return (
    <div className="px-4 pb-8">
      {/* Header */}
      <AppHeader
        title="通知中心"
        showBack
        onRefresh={fetchNotifications}
        refreshing={loading}
        rightAction={
          notifications.length > 0 ? (
            <button
              onClick={handleClearAll}
              className="btn-press flex items-center gap-1 text-xs text-text-muted hover:text-primary transition-colors cursor-pointer"
            >
              <Trash2 size={14} />
              <span>全部清除</span>
            </button>
          ) : undefined
        }
      />

      {/* Push notification card */}
      <CuteCard variant="gradient" className="mb-5 mt-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-lavender/15 flex items-center justify-center flex-shrink-0 text-lavender">
                {pushEnabled ? <Bell size={20} /> : <BellOff size={20} className="text-text-muted" />}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-text-primary">设备推送通知</p>
                  {pushEnabled ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-mint bg-mint/10 px-2 py-0.5 rounded-full">
                      <CheckCircle size={12} /> 已开启
                    </span>
                  ) : pushPermission === "denied" ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-500 bg-rose-50 px-2 py-0.5 rounded-full">
                      权限被拦截
                    </span>
                  ) : pushPermission === "ios_not_standalone" ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                      需添加桌面
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-text-muted bg-gray-100 px-2 py-0.5 rounded-full">
                      未开启
                    </span>
                  )}
                </div>
                <p className="text-xs text-text-muted mt-0.5 leading-relaxed">
                  {pushEnabled
                    ? "家人提交或修改记录时，手机锁屏状态下将实时弹出通知"
                    : pushPermission === "denied"
                      ? "浏览器通知权限被禁用，请点击地址栏锁头图标允许"
                      : pushPermission === "ios_not_standalone"
                        ? "iOS Safari 需先添加到主屏幕打开，即可开启系统锁屏推送"
                        : "开启后家人提交或修改记录将实时收到系统推送"}
                </p>
              </div>
            </div>
          </div>

          {/* Action buttons row */}
          <div className="pt-2 border-t border-divider/50 flex flex-wrap items-center justify-end gap-2">
            {pushPermission === "ios_not_standalone" && (
              <button
                type="button"
                onClick={() => setShowInstallGuide(true)}
                className="px-3.5 py-1.5 rounded-full bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold btn-press shadow-button transition-all cursor-pointer flex items-center gap-1.5"
              >
                <Smartphone size={13} />
                <span>添加到主屏幕指引</span>
              </button>
            )}

            {pushPermission === "denied" && (
              <button
                type="button"
                onClick={() => {
                  checkAndSyncPush();
                  showToast("请在浏览器设置中开启通知权限后刷新页面", "info");
                }}
                className="px-3.5 py-1.5 rounded-full bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold btn-press shadow-button transition-all cursor-pointer flex items-center gap-1.5"
              >
                <RefreshCw size={13} />
                <span>已允许权限，点击重试</span>
              </button>
            )}

            {/* Re-bind / Enable button is ALWAYS available */}
            <button
              type="button"
              onClick={handleEnablePush}
              disabled={enablingPush}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold btn-press shadow-button transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50 ${
                pushEnabled
                  ? "bg-gray-100 hover:bg-gray-200 text-text-primary border border-divider"
                  : "bg-primary hover:bg-primary/90 text-white"
              }`}
            >
              <RefreshCw size={12} className={enablingPush ? "animate-spin" : ""} />
              <span>{enablingPush ? "绑定中..." : pushEnabled ? "重新绑定设备" : "开启推送通知"}</span>
            </button>

            {/* Test button is always visible & interactive */}
            <button
              type="button"
              onClick={handleSendTestPush}
              disabled={testingPush}
              className="px-3.5 py-1.5 rounded-full bg-primary/10 hover:bg-primary/20 text-primary text-xs font-semibold btn-press transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
            >
              <Send size={13} />
              <span>{testingPush ? "正在发送..." : "发送测试推送"}</span>
            </button>
          </div>
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
          <p className="text-sm text-text-muted">通知已全部清空，有新动态会及时提醒您 ✨</p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Family member dynamic group */}
          {familyNotifs.length > 0 && (
            <div>
              <SectionTitle
                title="家庭协同动态"
                icon={<Users size={18} className="text-primary" />}
                className="mb-3"
                action={
                  <span className="text-xs text-text-muted">
                    {familyNotifs.length} 条动态
                  </span>
                }
              />
              <div className="space-y-2.5">
                {familyNotifs.map((notif) => (
                  <NotificationCard
                    key={notif.id}
                    notification={notif}
                    read={readIds.has(notif.id)}
                    onRead={markRead}
                    onDismiss={handleDismiss}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Vaccine reminders group */}
          {vaccineNotifs.length > 0 && (
            <div>
              <SectionTitle
                title="疫苗接种提醒"
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
                  <NotificationCard
                    key={notif.id}
                    notification={notif}
                    read={readIds.has(notif.id)}
                    onRead={markRead}
                    onDismiss={handleDismiss}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Daily reminders group */}
          {dailyNotifs.length > 0 && (
            <div>
              <SectionTitle
                title="日常记录提醒"
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
                  <NotificationCard
                    key={notif.id}
                    notification={notif}
                    read={readIds.has(notif.id)}
                    onRead={markRead}
                    onDismiss={handleDismiss}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <InstallGuideModal
        isOpen={showInstallGuide}
        onClose={() => setShowInstallGuide(false)}
      />
    </div>
  );
}

function NotificationCard({
  notification,
  read,
  onRead,
  onDismiss,
}: {
  notification: NotificationItem;
  read: boolean;
  onRead: (id: string) => void;
  onDismiss?: (id: string, e: React.MouseEvent) => void;
}) {
  const router = useRouter();

  const handleClick = () => {
    if (!read) onRead(notification.id);
    if (notification.type === "vaccine") {
      router.push("/health/vaccines");
    } else if (notification.type === "family") {
      if (notification.title.includes("喂奶")) {
        router.push("/records/feeding");
      } else if (notification.title.includes("睡眠")) {
        router.push("/records/sleep");
      } else if (notification.title.includes("尿布")) {
        router.push("/records/diaper");
      } else if (notification.title.includes("辅食")) {
        router.push("/food");
      } else if (notification.title.includes("生长")) {
        router.push("/growth");
      } else if (notification.title.includes("补剂")) {
        router.push("/nutrition");
      } else {
        router.push("/");
      }
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
    : notification.type === "family"
      ? "border-l-mint"
      : notification.type === "vaccine"
        ? "border-l-primary/50"
        : "border-l-sky/50";

  return (
    <CuteCard
      className={`${!read ? "ring-1 ring-primary/20" : ""} border-l-[3px] ${borderColor} card-press cursor-pointer relative group`}
      onClick={handleClick}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-primary-light/50 flex items-center justify-center">
          <span className="text-lg">{notification.icon}</span>
        </div>

        <div className="flex-1 min-w-0 pr-6">
          <div className="flex items-center gap-2">
            <p
              className={`text-sm ${!read ? "font-semibold" : "font-medium"} text-text-primary truncate`}
            >
              {notification.title}
            </p>
            {!read && (
              <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
            )}
          </div>
          <p className="text-xs text-text-secondary mt-0.5 leading-relaxed line-clamp-2">
            {notification.detail}
          </p>
          <p className="text-[10px] text-text-muted mt-1.5">
            {notification.time}
          </p>
        </div>

        {/* 单条通知快速清除按钮 */}
        {onDismiss && (
          <button
            type="button"
            onClick={(e) => onDismiss(notification.id, e)}
            title="清除此条通知"
            className="absolute top-3 right-3 w-6 h-6 rounded-full hover:bg-gray-100 flex items-center justify-center text-text-muted hover:text-text-primary transition-colors cursor-pointer opacity-70 group-hover:opacity-100"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </CuteCard>
  );
}
