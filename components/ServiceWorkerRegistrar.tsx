"use client";

import { useEffect, useState } from "react";

/**
 * Service Worker 注册与授权式更新。
 *
 * 反模式修复：
 * - 不再自动 SKIP_WAITING + 强制 reload（部署瞬间强刷所有在线页面、表单数据丢失）
 * - 新版本就绪时显示页内横幅，用户点击「立即更新」才接管并刷新
 * - 首次安装的 clients.claim() 不触发刷新
 * - 周期性 update()：常驻会话也能发现新版本（此前仅 load 时一次）
 * - Kill-switch：SW_DISABLED=1 时注销全部 SW 并清空缓存（坏版本自救通道）
 */
export function ServiceWorkerRegistrar() {
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    let cancelled = false;
    const teardown: (() => void)[] = [];
    let userAcceptedUpdate = false;
    let isRefreshing = false;

    const handleControllerChange = () => {
      // 仅在用户已同意更新时刷新；首次安装的 claim（controller null→有值）不刷
      if (!userAcceptedUpdate || isRefreshing) return;
      isRefreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
    teardown.push(() =>
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange)
    );

    const onUpdateAccepted = () => {
      userAcceptedUpdate = true;
      setUpdateReady(false);
      navigator.serviceWorker.controller?.postMessage({ type: "SKIP_WAITING" });
      // waiting 状态下 controller 可能仍指向旧 SW，双保险都发
      navigator.serviceWorker.getRegistration().then((reg) => {
        reg?.waiting?.postMessage({ type: "SKIP_WAITING" });
      });
    };
    window.addEventListener("pwa-update-accepted", onUpdateAccepted);
    teardown.push(() => window.removeEventListener("pwa-update-accepted", onUpdateAccepted));

    const registerSW = async () => {
      try {
        // Kill-switch：环境开关打开时彻底停用 SW 并清理残留
        const cfg = await fetch("/api/app-config", { cache: "no-store" })
          .then((r) => r.json())
          .catch(() => null);
        if (cancelled) return;
        if (cfg?.swDisabled) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
          return;
        }

        const registration = await navigator.serviceWorker.register("/sw.js", {
          updateViaCache: "none",
        });
        if (cancelled) return;

        // 立即检查一次 + 每小时 + 回到前台时检查
        const tick = () => registration.update().catch(() => {});
        tick();
        const timer = window.setInterval(tick, 60 * 60 * 1000);
        const onVisible = () => {
          if (document.visibilityState === "visible") tick();
        };
        document.addEventListener("visibilitychange", onVisible);
        teardown.push(() => {
          window.clearInterval(timer);
          document.removeEventListener("visibilitychange", onVisible);
        });

        const announceIfReady = () => {
          if (!cancelled && registration.waiting && navigator.serviceWorker.controller) {
            setUpdateReady(true);
          }
        };
        announceIfReady();
        registration.addEventListener("updatefound", () => {
          const installingWorker = registration.installing;
          installingWorker?.addEventListener("statechange", () => {
            if (installingWorker.state === "installed") announceIfReady();
          });
        });
      } catch (err) {
        console.warn("SW registration error:", err);
      }
    };

    const onLoad = () => registerSW();
    if (document.readyState === "complete") {
      registerSW();
    } else {
      window.addEventListener("load", onLoad);
      teardown.push(() => window.removeEventListener("load", onLoad));
    }

    return () => {
      cancelled = true;
      teardown.forEach((fn) => fn());
    };
  }, []);

  const acceptUpdate = () => {
    window.dispatchEvent(new Event("pwa-update-accepted"));
  };

  if (!updateReady) return null;

  return (
    <div className="fixed bottom-[calc(72px+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-[110] w-[min(92vw,360px)] rounded-full bg-text-primary text-white shadow-lg flex items-center gap-2 pl-4 pr-2 py-2">
      <span className="text-xs flex-1">🎉 发现新版本</span>
      <button
        type="button"
        onClick={acceptUpdate}
        className="px-3 py-1.5 rounded-full bg-primary text-white text-xs font-medium min-h-[36px]"
      >
        立即更新
      </button>
      <button
        type="button"
        aria-label="稍后再说"
        onClick={() => setUpdateReady(false)}
        className="px-2 py-1.5 text-xs text-white/70 min-h-[36px]"
      >
        稍后
      </button>
    </div>
  );
}
