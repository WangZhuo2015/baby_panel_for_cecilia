"use client";

import React, { useState, useEffect } from "react";
import { Bell, BellRing, CheckCircle2, ShieldCheck, Sparkles, Clock, Users } from "lucide-react";
import { CuteButton } from "@/components/ui/CuteButton";
import { useToast } from "@/components/ui/Toast";

interface NotificationPromptCardProps {
  onContinue?: () => void;
  standalone?: boolean;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function NotificationPromptCard({ onContinue, standalone = false }: NotificationPromptCardProps) {
  const { showToast } = useToast();
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [loading, setLoading] = useState(false);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    if (typeof window !== "undefined") {
      if ("Notification" in window) {
        setPermission(Notification.permission);
      } else {
        setSupported(false);
      }
    }
  }, []);

  const handleEnableNotifications = async () => {
    if (!("Notification" in window)) {
      showToast("当前浏览器环境不支持原生通知", "error");
      if (onContinue) onContinue();
      return;
    }

    setLoading(true);
    try {
      const res = await Notification.requestPermission();
      setPermission(res);

      if (res === "granted") {
        showToast("通知权限已开启 ✨", "success");
        // 尝试通过 ServiceWorker 注册 Push 订阅凭据
        if ("serviceWorker" in navigator) {
          try {
            const reg = await navigator.serviceWorker.ready;
            const keyRes = await fetch("/api/push/vapid-key");
            if (keyRes.ok) {
              const { publicKey } = await keyRes.json();
              const sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
              });
              await fetch("/api/push/subscribe", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(sub.toJSON()),
              });
            }
          } catch (err) {
            console.warn("Push subscription optional step:", err);
          }
        }
      } else if (res === "denied") {
        showToast("通知已被禁用，如需开启可在浏览器设置中允许", "error");
      }
    } catch (err: any) {
      showToast(err?.message || "开启通知失败，请稍后重试", "error");
    } finally {
      setLoading(false);
      if (onContinue) {
        setTimeout(onContinue, 600);
      }
    }
  };

  if (!supported) return null;

  const isGranted = permission === "granted";

  return (
    <div className={`p-4 sm:p-5 rounded-3xl bg-gradient-to-br from-purple-50/80 via-pink-50/70 to-blue-50/50 dark:from-purple-950/30 dark:via-pink-950/20 dark:to-card border border-purple-200/60 dark:border-purple-800/40 shadow-card ${standalone ? "max-w-md mx-auto" : ""}`}>
      <div className="flex items-start gap-3.5 mb-3.5">
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 text-white flex items-center justify-center shadow-button shrink-0">
          {isGranted ? <BellRing size={22} /> : <Bell size={22} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-bold text-text-primary">
              强烈推荐开启育儿通知
            </h3>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-600 dark:bg-purple-900/50 dark:text-purple-300">
              重要
            </span>
          </div>
          <p className="text-xs text-text-secondary mt-0.5">
            关键时刻提醒，避免手忙脚乱遗漏关键育儿事项
          </p>
        </div>
      </div>

      {/* 3 大核心通知亮点 */}
      <div className="space-y-2 mb-4">
        <div className="p-2.5 rounded-2xl bg-white/80 dark:bg-card/70 border border-divider/60 flex items-center gap-2.5 text-xs text-text-secondary">
          <Clock size={15} className="text-purple-500 shrink-0" />
          <span><strong>喂养与睡眠节律</strong>：按宝宝月龄规律提示下一次喂奶与小睡</span>
        </div>
        <div className="p-2.5 rounded-2xl bg-white/80 dark:bg-card/70 border border-divider/60 flex items-center gap-2.5 text-xs text-text-secondary">
          <ShieldCheck size={15} className="text-emerald-500 shrink-0" />
          <span><strong>疫苗接种倒计时</strong>：关键免疫接种窗口期提前 3 天温馨提醒</span>
        </div>
        <div className="p-2.5 rounded-2xl bg-white/80 dark:bg-card/70 border border-divider/60 flex items-center gap-2.5 text-xs text-text-secondary">
          <Users size={15} className="text-sky-500 shrink-0" />
          <span><strong>家人动态实时同步</strong>：妈妈记了奶量，爸爸手机立刻收到提醒</span>
        </div>
      </div>

      {/* 按钮控制 */}
      <div className="flex items-center gap-2 pt-1">
        {isGranted ? (
          <div className="w-full py-2.5 px-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-300 text-xs font-bold flex items-center justify-center gap-1.5">
            <CheckCircle2 size={16} />
            <span>通知权限已就绪 · 全天候为你守候</span>
          </div>
        ) : (
          <>
            <CuteButton
              variant="primary"
              size="md"
              onClick={handleEnableNotifications}
              disabled={loading}
              className="flex-1 justify-center font-bold text-xs"
            >
              <BellRing size={15} className="mr-1.5" />
              {loading ? "正在申请中..." : "一键开启通知提醒"}
            </CuteButton>

            {onContinue && (
              <CuteButton
                variant="ghost"
                size="md"
                onClick={onContinue}
                className="text-xs text-text-muted hover:text-text-secondary px-3"
              >
                稍后再说
              </CuteButton>
            )}
          </>
        )}
      </div>
    </div>
  );
}
