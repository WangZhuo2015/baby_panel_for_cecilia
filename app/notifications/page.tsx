"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
import { useToast } from "@/components/ui/Toast";
import { InstallGuideModal } from "@/components/ui/InstallGuideModal";
import { useNotificationInbox } from "@/lib/hooks/useNotificationInbox";
import type { NotificationViewItem as NotificationItem } from "@/lib/notification-actions";
import { useBabyStore } from "@/stores/useBabyStore";
import {
  getPushRegistration,
  PushClientError,
  pushErrorMessage,
  recoverExistingPushSubscription,
  sendTestPush,
  syncPushSubscription,
} from "@/lib/push-client";

function currentPushPermission(): string {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true;
  if (isIos && !isStandalone) return "ios_not_standalone";
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  return Notification.permission;
}

export default function NotificationsPage() {
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushPermission, setPushPermission] = useState<string>("default");
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [testingPush, setTestingPush] = useState(false);
  const [enablingPush, setEnablingPush] = useState(false);
  const [checkingPush, setCheckingPush] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [pushStatus, setPushStatus] = useState<string | null>(null);
  const pushAction = useRef(false);
  const pushBusy = checkingPush || enablingPush || testingPush;
  const { showToast } = useToast();
  const reportNotificationError = useCallback((message: string) => showToast(message, "error"), [showToast]);
  const {
    notifications, loading, readIds, unreadCount, reload: fetchNotifications,
    markRead, dismiss, clearAll, error: notificationError,
  } = useNotificationInbox(true, reportNotificationError);

  const checkAndSyncPush = useCallback(async () => {
    if (typeof window === "undefined" || pushAction.current) return;
    pushAction.current = true;
    let unsubscribeIdentity: (() => void) | undefined;
    setCheckingPush(true);
    setPushEnabled(false);
    setPushError(null);
    setPushStatus(null);
    try {
      const permission = currentPushPermission();
      setPushPermission(permission);
      if (permission !== "granted") return;
      const identity = useBabyStore.getState();
      const expectedUserId = identity.user?.id;
      if (identity.authLoading || !expectedUserId) return;
      let identityCurrent = true;
      unsubscribeIdentity = useBabyStore.subscribe((state) => {
        if (state.authLoading || state.user?.id !== expectedUserId) identityCurrent = false;
      });
      const result = await recoverExistingPushSubscription({
        permission,
        pushSupported: true,
        standaloneEligible: true,
        expectedUserId,
        isCurrent: () => {
          const current = useBabyStore.getState();
          return identityCurrent && !current.authLoading && current.user?.id === expectedUserId;
        },
        getRegistration: () => getPushRegistration(navigator.serviceWorker, true),
      });
      setPushEnabled(result === "synced");
    } catch (error) {
      setPushError(pushErrorMessage(error));
    } finally {
      unsubscribeIdentity?.();
      pushAction.current = false;
      setCheckingPush(false);
    }
  }, []);

  const ensurePushPermission = async () => {
    let permission = currentPushPermission();
    setPushPermission(permission);
    if (permission === "ios_not_standalone") {
      setShowInstallGuide(true);
      throw new PushClientError("iOS 需先添加到主屏幕，从桌面图标打开后重试");
    }
    if (permission === "unsupported") throw new PushClientError("当前浏览器不支持推送通知，请使用支持推送的浏览器");
    if (permission === "default") {
      permission = await Notification.requestPermission();
      setPushPermission(permission);
    }
    if (permission !== "granted") throw new PushClientError("通知权限未开启，请在浏览器设置中允许通知后重试");
  };

  const handleDismiss = useCallback(async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (await dismiss(id)) showToast("已在本机清除此条通知 ✨");
  }, [dismiss, showToast]);

  useEffect(() => {
    checkAndSyncPush();
  }, [checkAndSyncPush]);

  const handleEnablePush = async () => {
    if (pushAction.current) return;
    pushAction.current = true;
    setEnablingPush(true);
    setPushEnabled(false);
    setPushError(null);
    setPushStatus(null);
    try {
      await ensurePushPermission();
      const registration = await getPushRegistration(navigator.serviceWorker, true);
      const subscription = await syncPushSubscription(registration, true);
      if (!subscription) throw new PushClientError("设备尚未绑定，请先开启推送通知");
      setPushEnabled(true);
      setPushStatus("设备已绑定，可发送测试通知检查当前设备");
      showToast("设备推送已绑定 ✨", "success");
    } catch (error) {
      const message = pushErrorMessage(error);
      setPushError(message);
      showToast(message, "error");
    } finally {
      pushAction.current = false;
      setEnablingPush(false);
    }
  };

  const handleSendTestPush = async () => {
    if (pushAction.current) return;
    pushAction.current = true;
    setTestingPush(true);
    setPushEnabled(false);
    setPushError(null);
    setPushStatus(null);
    try {
      await ensurePushPermission();
      const registration = await getPushRegistration(navigator.serviceWorker, true);
      const subscription = await syncPushSubscription(registration, true);
      if (!subscription) throw new PushClientError("设备尚未绑定，请先开启推送通知");
      setPushEnabled(true);
      await sendTestPush(subscription);
      const message = "推送服务已接受测试通知，请查看系统通知栏；若未显示，请检查系统通知设置";
      setPushStatus(message);
      showToast(message, "success");
    } catch (error) {
      if (error instanceof PushClientError && error.code === "PUSH_SUBSCRIPTION_GONE") setPushEnabled(false);
      const message = pushErrorMessage(error);
      setPushError(message);
      showToast(message, "error");
    } finally {
      pushAction.current = false;
      setTestingPush(false);
    }
  };

  const handleClearAll = async () => {
    if (await clearAll()) showToast("已在本机清除全部通知 ✨", "success");
  };

  const familyNotifs = notifications.filter((n) => n.type === "family");
  const vaccineNotifs = notifications.filter((n) => n.type === "vaccine");
  const dailyNotifs = notifications.filter((n) => n.type === "daily" || n.type === "ai" || n.type === "data_release");

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
                      <CheckCircle size={12} /> 已绑定
                    </span>
                  ) : checkingPush ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-text-muted bg-gray-100 px-2 py-0.5 rounded-full">
                      检查绑定中...
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
                      未绑定
                    </span>
                  )}
                </div>
                <p className="text-xs text-text-muted mt-0.5 leading-relaxed">
                  {pushEnabled
                    ? "设备已绑定，可接收已配置的推送通知；可发送测试通知检查当前设备"
                    : pushPermission === "denied"
                      ? "通知权限被禁用，请在浏览器或系统设置中允许通知"
                      : pushPermission === "ios_not_standalone"
                        ? "iOS Safari 需先添加到主屏幕打开，即可开启系统锁屏推送"
                        : pushPermission === "unsupported"
                          ? "当前浏览器不支持系统推送通知"
                          : "开启后绑定当前设备，可发送测试通知检查系统通知设置"}
                </p>
              </div>
            </div>
          </div>

          {pushError && (
            <div role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 space-y-1">
              <p>{pushError}</p>
              <p>处理后可点击「开启推送通知」或「发送测试推送」重试。</p>
            </div>
          )}
          {pushStatus && (
            <p role="status" className="text-xs text-text-secondary leading-relaxed">{pushStatus}</p>
          )}

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
                disabled={pushBusy}
                className="px-3.5 py-1.5 rounded-full bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold btn-press shadow-button transition-all cursor-pointer flex items-center gap-1.5"
              >
                <RefreshCw size={13} />
                <span>已允许权限，点击重试</span>
              </button>
            )}

            {/* Sync an existing binding or enable this device. */}
            <button
              type="button"
              onClick={handleEnablePush}
              disabled={pushBusy}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold btn-press shadow-button transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50 ${
                pushEnabled
                  ? "bg-gray-100 hover:bg-gray-200 text-text-primary border border-divider"
                  : "bg-primary hover:bg-primary/90 text-white"
              }`}
            >
              <RefreshCw size={12} className={enablingPush ? "animate-spin" : ""} />
              <span>{checkingPush ? "检查中..." : enablingPush ? "绑定中..." : pushEnabled ? "重新绑定设备" : "开启推送通知"}</span>
            </button>

            {/* Sending first confirms this device's binding. */}
            <button
              type="button"
              onClick={handleSendTestPush}
              disabled={pushBusy}
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
      ) : notificationError && notifications.length === 0 ? (
        <div role="alert" className="flex flex-col items-center justify-center py-20 space-y-3">
          <p className="text-sm text-text-secondary">{notificationError}</p>
          <button type="button" onClick={fetchNotifications} className="btn-press text-sm text-primary cursor-pointer">
            重新加载
          </button>
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
  onRead: (id: string) => Promise<boolean>;
  onDismiss?: (id: string, e: React.MouseEvent) => void;
}) {
  const router = useRouter();

  const handleClick = async () => {
    if (!(await onRead(notification.id))) return;
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
